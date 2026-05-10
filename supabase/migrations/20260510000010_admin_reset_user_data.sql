-- 사용자 활동 데이터 초기화 운영 RPC (테스트 편의용)
--
-- 목적:
--   런칭 전/QA 시점에 특정 테스트 계정을 "신규 가입 직후" 상태로 되돌림.
--   계정 자체(users 행, auth.users)는 보존하고, 활동 흔적(투표 등록/참여/포인트/
--   신고/문의/광고/언락/무료 패스 등)만 모두 제거.
--
-- 안전장치:
--   - 본인에게 사용 금지 (운영자 자기 흔적 자체 삭제 차단)
--   - 다른 admin / system 사용자에게 사용 금지 (오작동/실수 방어)
--   - reason 필수 (감사 로그 추적)
--
-- 동작 (단일 트랜잭션):
--   1) DELETE 대상 (직접 또는 cascade):
--        - votes (author_id) → vote_options/vote_casts/today_candidate_recommendations
--                              /vote_reports/reports/admin_moderation_actions cascade
--        - vote_casts (user_id)
--        - today_candidate_recommendations (user_id)
--        - vote_reports (reporter_id)
--        - reports (reporter_id)  ← legacy
--        - inquiries (user_id)
--        - vote_unlocks (user_id)
--        - ad_watches (user_id)
--        - free_pass_grants (user_id)
--        - points_log (user_id)
--   2) users 부가 카운터 컬럼 리셋:
--        - register_blocked_until / consecutive_rejections
--        - daily_rejection_count / daily_rejection_date
--        - daily_moderation_calls / daily_moderation_date
--        - daily_ad_refund_count / daily_ad_refund_date
--        - current_streak / last_voted_date
--        - report_received_count
--        - free_pass_balance
--   3) admin_settings_audit 에 'reset_user_data' 액션 기록
--
-- 보존 (절대 건드리지 않음):
--   - id / toss_user_key (정체성)
--   - gender / age_bucket / *_raw / *_public (인구통계)
--   - is_admin / is_system / report_weight (권한·운영 메타)
--   - created_at (가입일)
--
-- 반환: jsonb { ok, deleted: { ...counts }, reset_columns: [...] }

-- ============================================================================
-- 1. admin_settings_audit.action CHECK 확장 — 'reset_user_data' 허용
-- ============================================================================

alter table public.admin_settings_audit
  drop constraint if exists admin_settings_audit_action_check;

alter table public.admin_settings_audit
  add constraint admin_settings_audit_action_check
  check (action in (
    'setting_change',
    'toss_promotion_change',
    'unblock_user',
    'grant_admin',
    'revoke_admin',
    'reset_user_data'
  ));

-- ============================================================================
-- 2. admin_reset_user_data — 사용자 활동 전체 초기화
-- ============================================================================

create or replace function public.admin_reset_user_data(
  p_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_target_is_admin boolean;
  v_target_is_system boolean;
  v_d_votes int;
  v_d_casts int;
  v_d_recs int;
  v_d_vote_reports int;
  v_d_reports int;
  v_d_inquiries int;
  v_d_unlocks int;
  v_d_ad_watches int;
  v_d_free_pass int;
  v_d_points int;
begin
  -- 인증/권한
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select coalesce(u.is_admin, false) into v_is_admin
  from public.users u where u.id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  -- 입력 검증
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason required' using errcode = '23514';
  end if;
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '23514';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot reset self' using errcode = '23514';
  end if;

  -- 대상 존재 + 보호 대상 차단
  select coalesce(u.is_admin, false), coalesce(u.is_system, false)
    into v_target_is_admin, v_target_is_system
    from public.users u where u.id = p_user_id;
  if not found then
    raise exception 'user not found' using errcode = 'P0001';
  end if;
  if v_target_is_admin then
    raise exception 'cannot reset admin user' using errcode = '23514';
  end if;
  if v_target_is_system then
    raise exception 'cannot reset system user' using errcode = '23514';
  end if;

  -- ============================================================
  -- 활동 테이블 정리 (cascade 주의: votes 먼저 → 본인 vote_casts/recs 정리)
  -- ============================================================

  -- 본인이 작성한 vote 삭제
  --   cascade: vote_options, vote_casts(타인 참여 포함), today_candidate_recommendations,
  --            vote_reports, reports(legacy), admin_moderation_actions
  --   set null: points_log.related_vote_id
  with d as (
    delete from public.votes where author_id = p_user_id returning 1
  )
  select count(*)::int into v_d_votes from d;

  -- 본인의 타인 vote 참여 삭제
  with d as (
    delete from public.vote_casts where user_id = p_user_id returning 1
  )
  select count(*)::int into v_d_casts from d;

  -- 본인의 후보 공감 삭제
  with d as (
    delete from public.today_candidate_recommendations where user_id = p_user_id returning 1
  )
  select count(*)::int into v_d_recs from d;

  -- 본인이 신고한 이력 (신규 vote_reports + legacy reports)
  with d as (
    delete from public.vote_reports where reporter_id = p_user_id returning 1
  )
  select count(*)::int into v_d_vote_reports from d;

  with d as (
    delete from public.reports where reporter_id = p_user_id returning 1
  )
  select count(*)::int into v_d_reports from d;

  -- 본인의 문의
  with d as (
    delete from public.inquiries where user_id = p_user_id returning 1
  )
  select count(*)::int into v_d_inquiries from d;

  -- 결과 unlock 이력
  with d as (
    delete from public.vote_unlocks where user_id = p_user_id returning 1
  )
  select count(*)::int into v_d_unlocks from d;

  -- 광고 시청 이력
  with d as (
    delete from public.ad_watches where user_id = p_user_id returning 1
  )
  select count(*)::int into v_d_ad_watches from d;

  -- 무료 패스 적립 이력
  with d as (
    delete from public.free_pass_grants where user_id = p_user_id returning 1
  )
  select count(*)::int into v_d_free_pass from d;

  -- 포인트 로그 (related_vote_id 가 set null 된 잔여행 포함 전체)
  with d as (
    delete from public.points_log where user_id = p_user_id returning 1
  )
  select count(*)::int into v_d_points from d;

  -- ============================================================
  -- users 부가 카운터 리셋
  -- ============================================================

  update public.users
  set register_blocked_until = null,
      consecutive_rejections = 0,
      daily_rejection_count = 0,
      daily_rejection_date = null,
      daily_moderation_calls = 0,
      daily_moderation_date = null,
      daily_ad_refund_count = 0,
      daily_ad_refund_date = null,
      current_streak = 0,
      last_voted_date = null,
      report_received_count = 0,
      free_pass_balance = 0
  where id = p_user_id;

  -- ============================================================
  -- 감사 로그
  -- ============================================================

  insert into public.admin_settings_audit
    (admin_id, action, target_key, prev_value, new_value, reason)
  values (
    v_uid,
    'reset_user_data',
    p_user_id::text,
    jsonb_build_object(
      'votes', v_d_votes,
      'vote_casts', v_d_casts,
      'today_candidate_recommendations', v_d_recs,
      'vote_reports', v_d_vote_reports,
      'reports', v_d_reports,
      'inquiries', v_d_inquiries,
      'vote_unlocks', v_d_unlocks,
      'ad_watches', v_d_ad_watches,
      'free_pass_grants', v_d_free_pass,
      'points_log', v_d_points
    ),
    jsonb_build_object('reset', true),
    p_reason
  );

  return jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object(
      'votes', v_d_votes,
      'vote_casts', v_d_casts,
      'today_candidate_recommendations', v_d_recs,
      'vote_reports', v_d_vote_reports,
      'reports', v_d_reports,
      'inquiries', v_d_inquiries,
      'vote_unlocks', v_d_unlocks,
      'ad_watches', v_d_ad_watches,
      'free_pass_grants', v_d_free_pass,
      'points_log', v_d_points
    ),
    'reset_columns', jsonb_build_array(
      'register_blocked_until',
      'consecutive_rejections',
      'daily_rejection_count', 'daily_rejection_date',
      'daily_moderation_calls', 'daily_moderation_date',
      'daily_ad_refund_count', 'daily_ad_refund_date',
      'current_streak', 'last_voted_date',
      'report_received_count', 'free_pass_balance'
    )
  );
end;
$$;

grant execute on function public.admin_reset_user_data(uuid, text) to authenticated;
