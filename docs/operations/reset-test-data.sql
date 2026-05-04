-- 테스트 데이터 일괄 리셋 (베타/QA용)
--
-- 보존:
--   • toss_promotions          (config)
--   • auth.users / public.users (계정 — 다시 로그인 안 해도 됨)
--   • users 컬럼 중 신원성 값  (toss_user_key, gender_raw/age_bucket_raw, *_public, is_admin, created_at)
--
-- 삭제:
--   • votes (cascade → vote_options, vote_casts, today_candidate_recommendations, vote_unlocks, reports)
--   • points_log
--   • ad_watches
--   • free_pass_grants
--
-- 리셋 (보존하되 0/null로 초기화):
--   • users.current_streak / last_voted_date
--   • users.free_pass_balance
--   • users.register_blocked_until
--   • users.consecutive_rejections / daily_rejection_* / daily_moderation_*
--
-- 사용 방법:
--   1) Supabase Dashboard → SQL Editor 열기
--   2) 이 파일 전체 복사 → 붙여넣기 → Run
--   3) 마지막 SELECT 결과로 각 테이블 row 0 확인
--
-- 옵션 — 계정까지 전부 날리고 토스 재로그인부터 다시 하고 싶을 땐
-- 파일 맨 아래 "FULL WIPE (계정 포함)" 블록의 주석을 풀어 같이 실행.

begin;

-- 1. 컨텐츠 + 행동 기록 wipe
truncate table
  public.votes,                              -- cascade로 vote_options/vote_casts/today_candidate_recommendations/vote_unlocks/reports 동시 삭제
  public.points_log,
  public.ad_watches,
  public.free_pass_grants
restart identity cascade;

-- 2. users 상태 리셋 (계정 자체는 보존)
update public.users
set
  current_streak          = 0,
  last_voted_date         = null,
  free_pass_balance       = 0,
  register_blocked_until  = null,
  consecutive_rejections  = 0,
  daily_rejection_count   = 0,
  daily_rejection_date    = null,
  daily_moderation_calls  = 0,
  daily_moderation_date   = null;

commit;

-- 3. 검증 — 모두 0이면 정상
select 'votes'                as table, count(*) from public.votes
union all
select 'vote_options',                  count(*) from public.vote_options
union all
select 'vote_casts',                    count(*) from public.vote_casts
union all
select 'today_candidate_recommendations', count(*) from public.today_candidate_recommendations
union all
select 'vote_unlocks',                  count(*) from public.vote_unlocks
union all
select 'reports',                       count(*) from public.reports
union all
select 'points_log',                    count(*) from public.points_log
union all
select 'ad_watches',                    count(*) from public.ad_watches
union all
select 'free_pass_grants',              count(*) from public.free_pass_grants
union all
select 'users (보존)',                   count(*) from public.users
union all
select 'toss_promotions (보존)',         count(*) from public.toss_promotions;


-- ─────────────────────────────────────────────────────────────────────────
-- (선택) FULL WIPE — 계정까지 전부 삭제하고 토스 로그인부터 다시 시작
-- 주의: auth.users 삭제 시 public.users는 cascade로 같이 삭제됨.
--       토스 재로그인하면 같은 toss_user_key로 새 row가 생성됨.
-- 사용 시 아래 BEGIN ~ COMMIT 블록의 /* */ 주석만 해제 후 실행.
-- ─────────────────────────────────────────────────────────────────────────
/*
begin;
delete from auth.users
where email like 'toss_%@verdict.local';   -- 토스 합성 이메일만 정리 (실 운영자 계정 보호)
commit;
*/
