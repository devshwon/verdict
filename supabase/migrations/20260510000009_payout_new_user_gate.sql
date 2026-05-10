-- 신규 가입자 지급 가드 시간 외부화
--
-- 정책 변경:
--   기존: fn_get_pending_payouts / fn_get_pending_payouts_for_user 가
--         u.created_at <= now() - interval '24 hours' 로 하드코딩 검증.
--         → 신규 가입 24시간 동안 즉시 지급 안 됨 (사용자 혼란).
--   변경: admin_settings.payout_new_user_gate_hours 로 외부화.
--         default 0 (즉시 지급 — 토스 어뷰즈 방어를 1차 방어로 신뢰).
--         운영 중 어뷰즈 패턴 발견 시 admin SPA 에서 즉시 1~24 등으로 조정 가능.
--
-- 구현:
--   - admin_settings 시드 추가
--   - 두 함수 재정의 — 동적 interval (make_interval 사용)

insert into public.admin_settings (key, value, category, value_type, description, min_value, max_value, risk_level)
values (
  'payout_new_user_gate_hours',
  to_jsonb(0),
  'payout',
  'int',
  '신규 가입자 지급 보류 시간 (시간 단위, 0=즉시 지급)',
  0,
  72,
  'medium'
)
on conflict (key) do nothing;

-- ============================================================================
-- fn_get_pending_payouts (cron 전체 처리 모드) — gate hours lookup
-- ============================================================================

drop function if exists public.fn_get_pending_payouts(int);

create or replace function public.fn_get_pending_payouts(p_batch_size int default 100)
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
  v_setting_value jsonb;
  v_gate_hours int;
  v_gate_cutoff timestamptz;
begin
  -- 신규 가입자 게이트 시간 lookup (default 0)
  select value into v_setting_value
  from public.admin_settings where key = 'payout_new_user_gate_hours';
  v_gate_hours := coalesce((v_setting_value #>> '{}')::int, 0);
  v_gate_cutoff := now() - make_interval(hours => v_gate_hours);

  -- 일일 한도 사전 검증
  for rec in
    select pl.id, pl.user_id, pl.trigger, pl.amount
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    where pl.status = 'pending'
      and u.created_at <= v_gate_cutoff
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
      and u.created_at <= v_gate_cutoff
    order by pl.created_at asc
    limit p_batch_size;
end;
$$;

revoke execute on function public.fn_get_pending_payouts(int) from public, anon, authenticated;
grant execute on function public.fn_get_pending_payouts(int) to service_role;

-- ============================================================================
-- fn_get_pending_payouts_for_user (즉시 지급 user-scoped 모드) — gate hours lookup
-- ============================================================================

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
  v_setting_value jsonb;
  v_gate_hours int;
  v_gate_cutoff timestamptz;
begin
  select value into v_setting_value
  from public.admin_settings where key = 'payout_new_user_gate_hours';
  v_gate_hours := coalesce((v_setting_value #>> '{}')::int, 0);
  v_gate_cutoff := now() - make_interval(hours => v_gate_hours);

  for rec in
    select pl.id, pl.user_id, pl.trigger, pl.amount
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    where pl.status = 'pending'
      and pl.user_id = p_user_id
      and u.created_at <= v_gate_cutoff
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
      and u.created_at <= v_gate_cutoff
    order by pl.created_at asc
    limit p_batch_size;
end;
$$;

revoke execute on function public.fn_get_pending_payouts_for_user(uuid, int) from public, anon, authenticated;
grant execute on function public.fn_get_pending_payouts_for_user(uuid, int) to service_role;
