-- 토스 프로모션 매핑 테이블 (콘솔 발급 promotionId ↔ DB trigger)
--
-- 흐름:
--   1) 토스 콘솔에서 프로모션 등록 → promotionId 발급
--   2) 운영자가 INSERT INTO toss_promotions (...) — 한 번만
--   3) payout-points 워커가 points_log.trigger → promotion_id 조회 후 토스 API 호출
--
-- 매핑 누락 시:
--   - 워커가 해당 row를 'failed' 처리 + 운영자 알림 (모니터링)
--   - DB trigger는 정상 발화하지만 토스 지급은 안 됨
--
-- 테스트 ↔ 운영 전환:
--   - test_mode=true 설정 시 워커가 promotion_id 앞에 'TEST_' prefix 자동 부착
--   - 검수 통과 후 TEST_ 호출로 검증 → 모든 프로모션 OK 확인되면 test_mode=false

-- ============================================================================
-- 1. toss_promotions 테이블
-- ============================================================================

create table public.toss_promotions (
  trigger text primary key,                 -- points_log.trigger 와 동일 키
  promotion_id text not null,               -- 토스 콘솔 발급 식별자
  promotion_name text,                      -- 콘솔에 등록한 이름 (메모용)
  test_mode boolean not null default true,  -- 검수 통과 후 false로 전환
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.fn_toss_promotions_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_toss_promotions_updated_at
before update on public.toss_promotions
for each row execute function public.fn_toss_promotions_touch_updated_at();

-- 운영자만 (service_role) 직접 조작
alter table public.toss_promotions enable row level security;
-- 인증된 사용자도 promotion_name 정도는 노출해도 무방하지만, 안전하게 service_role only
revoke all on public.toss_promotions from public, anon, authenticated;

-- ============================================================================
-- 2. fn_get_pending_payouts 확장 — toss_user_key + promotion_id 함께 반환
--    워커가 단일 RPC 호출로 모든 정보 확보
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
begin
  -- 일일 한도 사전 검증 (기존 동작 유지)
  for rec in
    select pl.id, pl.user_id, pl.trigger, pl.amount
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    where pl.status = 'pending'
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

  -- 처리 대상 반환 + 매핑 정보 join
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
      and u.created_at <= now() - interval '24 hours'
    order by pl.created_at asc
    limit p_batch_size;
end;
$$;

revoke execute on function public.fn_get_pending_payouts(int) from public, anon, authenticated;
