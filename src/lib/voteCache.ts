/**
 * 클라이언트 in-memory vote 상태 캐시.
 *
 * 사용처:
 * - VoteDetail에서 투표 성공 시 set → 홈 피드 재진입 시 즉시 결과 바 노출
 * - fetchFeedVotes / fetchVoteDetail이 결과 mapping 시 overlay
 *
 * 정합성: 캐시는 "내가 투표함"이라는 한 방향 단조 증가 정보만 들고 있어
 * 서버보다 더 최신이지 더 옛것이 될 수 없다. 따라서 overlay는 항상 안전.
 *
 * 페이지 새로고침 시 휘발 (sessionStorage 미사용 — 서버가 source of truth).
 */

type CastEntry = { optionId: string; castedAt: number };

const cache = new Map<string, CastEntry>();
const target = new EventTarget();

const EVENT = "vote-cache-change";

export function recordMyCast(voteId: string, optionId: string): void {
  cache.set(voteId, { optionId, castedAt: Date.now() });
  target.dispatchEvent(new Event(EVENT));
}

export function getMyCast(voteId: string): string | null {
  return cache.get(voteId)?.optionId ?? null;
}

export function hasMyCast(voteId: string): boolean {
  return cache.has(voteId);
}

export function subscribeVoteCache(listener: () => void): () => void {
  target.addEventListener(EVENT, listener);
  return () => target.removeEventListener(EVENT, listener);
}

export function clearVoteCache(): void {
  cache.clear();
  target.dispatchEvent(new Event(EVENT));
}
