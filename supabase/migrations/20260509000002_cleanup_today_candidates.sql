-- today_candidate 자동 정리 — 등록 후 2일 경과 시 hard delete
--
-- 배경:
--   - today_candidate은 다음날 운영자 선정용 후보.
--   - 다음날까지 선정 안 되면 의미 없는 데이터 → 영구 잔존 방지.
--   - 기존 cleanup cron(`cleanup-normal-votes-30d`, `cleanup-today-votes-180d`)은
--     type='normal'/'today'만 다뤘음 (`20260430000003` §비고 참고).
--
-- 정책:
--   - created_at < now() - 2 days 인 today_candidate 모두 삭제 (선정/미선정 무관)
--   - 선정된 후보는 promote_today_candidates RPC가 type='today'로 전환하므로 본 잡 대상 아님
--   - 봇 명의 today_candidate는 사실상 발생 안 함 (봇은 admin_create_today_vote로 type='today' 직행)

select cron.schedule(
  'cleanup-today-candidates-2d',
  '20 4 * * *',  -- 매일 04:20 UTC (= 13:20 KST). 기존 잡들(04:00, 04:10) 이후 실행
  $$
    delete from public.votes
    where type = 'today_candidate'
      and created_at < now() - interval '2 days'
  $$
);

-- ============================================================================
-- 해제: select cron.unschedule('cleanup-today-candidates-2d');
-- ============================================================================
