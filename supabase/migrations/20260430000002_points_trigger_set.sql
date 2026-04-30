-- points_log.trigger CHECK 재정의 (기획서 §7-1 v1.6 반영)
-- 트랙별 prefix 분리: normal_* / today_* / streak_*
-- 변경 이유:
--   1. 기존 4종은 일반 투표 참여(1P)·3건 완료 보너스·등록 보상 등 핵심 트리거가 누락
--   2. 일반/오늘의 투표 트랙을 분리해 향후 정산·통계·프로모션 시 별도 운영 가능

alter table public.points_log
  drop constraint points_log_trigger_check;

alter table public.points_log
  add constraint points_log_trigger_check
  check (trigger in (
    -- 일반 투표 트랙
    'normal_vote_participation',         -- 일반 투표 참여 1P/건 (하루 3건)
    'normal_daily_3vote_complete',       -- 3건 완료 보너스 +1P (1회/일)
    'normal_streak_3d',                  -- 출석 스트릭 3일 +1P
    'normal_streak_7d',                  -- 출석 스트릭 7일 +3P
    'normal_streak_30d',                 -- 출석 스트릭 30일 +20P
    'normal_vote_register',              -- 일반 투표 등록 1~2건 2P/건
    'normal_100_participants_bonus',     -- 등록한 일반 투표 100명 달성 +3P/100명 (캡 30P)
    -- 오늘의 투표 트랙
    'today_candidate_register',          -- 오늘의 투표 후보 신청 5P (1인 1일 1건)
    'today_selection'                    -- 오늘의 투표 당선 +30P + 50명당 +5P (캡 100P, 작성 5P 별도)
  ));

-- 인덱스: 트랙별 정산 쿼리에서 prefix 기반 조회를 자주 할 가능성이 높음
create index idx_points_log_trigger on public.points_log(trigger, created_at desc);
