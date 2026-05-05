-- 토스포인트 지급 워커 인프라 (백로그 §S3, 기획서 §7-1, §7-2)
--
-- 변경:
--   1) point_status enum에 'blocked' 추가 (일일 합산 한도 초과)
--   2) fn_points_category — 트리거를 행동 기반(1) / 성과 기반(2) 분류
--   3) fn_check_daily_payout_limit — 사용자별 카테고리별 일일 지급 한도 검증
--   4) fn_get_pending_payouts — payout-points worker가 호출하는 안전 조회 함수
--      (신규 가입 24h 지연 + 일일 한도 검증 + 이미 blocked된 row 제외)
--
-- 한도 (기획서 §7-2):
--   카테고리 1 (행동 기반): 30P / 일
--   카테고리 2 (성과 기반): 130P / 일
--
-- 워커 흐름:
--   1) pg_cron이 5분마다 payout-points Edge Function 호출
--   2) EF가 fn_get_pending_payouts() 호출 → 처리 대상 행 조회
--   3) EF가 한도 검증 → 토스 비즈월렛 API 호출 → status 업데이트

-- ============================================================================
-- 1. point_status enum에 'blocked' 추가
-- ============================================================================

alter type point_status add value if not exists 'blocked';

-- ============================================================================
-- 2. fn_points_category — 카테고리 분류
-- ============================================================================

create or replace function public.fn_points_category(p_trigger text)
returns int
language sql
immutable
as $$
  -- 1: 행동 기반 (캡 30P/일)
  -- 2: 성과 기반 (캡 130P/일)
  select case
    when p_trigger in (
      'normal_vote_participation',
      'normal_daily_3vote_complete',
      'normal_streak_3d',
      'normal_streak_7d',
      'normal_streak_30d',
      'normal_vote_register',
      'today_candidate_register'
    ) then 1
    when p_trigger in (
      'normal_100_participants_bonus',
      'today_selection'
    ) then 2
    else 1
  end;
$$;

-- ============================================================================
-- 3. fn_check_daily_payout_limit — 사용자/카테고리/일자 별 합산 한도 검증
-- ============================================================================
--
-- 입력: user_id, 카테고리, 추가하려는 금액
-- 반환: 한도 초과 여부 (true면 blocked로 분류해야 함)
-- KST 자정 기준으로 그 날 completed 또는 pending인 동일 카테고리 합산 + 신규 금액

create or replace function public.fn_check_daily_payout_limit(
  p_user_id uuid,
  p_category int,
  p_amount int
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kst_today_start timestamptz;
  v_today_total int;
  v_limit int;
begin
  v_kst_today_start := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

  v_limit := case p_category when 1 then 30 when 2 then 130 else 30 end;

  -- 같은 사용자/카테고리/오늘에 이미 적립된(pending or completed) 합계
  select coalesce(sum(amount), 0) into v_today_total
  from public.points_log
  where user_id = p_user_id
    and created_at >= v_kst_today_start
    and status in ('pending', 'completed')
    and public.fn_points_category(trigger) = p_category;

  return (v_today_total + p_amount) > v_limit;
end;
$$;

-- ============================================================================
-- 4. fn_get_pending_payouts — worker가 호출하는 안전한 조회
-- ============================================================================
--
-- 동작:
--   - status='pending'인 row 중 처리 대상만 반환
--   - 신규 가입 24h 미경과 사용자는 제외 (해당 row는 pending 그대로 유지 → 다음 사이클에 처리)
--   - 일일 한도 초과 row는 status='blocked'로 즉시 마킹 (반환에서 제외)
--   - 한 번에 처리할 batch_size 제한 (Edge Function 타임아웃 방지)

create or replace function public.fn_get_pending_payouts(p_batch_size int default 100)
returns table (
  id uuid,
  user_id uuid,
  trigger text,
  amount int,
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
  -- 일일 한도 초과 row 사전 마킹 (다음 호출 시 결과에서 자동 제외)
  for rec in
    select pl.id, pl.user_id, pl.trigger, pl.amount
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    where pl.status = 'pending'
      and u.created_at <= now() - interval '24 hours'   -- 신규 24h 지연
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

  -- 처리 대상 반환
  return query
    select pl.id, pl.user_id, pl.trigger, pl.amount, pl.related_vote_id, pl.created_at
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    where pl.status = 'pending'
      and u.created_at <= now() - interval '24 hours'
    order by pl.created_at asc
    limit p_batch_size;
end;
$$;

-- service_role 외부 호출 차단 — Edge Function이 SUPABASE_SERVICE_ROLE_KEY로 호출
revoke execute on function public.fn_get_pending_payouts(int) from public, anon, authenticated;

-- ============================================================================
-- 5. fn_complete_payout / fn_fail_payout — worker가 RPC로 status 업데이트
-- ============================================================================

create or replace function public.fn_complete_payout(
  p_id uuid,
  p_toss_transaction_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.points_log
  set status = 'completed',
      toss_transaction_id = p_toss_transaction_id,
      completed_at = now()
  where id = p_id and status = 'pending';
$$;

create or replace function public.fn_fail_payout(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.points_log
  set status = 'failed'
  where id = p_id and status = 'pending';
$$;

revoke execute on function public.fn_complete_payout(uuid, text) from public, anon, authenticated;
revoke execute on function public.fn_fail_payout(uuid) from public, anon, authenticated;

-- ============================================================================
-- 6. pg_cron 잡 (운영자 수동 설치)
-- ============================================================================
--
-- 실제 토스 비즈월렛 API 키와 supabase vault 설정 후 활성화.
-- 주석 해제 + URL/SERVICE_ROLE_KEY 치환 후 실행:
--
-- select cron.schedule(
--   'payout-points-worker',
--   '*/5 * * * *',  -- 매 5분
--   $$
--     select net.http_post(
--       url := 'https://<project>.supabase.co/functions/v1/payout-points',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--         'Content-Type', 'application/json'
--       )
--     ) as request_id;
--   $$
-- );
--
-- 잡 해제: select cron.unschedule('payout-points-worker');
-- 모니터링: select * from cron.job_run_details where jobname = 'payout-points-worker' order by start_time desc limit 20;

-- ============================================================================
-- TODO (별도 후속):
--   - 디바이스 핑거프린트 (다계정 보상 수확 차단) — 토스 SDK 제공 시점에 도입
--   - 단일 클릭 패턴 탐지 (전부 A 선택) — vote_casts 통계 기반
--   - 환불/취소 플로우 (toss_transaction_id 기반)
-- ============================================================================
