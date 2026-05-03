-- 보상 정책 v2 (기획서 §7 갱신, 베타 데이터 wipe 가정)
--
-- 변경 요약:
--   1) 일반 투표 참여 1P × 5건/일 (3 → 5)
--   2) 5건 완료 보너스 +2P/일 (기존 3건완료 +1P 제거 → 5건완료 +2P)
--   3) 출석 매일 1P (첫 투표 참여 시 자동 적립)
--   4) 출석 10·20·30+ 보너스 (+1P / +2P / +3P 캡)
--   5) 3·7·30일 스트릭 보너스 제거
--   6) 오늘의 투표 당선 30P → 20P 정액 (카테고리당)
--   7) 트랙 분리 캡: 행동 20P/일, 콘텐츠 130P/일 (당선·100명 보너스는 별도)
--
-- 베타 전 wipe 가정 — 기존 points_log / users.current_streak 등은 정합성 깨질 수 있음
-- 운영 데이터 있다면 본 마이그레이션 적용 전 백업 필수

-- ============================================================================
-- 1. points_log.trigger CHECK 갱신 + idx
-- ============================================================================

-- 기존 row 중 더 이상 허용 안 되는 trigger는 사전 제거 (베타 데이터 wipe)
delete from public.points_log
where trigger in (
  'normal_streak_3d',
  'normal_streak_7d',
  'normal_streak_30d',
  'normal_daily_3vote_complete'
);

alter table public.points_log
  drop constraint points_log_trigger_check;

alter table public.points_log
  add constraint points_log_trigger_check
  check (trigger in (
    -- 행동 트랙 (일일 캡 20P)
    'normal_vote_participation',         -- 일반 투표 참여 1P/건 (하루 5건)
    'normal_daily_5vote_complete',       -- 5건 완료 보너스 +2P (1회/일)
    'normal_daily_attendance',           -- 출석 1P/일 (첫 투표 시 자동)
    'normal_streak_10day',               -- 10일째 +1P
    'normal_streak_20day',               -- 20일째 +2P
    'normal_streak_30plus',              -- 30·40·50…일째 +3P (캡)
    'normal_vote_register',              -- 일반 투표 등록 1~2건 2P/건
    'today_candidate_register',          -- 오늘의 투표 후보 신청 5P (1인 1일 1건)
    -- 콘텐츠 트랙 (별도 캡 130P)
    'normal_100_participants_bonus',     -- 100명 달성 +3P/100명 (캡 30P/vote)
    'today_selection'                    -- 오늘의 투표 당선 20P (카테고리당, 작성 5P 별도)
  ));

-- ============================================================================
-- 2. fn_points_category 갱신 — 트랙 분리 캡 매핑
-- ============================================================================

create or replace function public.fn_points_category(p_trigger text)
returns text
language sql
immutable
as $$
  select case
    when p_trigger in (
      'normal_vote_participation',
      'normal_daily_5vote_complete',
      'normal_daily_attendance',
      'normal_streak_10day',
      'normal_streak_20day',
      'normal_streak_30plus',
      'normal_vote_register',
      'today_candidate_register'
    ) then 'behavior'
    when p_trigger in (
      'normal_100_participants_bonus',
      'today_selection'
    ) then 'content'
    else 'other'
  end;
$$;

-- ============================================================================
-- 3. users.current_streak 정의 명확화
--    last_voted_date — 마지막 투표 참여 날짜 (KST). 출석/스트릭 계산 기준
-- ============================================================================
-- (이미 initial_schema에 컬럼 존재. 필요 시 reset)
update public.users
set current_streak = 0,
    last_voted_date = null;

-- ============================================================================
-- 4. fn_grant_vote_participation — vote_casts AFTER INSERT 트리거
--   - 참여 보상 (5건까지 1P/건)
--   - 5건 완료 보너스 (+2P)
--   - 출석 (1P, 첫 투표 시)
--   - 출석 보너스 (10/20/30+ 일째)
-- ============================================================================

create or replace function public.fn_grant_vote_participation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_yesterday date := v_today - 1;
  v_user uuid := new.user_id;
  v_vote_type vote_type;
  v_kst_today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_today_count int;
  v_last_voted date;
  v_streak int;
  v_new_streak int;
  v_bonus int;
  v_bonus_trigger text;
begin
  select type into v_vote_type from public.votes where id = new.vote_id;
  if v_vote_type <> 'normal' then
    return new;  -- 일반 투표만 보상 대상
  end if;

  -- 오늘 일반 투표 참여 수 (이번 cast 포함)
  select count(*) into v_today_count
  from public.vote_casts c
  join public.votes v on v.id = c.vote_id
  where c.user_id = v_user
    and v.type = 'normal'
    and c.cast_at >= v_kst_today_start;

  -- ── 참여 보상 (5건까지 1P/건) ──────────────────────────
  if v_today_count <= 5 then
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
    values (
      v_user,
      'normal_vote_participation',
      1,
      'normal_vote_participation:' || v_user::text || ':' || v_today::text || ':' || v_today_count::text,
      new.vote_id
    )
    on conflict (idempotency_key) do nothing;
  end if;

  -- ── 5건 완료 보너스 (+2P) ───────────────────────────
  if v_today_count = 5 then
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
    values (
      v_user,
      'normal_daily_5vote_complete',
      2,
      'normal_daily_5vote_complete:' || v_user::text || ':' || v_today::text,
      new.vote_id
    )
    on conflict (idempotency_key) do nothing;
  end if;

  -- ── 출석 + 스트릭 (오늘 첫 투표일 때만) ─────────────
  if v_today_count = 1 then
    select last_voted_date, current_streak
    into v_last_voted, v_streak
    from public.users where id = v_user
    for update;

    if v_last_voted = v_today then
      v_new_streak := coalesce(v_streak, 0);  -- 이미 오늘 처리됨 (race)
    elsif v_last_voted = v_yesterday then
      v_new_streak := coalesce(v_streak, 0) + 1;
    else
      v_new_streak := 1;  -- 끊김 → 리셋
    end if;

    update public.users
    set current_streak = v_new_streak,
        last_voted_date = v_today
    where id = v_user;

    -- 출석 1P
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
    values (
      v_user,
      'normal_daily_attendance',
      1,
      'normal_daily_attendance:' || v_user::text || ':' || v_today::text,
      new.vote_id
    )
    on conflict (idempotency_key) do nothing;

    -- 출석 보너스 — 10·20·30·40…일째
    if v_new_streak > 0 and v_new_streak % 10 = 0 then
      if v_new_streak = 10 then
        v_bonus := 1;
        v_bonus_trigger := 'normal_streak_10day';
      elsif v_new_streak = 20 then
        v_bonus := 2;
        v_bonus_trigger := 'normal_streak_20day';
      else
        v_bonus := 3;  -- 30·40·50… 캡
        v_bonus_trigger := 'normal_streak_30plus';
      end if;

      insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
      values (
        v_user,
        v_bonus_trigger,
        v_bonus,
        v_bonus_trigger || ':' || v_user::text || ':' || v_new_streak::text || ':' || v_today::text,
        new.vote_id
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vote_casts_grant_participation on public.vote_casts;
create trigger trg_vote_casts_grant_participation
after insert on public.vote_casts
for each row execute function public.fn_grant_vote_participation();

-- ============================================================================
-- 5. promote_today_candidates 갱신 — 당선 30P → 20P
-- ============================================================================

create or replace function public.promote_today_candidates(
  p_selections jsonb,
  p_publish_date date default current_date
)
returns table (vote_id uuid, category text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  rec_key text;
  rec_vote_id uuid;
  v_publish_ts timestamptz;
  v_author_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select coalesce(is_admin, false) into v_is_admin
  from public.users where id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  v_publish_ts := (p_publish_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Seoul';

  for rec_key in select * from jsonb_object_keys(p_selections)
  loop
    rec_vote_id := (p_selections->>rec_key)::uuid;

    if rec_key not in ('daily', 'relationship', 'work', 'game') then
      raise exception 'invalid category for today vote: %', rec_key
        using errcode = '23514';
    end if;

    update public.votes
    set type = 'today',
        today_published_date = p_publish_date,
        started_at = v_publish_ts,
        duration_minutes = 1440,
        status = 'active',
        rejection_reason = null
    where id = rec_vote_id
      and type = 'today_candidate'
      and category = rec_key
      and status in ('active', 'pending_review')
    returning author_id into v_author_id;

    if not found then
      raise exception 'vote not found or not eligible: % (category=%)',
        rec_vote_id, rec_key
        using errcode = '23503';
    end if;

    -- today_selection 20P 정액 (카테고리당)
    insert into public.points_log (
      user_id, trigger, amount, idempotency_key, related_vote_id
    )
    values (
      v_author_id,
      'today_selection',
      20,
      'today_selection:' || v_author_id::text || ':' || rec_vote_id::text,
      rec_vote_id
    )
    on conflict (idempotency_key) do nothing;

    return query
      select rec_vote_id, rec_key, 'promoted'::text;
  end loop;
end;
$$;

grant execute on function public.promote_today_candidates(jsonb, date) to authenticated;

-- ============================================================================
-- 6. get_daily_missions 갱신 — 5건 캡 + 출석 진행률 노출
-- ============================================================================

create or replace function public.get_daily_missions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_kst_today_start timestamptz;
  v_today date;
  v_normal_cast_count int;
  v_normal_register_count int;
  v_today_candidate_count int;
  v_free_pass_balance int;
  v_ad_claimed_today boolean;
  v_streak int;
  v_attended_today boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  v_kst_today_start := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_today := (now() at time zone 'Asia/Seoul')::date;

  select count(*) into v_normal_cast_count
  from public.vote_casts c
  join public.votes v on v.id = c.vote_id
  where c.user_id = v_uid
    and v.type = 'normal'
    and c.cast_at >= v_kst_today_start;

  select count(*) into v_normal_register_count
  from public.votes
  where author_id = v_uid
    and type = 'normal'
    and created_at >= v_kst_today_start;

  select count(*) into v_today_candidate_count
  from public.votes
  where author_id = v_uid
    and type = 'today_candidate'
    and created_at >= v_kst_today_start;

  select coalesce(free_pass_balance, 0), coalesce(current_streak, 0),
         (last_voted_date = v_today)
  into v_free_pass_balance, v_streak, v_attended_today
  from public.users where id = v_uid;

  select exists (
    select 1 from public.free_pass_grants
    where user_id = v_uid
      and source = 'ad_reward'
      and created_at >= v_kst_today_start
  ) into v_ad_claimed_today;

  return jsonb_build_object(
    'normal_vote_participation', jsonb_build_object(
      'current', least(v_normal_cast_count, 5),
      'target', 5,
      'completed', v_normal_cast_count >= 5,
      'reward_points', 7  -- 5P 참여 + 2P 완료 보너스
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
    'attendance', jsonb_build_object(
      'attended_today', coalesce(v_attended_today, false),
      'current_streak', v_streak,
      'next_bonus_day', case
        when v_streak < 10 then 10
        when v_streak < 20 then 20
        else ((v_streak / 10) + 1) * 10
      end
    ),
    'free_pass_balance', v_free_pass_balance,
    'ad_claimed_today', v_ad_claimed_today
  );
end;
$$;

grant execute on function public.get_daily_missions() to authenticated;
