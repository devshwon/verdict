-- fn_increment_participants 를 security definer 로 변경
--
-- 버그:
--   기존 함수가 security invoker (default) — caller 권한으로 votes UPDATE 시도.
--   일반 사용자가 다른 사람 vote row 에 update 권한이 없어 RLS 가 silently 차단.
--   → vote_casts INSERT 는 성공하지만 votes.participants_count 가 +1 안 됨.
--   → OverallResult 의 분모(row.participants_count) 가 stale → 자기 표 비율 반영 안 됨.
--   → 반면 v_vote_results.total_count 는 vote_casts COUNT 라 정상 카운트되므로
--      성별/연령대 stats 는 정상 동작 (사용자가 본 현상과 일치).
--
-- 수정:
--   security definer 로 변경 → 함수 owner (postgres) 권한으로 votes UPDATE.
--   기존 트리거 정의(after insert)는 그대로 유지.
--
-- 후속:
--   기존 vote_casts 의 누락분 backfill — 본 마이그레이션 끝에 1회 재집계.

create or replace function public.fn_increment_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.votes
  set participants_count = participants_count + 1
  where id = new.vote_id;
  return new;
end;
$$;

-- 누락된 카운트 backfill — 모든 vote 의 participants_count 를 실제 cast 수로 재계산
update public.votes v
set participants_count = sub.cnt
from (
  select c.vote_id, count(*)::int as cnt
  from public.vote_casts c
  group by c.vote_id
) sub
where v.id = sub.vote_id
  and v.participants_count <> sub.cnt;

-- cast 가 0 건인 vote 도 보정 (만약 음수 등 이상값 있으면 0 으로)
update public.votes v
set participants_count = 0
where participants_count <> 0
  and not exists (
    select 1 from public.vote_casts c where c.vote_id = v.id
  );
