-- register_vote 의 일일 등록 카운트를 KST 자정 기준으로 변경
--
-- 버그:
--   기존 카운트 조건이 `created_at >= date_trunc('day', now()) at time zone 'utc'` 였음
--   → date_trunc('day', now()) 는 UTC 자정 (KST 09:00) 이라 KST 자정 초기화가 안 됨.
--   → 사용자 입장에서 자정에 등록 카운트가 0 으로 안 돌아오는 현상 발생.
--
-- 수정:
--   KST 자정 패턴 사용:
--     date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
--   다른 KST 기반 함수들과 동일 패턴 (예: fn_check_daily_payout_limit, fn_check_moderation_call).
--
-- 본문은 20260510000001 의 register_vote 와 동일, 카운트 조건 두 줄만 변경.

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
  v_kst_today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_rej_count int;
  v_rej_date date;
  v_ad_used boolean := false;
  v_free_pass_used boolean := false;
  v_setting_value jsonb;
  v_rejection_cap int;
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

  -- 일일 반려 캡 (admin_settings lookup)
  select value into v_setting_value
  from public.admin_settings where key = 'moderation_daily_rejection_cap';
  v_rejection_cap := coalesce((v_setting_value #>> '{}')::int, 5);

  if v_rej_date = v_today and coalesce(v_rej_count, 0) >= v_rejection_cap then
    raise exception 'daily rejection cap reached' using errcode = 'P0008';
  end if;

  if p_type = 'normal' then
    select count(*) into v_normal
    from public.votes
    where author_id = v_uid
      and type = 'normal'
      and created_at >= v_kst_today_start;

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
        v_free_pass_used := true;
      elsif coalesce(p_ad_used, false) then
        if not public.fn_consume_ad_token(v_uid, p_ad_token, 'register_3plus') then
          raise exception 'ad token invalid or expired' using errcode = 'P0007';
        end if;
        v_ad_used := true;
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
      and created_at >= v_kst_today_start;

    if v_today_cand >= 1 then
      raise exception 'daily today candidate cap reached' using errcode = 'P0002';
    end if;
  end if;

  insert into public.votes (
    author_id, question, category, type, status, duration_minutes,
    ad_used_at_register, free_pass_used_at_register
  )
  values (
    v_uid, trim(p_question), p_category, p_type, 'pending_review', p_duration_minutes,
    v_ad_used, v_free_pass_used
  )
  returning id into v_vote_id;

  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

  return v_vote_id;
end;
$$;

grant execute on function public.register_vote(text, text[], text, int, vote_type, boolean, boolean, text) to authenticated;

-- get_register_status — 클라이언트가 "오늘 X/10 등록" 표시에 사용
-- 같은 UTC 자정 버그가 있어 KST 자정 패턴으로 수정.
create or replace function public.get_register_status()
returns table (
  normal_count_today int,
  today_candidate_count_today int,
  next_normal_requires_ad boolean,
  normal_cap_reached boolean,
  today_candidate_cap_reached boolean,
  register_blocked boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid;
  v_normal int;
  v_today_cand int;
  v_blocked timestamptz;
  v_kst_today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select count(*) into v_normal
  from public.votes
  where author_id = v_uid
    and type = 'normal'
    and created_at >= v_kst_today_start;

  select count(*) into v_today_cand
  from public.votes
  where author_id = v_uid
    and type = 'today_candidate'
    and created_at >= v_kst_today_start;

  select register_blocked_until into v_blocked
  from public.users where id = v_uid;

  return query select
    v_normal,
    v_today_cand,
    (v_normal >= 2 and v_normal < 10),
    v_normal >= 10,
    v_today_cand >= 1,
    coalesce(v_blocked > now(), false);
end;
$$;

grant execute on function public.get_register_status() to authenticated;
