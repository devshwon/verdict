-- Claude API 검열 도입 (기획서 §6 2단계, 백로그 §S1)
--
-- 변경 흐름:
--   1) votes.status 기본값을 'active' → 'pending_review'로 변경
--   2) rejection_reason 컬럼 추가 (작성자 본인만 SELECT 가능 — 기존 RLS로 자동 보장)
--   3) register_vote RPC가 'pending_review'로 INSERT (active 백도어 차단)
--   4) Edge Function moderate-vote가 service_role로 votes UPDATE (status, ai_score, rejection_reason)
--
-- RLS 영향:
--   기존 votes_public_select 정책: "auth.uid() = author_id OR (authenticated AND status IN ('active','closed'))"
--   → 검열 중인 vote는 본인만 보임. 검열 통과 후 active로 전환되면 모두 노출.

-- ============================================================================
-- 1. votes.status 기본값 변경
-- ============================================================================

alter table public.votes alter column status set default 'pending_review';

-- ============================================================================
-- 2. rejection_reason 컬럼 추가
-- ============================================================================

alter table public.votes
  add column rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500);

-- ============================================================================
-- 3. register_vote RPC 갱신 — 'pending_review'로 INSERT
-- ============================================================================

drop function if exists public.register_vote(text, text[], text, int, vote_type, boolean, boolean);

create or replace function public.register_vote(
  p_question text,
  p_options text[],
  p_category text,
  p_duration_minutes int,
  p_type vote_type,
  p_ad_used boolean default false,
  p_use_free_pass boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_normal int;
  v_today_cand int;
  v_vote_id uuid;
  v_idx int;
  v_blocked timestamptz;
  v_option text;
  v_opt_count int;
  v_pass_remaining int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  if p_question is null or char_length(trim(p_question)) = 0 then
    raise exception 'question required' using errcode = '23514';
  end if;
  if char_length(trim(p_question)) > 60 then
    raise exception 'question too long' using errcode = '23514';
  end if;

  v_opt_count := coalesce(array_length(p_options, 1), 0);
  if v_opt_count < 2 or v_opt_count > 5 then
    raise exception 'option count must be 2~5' using errcode = '23514';
  end if;
  for v_idx in 1..v_opt_count loop
    v_option := trim(p_options[v_idx]);
    if char_length(v_option) = 0 or char_length(v_option) > 30 then
      raise exception 'invalid option text at %', v_idx using errcode = '23514';
    end if;
  end loop;

  if p_duration_minutes not in (10, 30, 60, 360, 1440) then
    raise exception 'invalid duration' using errcode = '23514';
  end if;
  if p_category not in ('daily', 'relationship', 'work', 'game', 'etc') then
    raise exception 'invalid category' using errcode = '23514';
  end if;
  if p_type not in ('normal', 'today_candidate') then
    raise exception 'invalid type for self-register' using errcode = '23514';
  end if;

  select register_blocked_until into v_blocked
  from public.users where id = v_uid;
  if v_blocked is not null and v_blocked > now() then
    raise exception 'register blocked until %', v_blocked using errcode = 'P0003';
  end if;

  if p_type = 'normal' then
    select count(*) into v_normal
    from public.votes
    where author_id = v_uid
      and type = 'normal'
      and created_at >= date_trunc('day', now()) at time zone 'utc';

    if v_normal >= 10 then
      raise exception 'daily normal cap reached' using errcode = 'P0002';
    end if;

    if v_normal >= 2 then
      if coalesce(p_use_free_pass, false) then
        update public.users
        set free_pass_balance = free_pass_balance - 1
        where id = v_uid
          and free_pass_balance > 0
        returning free_pass_balance into v_pass_remaining;

        if not found then
          raise exception 'free pass not available' using errcode = 'P0006';
        end if;
      elsif not coalesce(p_ad_used, false) then
        raise exception 'ad or free pass required for 3rd+ normal vote' using errcode = 'P0004';
      end if;
    end if;

  elsif p_type = 'today_candidate' then
    if coalesce(p_use_free_pass, false) then
      raise exception 'free pass not applicable to today_candidate' using errcode = 'P0006';
    end if;

    select count(*) into v_today_cand
    from public.votes
    where author_id = v_uid
      and type = 'today_candidate'
      and created_at >= date_trunc('day', now()) at time zone 'utc';

    if v_today_cand >= 1 then
      raise exception 'daily today candidate cap reached' using errcode = 'P0002';
    end if;
  end if;

  -- ★ pending_review 상태로 INSERT — Claude 검열 통과 후 active로 전환됨
  insert into public.votes (author_id, question, category, type, status, duration_minutes)
  values (v_uid, trim(p_question), p_category, p_type, 'pending_review', p_duration_minutes)
  returning id into v_vote_id;

  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

  -- 보상 적립은 검열 통과 여부와 무관하게 즉시 적립 (반려 시 별도 회수 정책 — 백로그)
  -- 단, 검열 통과 전엔 피드 노출 안 되므로 100명 보너스 등은 자연 차단
  if p_type = 'normal' and v_normal < 2 then
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
    values (
      v_uid, 'normal_vote_register', 2,
      'normal_vote_register:' || v_uid::text || ':' || v_vote_id::text,
      v_vote_id
    );
  elsif p_type = 'today_candidate' then
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
    values (
      v_uid, 'today_candidate_register', 5,
      'today_candidate_register:' || v_uid::text || ':' || v_vote_id::text,
      v_vote_id
    );
  end if;

  return v_vote_id;
end;
$$;

grant execute on function public.register_vote(text, text[], text, int, vote_type, boolean, boolean) to authenticated;

-- ============================================================================
-- 4. TODO (별도 후속):
--   - 검열 결과 fallback: 5분 이상 pending_review 상태인 vote는 운영자 큐로 이관
--   - 검열 반려 vote의 보상 회수 정책 (현재는 등록 보상이 적립된 채 남음)
--   - 30일 내 유사도 검사를 위한 임베딩 컬럼 추가 (pgvector)
-- ============================================================================
