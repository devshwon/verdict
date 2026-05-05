-- 검열 어뷰징 방어 + 보상 적립 시점 이동
--
-- 배경:
--   1) 등록 카운트는 그대로 증가시키되, 보상 포인트는 검열 통과 시점에만 적립
--   2) 1~2건째 카드는 광고/이용권 게이트가 없어 reject 무한 반복 시 OpenAI 호출 비용만 누적
--      → 일일 반려 캡(5회), 연속 반려 자동 정지(3회 → 1시간), 일일 검열 호출 캡(20회) 도입
--   3) register_vote 시점 points_log INSERT 제거 (검열 통과 후 fn_record_moderation_result에서 적립)
--
-- 에러 코드 추가:
--   P0008 — 일일 반려 한도 초과 (어뷰징 방어)

-- ============================================================================
-- 1. users 테이블 카운터 컬럼 추가
-- ============================================================================

alter table public.users
  add column consecutive_rejections int not null default 0 check (consecutive_rejections >= 0),
  add column daily_rejection_count int not null default 0 check (daily_rejection_count >= 0),
  add column daily_rejection_date date,
  add column daily_moderation_calls int not null default 0 check (daily_moderation_calls >= 0),
  add column daily_moderation_date date;

-- ============================================================================
-- 2. fn_check_moderation_call — 일일 검열 호출 캡 (cost 안전망)
--    OpenAI 호출 직전에 호출. 호출 가능하면 카운터 증가 후 true, 캡 도달 시 false.
-- ============================================================================

create or replace function public.fn_check_moderation_call(
  p_user_id uuid,
  p_daily_cap int default 20
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_count int;
  v_date date;
begin
  select daily_moderation_calls, daily_moderation_date
  into v_count, v_date
  from public.users where id = p_user_id
  for update;

  if v_date is distinct from v_today then
    update public.users
    set daily_moderation_calls = 1,
        daily_moderation_date = v_today
    where id = p_user_id;
    return true;
  end if;

  if coalesce(v_count, 0) >= p_daily_cap then
    return false;
  end if;

  update public.users
  set daily_moderation_calls = coalesce(daily_moderation_calls, 0) + 1
  where id = p_user_id;
  return true;
end;
$$;

grant execute on function public.fn_check_moderation_call(uuid, int) to service_role;

-- ============================================================================
-- 3. fn_record_moderation_result — 검열 결과 기록 + 보상 적립 / 반려 카운터
--
--   approved=true:
--     - consecutive_rejections 리셋
--     - 보상 적립 (1~2건째 normal_vote_register 2P, today_candidate_register 5P)
--       eligibility는 등록 시점 v_normal에서 판정 (호출자가 전달)
--   approved=false:
--     - consecutive_rejections / daily_rejection_count 증가
--     - 연속 3회 반려 → register_blocked_until = now()+1h, 카운터 리셋
-- ============================================================================

create or replace function public.fn_record_moderation_result(
  p_vote_id uuid,
  p_user_id uuid,
  p_vote_type vote_type,
  p_eligible_for_register_reward boolean,
  p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_consecutive int;
begin
  if p_approved then
    update public.users
    set consecutive_rejections = 0
    where id = p_user_id;

    if p_eligible_for_register_reward then
      if p_vote_type = 'normal' then
        insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
        values (
          p_user_id, 'normal_vote_register', 2,
          'normal_vote_register:' || p_user_id::text || ':' || p_vote_id::text,
          p_vote_id
        )
        on conflict (idempotency_key) do nothing;
      elsif p_vote_type = 'today_candidate' then
        insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
        values (
          p_user_id, 'today_candidate_register', 5,
          'today_candidate_register:' || p_user_id::text || ':' || p_vote_id::text,
          p_vote_id
        )
        on conflict (idempotency_key) do nothing;
      end if;
    end if;
  else
    update public.users
    set consecutive_rejections = consecutive_rejections + 1,
        daily_rejection_count = case
          when daily_rejection_date is distinct from v_today then 1
          else daily_rejection_count + 1
        end,
        daily_rejection_date = v_today
    where id = p_user_id
    returning consecutive_rejections into v_consecutive;

    if coalesce(v_consecutive, 0) >= 3 then
      update public.users
      set register_blocked_until = greatest(
            coalesce(register_blocked_until, now()),
            now() + interval '1 hour'
          ),
          consecutive_rejections = 0
      where id = p_user_id;
    end if;
  end if;
end;
$$;

grant execute on function public.fn_record_moderation_result(uuid, uuid, vote_type, boolean, boolean) to service_role;

-- ============================================================================
-- 4. register_vote 갱신 — points_log INSERT 제거 + 일일 반려 캡 P0008
-- ============================================================================

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
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_rej_count int;
  v_rej_date date;
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

  select register_blocked_until, daily_rejection_count, daily_rejection_date
  into v_blocked, v_rej_count, v_rej_date
  from public.users where id = v_uid;
  if v_blocked is not null and v_blocked > now() then
    raise exception 'register blocked until %', v_blocked using errcode = 'P0003';
  end if;

  -- 일일 반려 한도 (어뷰징 방어): 같은 날 5회 이상 반려 시 차단 — OpenAI 호출 비용 상한 고정
  if v_rej_date = v_today and coalesce(v_rej_count, 0) >= 5 then
    raise exception 'daily rejection cap reached' using errcode = 'P0008';
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

  -- ★ 보상 적립 제거 — 검열 통과 후 fn_record_moderation_result에서 적립
  -- 어뷰저가 등록 → 반려 무한 반복으로 포인트만 쌓는 패턴 차단

  return v_vote_id;
end;
$$;

grant execute on function public.register_vote(text, text[], text, int, vote_type, boolean, boolean, text) to authenticated;
