-- 토스 프로모션 매핑 INSERT 템플릿
--
-- 사용법:
--   1) 토스 콘솔 검수 통과 → 각 프로모션의 promotionId 복사
--   2) 아래 'PASTE_PROMOTION_ID_HERE' 자리에 붙여넣기
--   3) Supabase SQL Editor에서 실행
--
-- 검증:
--   select * from public.toss_promotions order by trigger;
--
-- 운영 전환 (test_mode=true → false):
--   update public.toss_promotions set test_mode = false;
--
-- 단일 프로모션만 운영 전환:
--   update public.toss_promotions set test_mode = false where trigger = 'normal_vote_participation';

insert into public.toss_promotions (trigger, promotion_id, promotion_name, test_mode, notes)
values
  ('normal_vote_participation',     'PASTE_PROMOTION_ID_HERE', '투표 참여 1포인트',          true, '1번. 1일 5회 자연 발생'),
  ('normal_daily_5vote_complete',   'PASTE_PROMOTION_ID_HERE', '5건 투표 완료 보너스',       true, '2번. 1일 1회'),
  ('normal_daily_attendance',       'PASTE_PROMOTION_ID_HERE', '매일 출석',                  true, '3번. 1일 1회 자동'),
  ('normal_streak_10day',           'PASTE_PROMOTION_ID_HERE', '10일 연속 출석 보너스',      true, '4번. 끊김 후 재도달 가능'),
  ('normal_streak_20day',           'PASTE_PROMOTION_ID_HERE', '20일 연속 출석 보너스',      true, '5번'),
  ('normal_streak_30plus',          'PASTE_PROMOTION_ID_HERE', '장기 출석 보너스',           true, '6번. 30·40·50…일'),
  ('normal_vote_register',          'PASTE_PROMOTION_ID_HERE', '질문 등록 보상',             true, '7번. 검열 통과 후 지급'),
  ('today_candidate_register',      'PASTE_PROMOTION_ID_HERE', '오늘의 투표 후보 신청',      true, '8번'),
  ('today_selection',               'PASTE_PROMOTION_ID_HERE', '오늘의 투표 당선',           true, '9번')
on conflict (trigger) do update set
  promotion_id = excluded.promotion_id,
  promotion_name = excluded.promotion_name,
  test_mode = excluded.test_mode,
  notes = excluded.notes;

-- 추후 100명 보너스 트리거 wire-up 후 추가:
-- insert into public.toss_promotions (trigger, promotion_id, promotion_name, test_mode, notes)
-- values ('normal_100_participants_bonus', 'PASTE_PROMOTION_ID_HERE', '100명 달성 보너스', true, '추후 등록');
