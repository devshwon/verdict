-- ============================================================================
-- 투표 기간 옵션 변경: (10, 30, 60, 360, 1440) → (5, 10, 30, 60)
--
-- 변경 사유: 24시간 / 6시간은 흥미 반감 + 재방문 동기 약화. 5분 즉흥 옵션 추가로
--           "지금 이 순간" UX 강화 (기획 §8 v2)
--
-- 적용 범위:
-- 1. votes 테이블 CHECK 제약 갱신
-- 2. register_vote RPC 검증 갱신
-- ============================================================================

-- 1. CHECK 제약 갱신 (legacy 6h/24h 데이터가 있으면 본 마이그레이션 실패 — dev 단계라 가정)
alter table public.votes drop constraint if exists votes_duration_minutes_check;
alter table public.votes
  add constraint votes_duration_minutes_check
  check (duration_minutes in (5, 10, 30, 60));

-- 2. register_vote 갱신 — 검증 라인만 (5, 10, 30, 60)으로 교체, 그 외 동일
drop function if exists public.register_vote(text, text[], text, int, vote_type, boolean, boolean, text);

create or replace function public.register_vote(
  p_question text,
  p_options text[],
  p_category text,
  p_duration_minutes int,
  p_type vote_type,
  p_ad_used boolean default false,
  p_use_free_pass boolean default false,
  p_ad_token text default null
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

  if p_duration_minutes not in (5, 10, 30, 60) then
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
      elsif coalesce(p_ad_used, false) then
        if not public.fn_consume_ad_token(v_uid, p_ad_token, 'register_3plus') then
          raise exception 'ad token invalid or expired' using errcode = 'P0007';
        end if;
      else
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

  insert into public.votes (author_id, question, category, type, status, duration_minutes)
  values (v_uid, trim(p_question), p_category, p_type, 'pending_review', p_duration_minutes)
  returning id into v_vote_id;

  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

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

grant execute on function public.register_vote(text, text[], text, int, vote_type, boolean, boolean, text) to authenticated;
