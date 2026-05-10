-- 일반 투표 100명 달성 보너스 — 자동 적립 트리거
--
-- 정책 (pickit_plan.md §7-1):
--   - 본인이 등록한 일반 투표 (type='normal') 의 participants_count 가
--     100, 200, 300, ..., 1000 마일스톤에 도달할 때마다 작성자에게 +3P
--   - 건당 캡 30P (= 1000명까지 누적, 1100명부터는 미지급)
--   - 콘텐츠 트랙 (일일 합산 130P 한도에 포함)
--   - 적립 상태 'unclaimed' — 마이페이지 "받기" 버튼으로 수령 (다른 마일스톤들과 동일 흐름)
--
-- 동작:
--   - vote_casts INSERT 후 fn_increment_participants 가 votes.participants_count +1
--   - 본 트리거가 같은 INSERT 후 fn_award_normal_100_milestone 호출
--     → 갱신된 participants_count 가 100 의 배수이고 1000 이하이면 적립
--   - 봇 계정 (users.is_system=true) 은 적립 제외 (보상 대상 아님)
--   - 검열 미통과 (status NOT IN ('active','closed')) 인 vote 는 적립 제외 (blinded/deleted/pending_review)
--   - idempotency_key: 'normal_100_participants_bonus:<vote_id>:<milestone>'
--     → 동일 마일스톤 중복 INSERT 방지 (vote_casts 가 어떤 이유로 다시 트리거되어도 안전)
--
-- 토스 프로모션 매핑:
--   - admin SPA 의 TossPromotionsPage 에서 'normal_100_participants_bonus' 매핑 등록 필요
--   - 미매핑 시 payout-points 워커가 'unmapped' 처리 (적립은 정상 진행)

create or replace function public.fn_award_normal_100_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote record;
  v_author_is_system boolean;
  v_milestone int;
begin
  -- 갱신된 vote 정보 조회 (fn_increment_participants 가 먼저 실행되어 participants_count 가 +1 된 상태)
  select v.id, v.author_id, v.type, v.status, v.participants_count
  into v_vote
  from public.votes v
  where v.id = new.vote_id;

  -- 일반 투표만 대상
  if v_vote.type is distinct from 'normal' then
    return new;
  end if;

  -- 검열 통과 상태만 대상 (blinded/deleted/pending_review 제외)
  if v_vote.status not in ('active', 'closed') then
    return new;
  end if;

  -- 100 의 배수가 아니면 종료
  if v_vote.participants_count is null
     or v_vote.participants_count <= 0
     or (v_vote.participants_count % 100) <> 0 then
    return new;
  end if;

  -- 캡: 1000명 초과는 적립 없음 (3P × 10회 = 30P/건)
  if v_vote.participants_count > 1000 then
    return new;
  end if;

  -- 봇 계정(is_system) 작성 vote 는 적립 제외
  select coalesce(u.is_system, false) into v_author_is_system
  from public.users u where u.id = v_vote.author_id;

  if v_author_is_system then
    return new;
  end if;

  v_milestone := v_vote.participants_count;

  -- 적립 (idempotency_key 로 중복 방지)
  insert into public.points_log (
    user_id, trigger, amount, idempotency_key, related_vote_id, status
  )
  values (
    v_vote.author_id,
    'normal_100_participants_bonus',
    3,
    'normal_100_participants_bonus:' || v_vote.id::text || ':' || v_milestone::text,
    v_vote.id,
    'unclaimed'
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

-- vote_casts AFTER INSERT — fn_increment_participants 다음에 실행되도록
-- (트리거 실행 순서는 알파벳순 — 'trg_vote_casts_increment_count' 가 'trg_vote_casts_normal_100_milestone' 보다 먼저)
create trigger trg_vote_casts_normal_100_milestone
after insert on public.vote_casts
for each row execute function public.fn_award_normal_100_milestone();
