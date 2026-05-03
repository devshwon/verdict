-- point_status enum 확장 (하이브리드 수령 시스템 1단계)
--
-- PG14+ 에서 ALTER TYPE ADD VALUE는 트랜잭션 내에서 가능하지만,
-- 같은 트랜잭션에서 새 값을 사용하면 fail 함. 따라서 별도 마이그레이션으로 분리.
--
-- 추가 값:
--   - 'unclaimed' : 적립됐으나 사용자가 아직 수령 버튼 누르지 않음 (수동 수령 트리거 전용)
--   - 'expired'   : 7일 미수령으로 자동 소멸 (cron 처리)
--
-- 기존 값:
--   - 'pending'  : 수령 완료 (자동 트리거) 또는 클레임 후 → worker 지급 대기
--   - 'completed': worker가 토스 비즈월렛 지급 완료
--   - 'failed'   : worker 지급 실패 (재시도 큐 별도 운영)

alter type point_status add value if not exists 'unclaimed';
alter type point_status add value if not exists 'expired';
