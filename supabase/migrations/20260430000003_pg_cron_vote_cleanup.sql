-- 투표 보관 정책 자동화 (기획서 §12)
--   §12-1 일반 투표: 마감일로부터 30일 후 삭제
--   §12-2 오늘의 투표: 마감일로부터 180일 후 삭제 (v1.5에서 영구 보관 → 6개월로 변경)
--
-- Supabase Cloud의 pg_cron은 Database → Extensions 패널에서 활성화 필요.
-- 이 마이그레이션은 extension을 시도 생성하고 잡을 등록한다.
-- pg_cron은 UTC 기준으로 스케줄 실행됨.

create extension if not exists pg_cron with schema extensions;

-- ============================================================================
-- 일반 투표: 마감 후 30일 자동 삭제
-- ============================================================================

select cron.schedule(
  'cleanup-normal-votes-30d',
  '0 4 * * *',  -- 매일 04:00 UTC (= 13:00 KST)
  $$
    delete from public.votes
    where type = 'normal'
      and closed_at < now() - interval '30 days'
  $$
);

-- ============================================================================
-- 오늘의 투표: 마감 후 180일 자동 삭제
-- ============================================================================

select cron.schedule(
  'cleanup-today-votes-180d',
  '10 4 * * *', -- 매일 04:10 UTC (일반 투표 잡 이후 실행)
  $$
    delete from public.votes
    where type = 'today'
      and closed_at < now() - interval '180 days'
  $$
);

-- ============================================================================
-- 비고
-- ============================================================================
-- 1. today_candidate (오늘의 투표 후보 미선정분) 정리 정책은 별도 결정 후 추가.
--    단순히 closed_at 기반 삭제로는 부족(후보군 자체에 마감 개념이 없을 수 있음).
-- 2. 삭제 시 vote_casts / vote_options는 ON DELETE CASCADE로 함께 정리됨.
-- 3. points_log.related_vote_id는 이전 마이그레이션에서 ON DELETE SET NULL로 변경되어
--    투표 삭제 후에도 정산 기록은 anonymize된 형태로 보존됨.
-- 4. 잡 해제: select cron.unschedule('cleanup-normal-votes-30d');
