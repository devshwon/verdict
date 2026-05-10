-- 즉시 지급 모드 — payout-points Edge Function 의 user-scoped 호출 지원
--
-- 배경:
--   기존: claim_points 로 unclaimed→pending → cron 5분 후 payout-points 가 처리
--   변경: 사용자가 "받기" 클릭 시 claim_points 직후 payout-points 를 user JWT 로 직접 호출
--         → 자기 user 의 pending 만 처리하는 user-scoped 모드 필요
--
-- 본 마이그레이션:
--   - fn_get_pending_payouts_for_user(p_user_id uuid, p_batch_size int) 신규
--   - 기존 fn_get_pending_payouts (전체 처리, cron 용) 는 그대로 유지
--   - 두 함수가 한도 검증 / 결과 반환 로직 동일 (DRY 위해 후속 리팩터링 가능)
--
-- 권한:
--   - service_role 만 grant (Edge Function 의 admin 클라이언트가 호출)
--   - 일반 사용자는 직접 호출 X — Edge Function 이 JWT 인증 후 user_id 를 인자로 전달

create or replace function public.fn_get_pending_payouts_for_user(
  p_user_id uuid,
  p_batch_size int default 50
)
returns table (
  id uuid,
  user_id uuid,
  toss_user_key text,
  trigger text,
  amount int,
  promotion_id text,
  promotion_test_mode boolean,
  related_vote_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_limit_breached boolean;
begin
  -- 일일 한도 사전 검증 — 초과 row 는 'blocked' 로 전환
  for rec in
    select pl.id, pl.user_id, pl.trigger, pl.amount
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    where pl.status = 'pending'
      and pl.user_id = p_user_id
      and u.created_at <= now() - interval '24 hours'
    order by pl.created_at asc
  loop
    v_limit_breached := public.fn_check_daily_payout_limit(
      rec.user_id,
      public.fn_points_category(rec.trigger),
      rec.amount
    );
    if v_limit_breached then
      update public.points_log
      set status = 'blocked'
      where id = rec.id;
    end if;
  end loop;

  -- 처리 대상 반환 (toss_user_key + promotion_id 매핑 join)
  return query
    select
      pl.id,
      pl.user_id,
      u.toss_user_key,
      pl.trigger,
      pl.amount,
      tp.promotion_id,
      coalesce(tp.test_mode, true) as promotion_test_mode,
      pl.related_vote_id,
      pl.created_at
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    left join public.toss_promotions tp on tp.trigger = pl.trigger
    where pl.status = 'pending'
      and pl.user_id = p_user_id
      and u.created_at <= now() - interval '24 hours'
    order by pl.created_at asc
    limit p_batch_size;
end;
$$;

revoke execute on function public.fn_get_pending_payouts_for_user(uuid, int) from public, anon, authenticated;
grant execute on function public.fn_get_pending_payouts_for_user(uuid, int) to service_role;
