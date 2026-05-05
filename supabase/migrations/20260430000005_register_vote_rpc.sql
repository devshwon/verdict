-- 질문 등록 RPC (기획서 §4-3, §6, §7-1, §13-1)
--
-- 변경 이유:
--   1) 클라이언트 직접 INSERT는 votes + vote_options 분리 INSERT라 원자성 깨짐
--   2) 일일 캡(일반 10건 / 오늘의 투표 후보 1건) 강제는 RLS USING으로 표현 어려움
--   3) 광고 게이트(3건째부터)는 서버 검증 필수 — 클라이언트만 신뢰 불가
--   4) 보상(normal_vote_register 2P / today_candidate_register 5P) 적립도 같은 트랜잭션
--
-- 에러 코드:
--   28000 — 인증 누락
--   23514 — 입력 검증 실패 (길이/개수/카테고리)
--   P0002 — 일일 캡 도달
--   P0003 — 등록 정지(반복 위반 30일 정지 등)
--   P0004 — 광고 시청 필요 (3건째 이상)

-- ============================================================================
-- 1. get_register_status — 등록 화면 진입 시 일일 상태 조회
-- ============================================================================

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
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select count(*) into v_normal
  from public.votes
  where author_id = v_uid
    and type = 'normal'
    and created_at >= date_trunc('day', now());

  select count(*) into v_today_cand
  from public.votes
  where author_id = v_uid
    and type = 'today_candidate'
    and created_at >= date_trunc('day', now());

  select register_blocked_until into v_blocked
  from public.users where id = v_uid;

  return query select
    v_normal,
    v_today_cand,
    -- 3건째(0-indexed >=2)부터 10건까지 광고 필요
    (v_normal >= 2 and v_normal < 10),
    v_normal >= 10,
    v_today_cand >= 1,
    coalesce(v_blocked > now(), false);
end;
$$;

grant execute on function public.get_register_status() to authenticated;

-- ============================================================================
-- 2. register_vote — votes + options + points_log 원자 INSERT
-- ============================================================================
--
-- 입력:
--   p_question         질문 (1~60자)
--   p_options          선택지 텍스트 배열 (2~5개, 각 1~30자)
--   p_category         'daily'/'relationship'/'work'/'game'/'etc'
--   p_duration_minutes 10/30/60/360/1440 중 하나
--   p_type             'normal' | 'today_candidate'
--   p_ad_used          광고 시청 완료 여부 (3건째 이상 normal에 필수)
-- 반환: 생성된 vote_id

create or replace function public.register_vote(
  p_question text,
  p_options text[],
  p_category text,
  p_duration_minutes int,
  p_type vote_type,
  p_ad_used boolean default false
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
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  -- ── 입력 검증 ─────────────────────────────────────────
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

  -- ── 등록 정지 체크 ───────────────────────────────────
  select register_blocked_until into v_blocked
  from public.users where id = v_uid;
  if v_blocked is not null and v_blocked > now() then
    raise exception 'register blocked until %', v_blocked using errcode = 'P0003';
  end if;

  -- ── 일일 캡 + 광고 게이트 ───────────────────────────
  if p_type = 'normal' then
    select count(*) into v_normal
    from public.votes
    where author_id = v_uid
      and type = 'normal'
      and created_at >= date_trunc('day', now());

    if v_normal >= 10 then
      raise exception 'daily normal cap reached' using errcode = 'P0002';
    end if;
    -- 3건째(0-indexed 2)부터 광고 필요
    if v_normal >= 2 and not coalesce(p_ad_used, false) then
      raise exception 'ad required for 3rd+ normal vote' using errcode = 'P0004';
    end if;

  elsif p_type = 'today_candidate' then
    select count(*) into v_today_cand
    from public.votes
    where author_id = v_uid
      and type = 'today_candidate'
      and created_at >= date_trunc('day', now());

    if v_today_cand >= 1 then
      raise exception 'daily today candidate cap reached' using errcode = 'P0002';
    end if;
  end if;

  -- ── INSERT votes ────────────────────────────────────
  -- TODO: Claude 검열 도입 후 status='pending_review'로 시작, 검열 통과 시 'active' 전환
  insert into public.votes (author_id, question, category, type, status, duration_minutes)
  values (v_uid, trim(p_question), p_category, p_type, 'active', p_duration_minutes)
  returning id into v_vote_id;

  -- ── INSERT vote_options ─────────────────────────────
  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

  -- ── 보상 적립 (status='pending', 실제 토스 지급은 별도 worker) ──
  if p_type = 'normal' and v_normal < 2 then
    -- 1~2건째 normal 등록 → 2P
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
    values (
      v_uid,
      'normal_vote_register',
      2,
      'normal_vote_register:' || v_uid::text || ':' || v_vote_id::text,
      v_vote_id
    );
  elsif p_type = 'today_candidate' then
    -- 1건째 today_candidate → 5P
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
    values (
      v_uid,
      'today_candidate_register',
      5,
      'today_candidate_register:' || v_uid::text || ':' || v_vote_id::text,
      v_vote_id
    );
  end if;

  return v_vote_id;
end;
$$;

grant execute on function public.register_vote(text, text[], text, int, vote_type, boolean) to authenticated;

-- ============================================================================
-- TODO (별도 마이그레이션):
--   - Claude API 검열 hook (Edge Function이 호출 → status를 pending_review에서 active로 전환)
--   - today_candidate → today 승격 RPC (운영자 전용, service_role 또는 별도 권한 컬럼)
--   - 광고 게이트 우회 방지: 일일 광고 시청 횟수 캡 + 클라이언트 광고 콜백 위변조 검증
-- ============================================================================
