-- 광고 시청 토큰 검증 인프라 (백로그 §S2)
--
-- 흐름:
--   1) 클라이언트가 광고 시청 (시뮬레이션 또는 실 SDK)
--   2) 시청 완료 시 register-ad-watch Edge Function에 콜백 데이터 전달
--   3) Edge Function이 검증 (실 SDK 통합 시 서명 체크) + ad_watches INSERT (callback_token 발급)
--   4) 클라이언트가 토큰을 받아 register_vote / unlock_vote_results / claim_daily_ad_free_pass RPC에 전달
--   5) 각 RPC는 fn_consume_ad_token으로 토큰 소비 + ad_unit 매칭 + 5분 유효기간 검증
--
-- 일일 캡: ad_unit별 + 합계 (Edge Function 단계에서 강제)
-- 토큰 소비는 RPC 단계 — 즉, 광고를 봤어도 RPC 호출 시점에 만료되거나 이미 소비된 토큰은 거부

-- ============================================================================
-- 1. ad_watches 테이블
-- ============================================================================

create table public.ad_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ad_unit text not null check (ad_unit in (
    'register_3plus',       -- 일반 등록 3건째+
    'unlock_vote_result',   -- 마감된 투표 결과 잠금 해제
    'mypage_free_pass',     -- 마이페이지 무료이용권 1일 1회
    'general'               -- 기타 (배너/전면 등 — frequency 추적만)
  )),
  callback_token text not null unique,
  consumed boolean not null default false,
  watched_at timestamptz not null default now(),
  consumed_at timestamptz,
  -- 실제 토스 SDK 통합 시 콜백 페이로드 보존 (감사용)
  sdk_payload jsonb
);

create index idx_ad_watches_user_today on public.ad_watches(user_id, watched_at desc);
create index idx_ad_watches_unconsumed on public.ad_watches(callback_token) where not consumed;

alter table public.ad_watches enable row level security;

-- 본인 시청 이력만 조회. INSERT는 register-ad-watch Edge Function (service_role).
create policy ad_watches_self_select on public.ad_watches
  for select using (auth.uid() = user_id);

-- ============================================================================
-- 2. fn_consume_ad_token — 토큰 소비 헬퍼
-- ============================================================================
--
-- 동작: 토큰이 (1) 본인 소유, (2) ad_unit 일치, (3) 5분 이내, (4) 미소비 라면
--       consumed=true로 UPDATE하고 true 반환. 어느 하나라도 실패면 false.

create or replace function public.fn_consume_ad_token(
  p_user_id uuid,
  p_token text,
  p_ad_unit text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_token is null or p_token = '' then
    return false;
  end if;

  update public.ad_watches
  set consumed = true,
      consumed_at = now()
  where callback_token = p_token
    and user_id = p_user_id
    and ad_unit = p_ad_unit
    and not consumed
    and watched_at >= now() - interval '5 minutes';

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- ============================================================================
-- 3. register_vote 갱신 — 광고 사용 시 p_ad_token 검증
-- ============================================================================

drop function if exists public.register_vote(text, text[], text, int, vote_type, boolean, boolean);

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
      elsif coalesce(p_ad_used, false) then
        -- ★ 광고 토큰 검증 — 시뮬레이션·실 SDK 모두 register-ad-watch가 토큰 발급
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

-- ============================================================================
-- 4. unlock_vote_results 갱신 — p_ad_token 검증 추가
-- ============================================================================

drop function if exists public.unlock_vote_results(uuid);

create or replace function public.unlock_vote_results(
  p_vote_id uuid,
  p_ad_token text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_status vote_status;
  v_closed_at timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  if not public.fn_consume_ad_token(v_uid, p_ad_token, 'unlock_vote_result') then
    raise exception 'ad token invalid or expired' using errcode = 'P0007';
  end if;

  select status, closed_at
    into v_status, v_closed_at
  from public.votes
  where id = p_vote_id;

  if not found then
    raise exception 'vote not found: %', p_vote_id using errcode = '23503';
  end if;

  if v_status = 'active' and v_closed_at > now() then
    raise exception 'vote is still active' using errcode = 'P0001';
  end if;

  insert into public.vote_unlocks (vote_id, user_id)
  values (p_vote_id, v_uid)
  on conflict (vote_id, user_id) do nothing;
end;
$$;

grant execute on function public.unlock_vote_results(uuid, text) to authenticated;

-- ============================================================================
-- 5. claim_daily_ad_free_pass 갱신 — p_ad_token 검증 추가
-- ============================================================================

drop function if exists public.claim_daily_ad_free_pass(text);

create or replace function public.claim_daily_ad_free_pass(p_ad_token text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_already_claimed_today int;
  v_new_balance int;
  v_kst_today_start timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  v_kst_today_start := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

  select count(*) into v_already_claimed_today
  from public.free_pass_grants
  where user_id = v_uid
    and source = 'ad_reward'
    and created_at >= v_kst_today_start;

  if v_already_claimed_today >= 1 then
    raise exception 'daily ad reward already claimed today' using errcode = 'P0005';
  end if;

  if not public.fn_consume_ad_token(v_uid, p_ad_token, 'mypage_free_pass') then
    raise exception 'ad token invalid or expired' using errcode = 'P0007';
  end if;

  insert into public.free_pass_grants (user_id, source, amount, related_ad_token)
  values (v_uid, 'ad_reward', 1, p_ad_token);

  update public.users
  set free_pass_balance = free_pass_balance + 1
  where id = v_uid
  returning free_pass_balance into v_new_balance;

  return v_new_balance;
end;
$$;

grant execute on function public.claim_daily_ad_free_pass(text) to authenticated;

-- ============================================================================
-- 추가 에러 코드:
--   P0007 — 광고 토큰 무효/만료
-- ============================================================================
