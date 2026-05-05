-- vote_status에 'pending_review' 추가 (Claude API 검열 진행 중 상태)
-- 기획서 §6 2단계: 등록 즉시 active가 아니라 검열 통과 후 active로 전환
--
-- 기존 RLS는 SELECT를 'active'/'closed'로만 제한해두었기 때문에 본인을 제외한
-- 사용자는 'pending_review' 상태의 투표를 자동으로 보지 못한다(추가 RLS 변경 불필요).
-- 본인은 author_id 매칭으로 자기 검열 중 게시물을 확인할 수 있다.
--
-- 주의: ALTER TYPE ... ADD VALUE는 같은 트랜잭션에서 추가한 값을 즉시 참조할 수
-- 없으므로 이 마이그레이션에서는 enum 값만 추가하고, 기본값/기타 참조는 후속
-- 마이그레이션 또는 애플리케이션 레이어에서 처리한다.

alter type vote_status add value if not exists 'pending_review' before 'active';

-- TODO (별도 마이그레이션): 등록 Edge Function이 도입되면 votes.status 기본값을
-- 'pending_review'로 변경하여 클라이언트 직접 INSERT 시에도 검열 게이트를 통과해야
-- 피드 노출되도록 강제. 현 단계(1·2번 화면 진행)에서는 INSERT 경로가 없어 영향 없음.
