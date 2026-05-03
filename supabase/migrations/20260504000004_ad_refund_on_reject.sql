-- 광고 보호 환급 — 등록용 광고 시청 후 LLM 검열 반려 시 무료이용권 1개 환급
--
-- 배경:
--   광고 시청(register_3plus) → 등록 → 검열 반려 시 사용자 입장에서는 광고만 본 손실.
--   재시도하려면 또 광고. 이탈 가속 우려.
--   → 검열 반려 시 무료이용권 1개 환급해 재시도 시 광고 없이 1회 사용 가능
--
-- 환급 조건 (모두 충족):
--   1) 검열 결과 반려 (approved=false)
--   2) 등록 시 광고 사용 (ad_used_at_register=true)
--   3) 반려 사유가 OpenAI 검열 (rejection_source='llm')
--      — 사전 휴리스틱(짧은 글/반복 문자/선택지 중복)은 명백한 어뷰징 패턴이라 환급 안 함
--      — 일일 호출 캡(call_cap) 도달은 시스템 한도라 환급 안 함
--
-- 일일 환급 캡: 사용자당 2개 (어뷰징 추가 차단)

-- ============================================================================
-- 1. votes — 등록 시점 광고 사용 여부 컬럼 추가
-- ============================================================================

alter table public.votes
  add column ad_used_at_register boolean not null default false;

-- ============================================================================
-- 2. users — 일일 환급 카운터
-- ============================================================================

alter table public.users
  add column daily_ad_refund_count int not null default 0 check (daily_ad_refund_count >= 0),
  add column daily_ad_refund_date date;

-- ============================================================================
-- 3. register_vote 갱신 — ad_used_at_register 저장
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
  v_ad_used boolean := false;
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
      and created_at >= date_trunc('day', now()) at time zone 'utc';

    if v_today_cand >= 1 then
      raise exception 'daily today candidate cap reached' using errcode = 'P0002';
    end if;
  end if;

  insert into public.votes (
    author_id, question, category, type, status, duration_minutes, ad_used_at_register
  )
  values (
    v_uid, trim(p_question), p_category, p_type, 'pending_review', p_duration_minutes, v_ad_used
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

-- ============================================================================
-- 4. fn_record_moderation_result 갱신 — rejection_source 추가, 광고 보호 환급 로직
-- ============================================================================

drop function if exists public.fn_record_moderation_result(uuid, uuid, vote_type, boolean, boolean);

create or replace function public.fn_record_moderation_result(
  p_vote_id uuid,
  p_user_id uuid,
  p_vote_type vote_type,
  p_eligible_for_register_reward boolean,
  p_approved boolean,
  p_rejection_source text default null  -- approved=false 시: 'llm' | 'prescreen' | 'call_cap'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_consecutive int;
  v_ad_used boolean;
  v_refund_count int;
  v_refund_date date;
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
    -- 시스템 한도(call_cap)는 카운터/정지 누적 안 함 — 사용자 책임 아님
    if p_rejection_source is distinct from 'call_cap' then
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

    -- 광고 보호 환급: LLM 반려 + 등록 시 광고 사용 + 일일 환급 캡(2개) 미도달
    if p_rejection_source = 'llm' then
      select ad_used_at_register into v_ad_used
      from public.votes where id = p_vote_id;

      if coalesce(v_ad_used, false) then
        select daily_ad_refund_count, daily_ad_refund_date
        into v_refund_count, v_refund_date
        from public.users where id = p_user_id
        for update;

        if v_refund_date is distinct from v_today then
          -- 날짜 바뀜 → 첫 환급
          update public.users
          set free_pass_balance = free_pass_balance + 1,
              daily_ad_refund_count = 1,
              daily_ad_refund_date = v_today
          where id = p_user_id;
        elsif coalesce(v_refund_count, 0) < 2 then
          update public.users
          set free_pass_balance = free_pass_balance + 1,
              daily_ad_refund_count = coalesce(daily_ad_refund_count, 0) + 1
          where id = p_user_id;
        end if;
        -- 캡 도달 시 silent skip (어뷰징 방어)
      end if;
    end if;
  end if;
end;
$$;

grant execute on function public.fn_record_moderation_result(uuid, uuid, vote_type, boolean, boolean, text) to service_role;
