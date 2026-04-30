-- 무료이용권 + 일일 미션 RPC (기획서 §4-3, §4-4 + 운영 추가 정책)
--
-- 무료이용권 정책:
--   - 광고 시청 (마이페이지) → +1, 1일 1회 KST 기준
--   - 친구 초대 양쪽 +1 (v2 도입, 모델만 v1에서 준비 — docs/future/v2-features.md F1)
--   - 인앱 결제 (v2 도입, 모델만 v1에서 준비 — docs/future/v2-features.md F2)
--   - 일반 투표 등록 3건째+ 시 광고 대신 사용 가능 (1건 차감)
--   - 마이페이지 광고 시청 외 다른 화면(VoteDetail unlock, RegisterScreen 광고)은 캡 없음 (행동별 광고는 자원 적립 아님)
--
-- 일일 미션 (KST 자정 리셋):
--   - 일반 투표 참여 3/3 → +4P (참여 1P × 3 + 보너스 1P)
--   - 일반 투표 등록 2/2 → +4P (등록 2P × 2)
--   - 오늘의 투표 후보 신청 1/1 → +5P (작성)
--   ※ 점수 적립은 기존 register_vote / 향후 cast_vote 흐름이 처리. get_daily_missions는 진행률만 노출

-- ============================================================================
-- 1. users.free_pass_balance 디노멀라이즈
-- ============================================================================

alter table public.users
  add column free_pass_balance int not null default 0
  check (free_pass_balance >= 0);

-- ============================================================================
-- 2. free_pass_grants — 발급 이력 (출처 추적, 어뷰징 모니터링)
-- ============================================================================
--
-- v2 호환을 위해 friend_invite / purchase enum 미리 포함.
-- 차감(소비)은 row 추가하지 않고 users.free_pass_balance만 감소.
-- 별도 사용 이력이 필요해지면 free_pass_consumes 테이블을 v2에서 추가.

create table public.free_pass_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in (
    'ad_reward',          -- 마이페이지 리워드 광고 시청 (1일 1회)
    'friend_invite',      -- v2: 친구 초대 양쪽 +1
    'purchase',           -- v2: 인앱 결제
    'event_promotion',    -- 운영 프로모션 (관리자 일괄 지급)
    'admin_grant'         -- 운영자 직접 지급 (CS 보상 등)
  )),
  amount int not null check (amount > 0),
  created_at timestamptz not null default now(),
  related_ad_token text,         -- ad_reward 시 토스 광고 콜백 토큰 (검증용 — 백로그 §S2)
  related_invite_id uuid,        -- v2: friend_invites.id 참조
  related_purchase_id text       -- v2: purchases 트랜잭션 키
);

create index idx_free_pass_grants_user on public.free_pass_grants(user_id, created_at desc);
create index idx_free_pass_grants_source_user on public.free_pass_grants(user_id, source, created_at desc);

-- RLS — 본인 발급 이력만 조회. INSERT는 RPC 통해서만.
alter table public.free_pass_grants enable row level security;

create policy free_pass_grants_self_select on public.free_pass_grants
  for select using (auth.uid() = user_id);

-- ============================================================================
-- 3. RPC: claim_daily_ad_free_pass — 마이페이지 광고 시청 1일 1회
-- ============================================================================

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

  -- TODO: p_ad_token 검증 (백로그 §S2 — 토스 광고 콜백 토큰 unique + verified + 5분 이내)

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
-- 4. RPC: get_daily_missions — 홈 위젯 + 마이페이지 미션 카드 공용
-- ============================================================================

create or replace function public.get_daily_missions()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid;
  v_kst_today_start timestamptz;
  v_normal_cast_count int;
  v_normal_register_count int;
  v_today_candidate_count int;
  v_free_pass_balance int;
  v_ad_claimed_today boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  v_kst_today_start := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

  -- 오늘 일반 투표 참여 수 (vote_casts에서 일반 투표만)
  select count(*) into v_normal_cast_count
  from public.vote_casts c
  join public.votes v on v.id = c.vote_id
  where c.user_id = v_uid
    and v.type = 'normal'
    and c.cast_at >= v_kst_today_start;

  -- 오늘 일반 투표 등록 수
  select count(*) into v_normal_register_count
  from public.votes
  where author_id = v_uid
    and type = 'normal'
    and created_at >= v_kst_today_start;

  -- 오늘 오늘의 투표 후보 신청 수
  select count(*) into v_today_candidate_count
  from public.votes
  where author_id = v_uid
    and type = 'today_candidate'
    and created_at >= v_kst_today_start;

  -- 무료이용권 잔량
  select coalesce(free_pass_balance, 0) into v_free_pass_balance
  from public.users where id = v_uid;

  -- 오늘 광고로 무료이용권 받았는지
  select exists (
    select 1 from public.free_pass_grants
    where user_id = v_uid
      and source = 'ad_reward'
      and created_at >= v_kst_today_start
  ) into v_ad_claimed_today;

  return jsonb_build_object(
    'normal_vote_participation', jsonb_build_object(
      'current', least(v_normal_cast_count, 3),
      'target', 3,
      'completed', v_normal_cast_count >= 3,
      'reward_points', 4
    ),
    'normal_vote_register', jsonb_build_object(
      'current', least(v_normal_register_count, 2),
      'target', 2,
      'completed', v_normal_register_count >= 2,
      'reward_points', 4
    ),
    'today_candidate_register', jsonb_build_object(
      'current', least(v_today_candidate_count, 1),
      'target', 1,
      'completed', v_today_candidate_count >= 1,
      'reward_points', 5
    ),
    'free_pass_balance', v_free_pass_balance,
    'ad_claimed_today', v_ad_claimed_today
  );
end;
$$;

grant execute on function public.get_daily_missions() to authenticated;

-- ============================================================================
-- 5. register_vote 갱신 — p_use_free_pass 옵션 추가
-- ============================================================================
--
-- 동작:
--   - 일반 투표 등록 3건째+ 일 때 p_use_free_pass=true이면 free_pass_balance -1 차감
--   - 잔량 0이면 P0006 에러
--   - p_use_free_pass와 p_ad_used 동시 true는 free_pass 우선 (광고 무시)
--   - today_candidate 등록에는 free_pass 적용 불가 (P0006)

drop function if exists public.register_vote(text, text[], text, int, vote_type, boolean);

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

  -- ── 일일 캡 + 광고/무료이용권 게이트 ──────────────────
  if p_type = 'normal' then
    select count(*) into v_normal
    from public.votes
    where author_id = v_uid
      and type = 'normal'
      and created_at >= date_trunc('day', now()) at time zone 'utc';

    if v_normal >= 10 then
      raise exception 'daily normal cap reached' using errcode = 'P0002';
    end if;

    -- 3건째(0-indexed 2) 이상은 광고 또는 무료이용권 필요
    if v_normal >= 2 then
      if coalesce(p_use_free_pass, false) then
        -- 무료이용권 차감 (원자적)
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

  -- ── INSERT votes ────────────────────────────────────
  insert into public.votes (author_id, question, category, type, status, duration_minutes)
  values (v_uid, trim(p_question), p_category, p_type, 'active', p_duration_minutes)
  returning id into v_vote_id;

  -- ── INSERT vote_options ─────────────────────────────
  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

  -- ── 보상 적립 ───────────────────────────────────────
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
-- 에러 코드 추가 (기존 register_vote 코드와 함께)
--   28000 — 인증 누락
--   23514 — 입력 검증 실패
--   P0002 — 일일 캡 도달
--   P0003 — 등록 정지
--   P0004 — 광고 또는 무료이용권 필요 (3건째+)
--   P0005 — 마이페이지 광고 1일 1회 한도 초과
--   P0006 — 무료이용권 잔량 부족 또는 적용 불가 타입
-- ============================================================================
