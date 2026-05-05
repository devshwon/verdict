-- 하이브리드 수령 시스템 2단계 (DB/RPC)
--
-- 설계:
--   - 마이크로 자동 트리거 (참여 1P, 출석 1P) → status='pending' (즉시 worker 처리)
--   - 마일스톤 수동 트리거 (5건완료, 출석보너스, 등록, 후보, 당선, 100명) → status='unclaimed'
--   - 사용자가 claim_points / claim_all_unclaimed_points RPC 호출 → 'unclaimed' → 'pending'
--   - cron job: 7일 경과 'unclaimed' → 'expired' 자동 소멸
--
-- 이유:
--   1) 마이크로는 자동 — 매번 수령 버튼 누르면 피로감
--   2) 마일스톤은 수동 — 도파민 + 광고 추가 자리 + 수령 누락으로 비용 절감 (~10~20%)
--   3) 만료 7일 — 데일리 사용자 구분 + 어뷰저 수령 압력 + 비용 절감

-- ============================================================================
-- 1. claimed_at 컬럼 + 인덱스
-- ============================================================================

alter table public.points_log
  add column claimed_at timestamptz,
  add column expired_at timestamptz;

create index idx_points_log_unclaimed
  on public.points_log(user_id, created_at desc)
  where status = 'unclaimed';

-- ============================================================================
-- 2. fn_grant_vote_participation 갱신 — 트리거별 status 분기
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
    return new;
  end if;

  select count(*) into v_today_count
  from public.vote_casts c
  join public.votes v on v.id = c.vote_id
  where c.user_id = v_user
    and v.type = 'normal'
    and c.cast_at >= v_kst_today_start;

  -- 마이크로 보상 (자동) — 'pending' 즉시 worker 처리
  if v_today_count <= 5 then
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id, status)
    values (
      v_user, 'normal_vote_participation', 1,
      'normal_vote_participation:' || v_user::text || ':' || v_today::text || ':' || v_today_count::text,
      new.vote_id, 'pending'
    )
    on conflict (idempotency_key) do nothing;
  end if;

  -- 마일스톤 (수동 수령) — 'unclaimed'
  if v_today_count = 5 then
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id, status)
    values (
      v_user, 'normal_daily_5vote_complete', 2,
      'normal_daily_5vote_complete:' || v_user::text || ':' || v_today::text,
      new.vote_id, 'unclaimed'
    )
    on conflict (idempotency_key) do nothing;
  end if;

  if v_today_count = 1 then
    select last_voted_date, current_streak
    into v_last_voted, v_streak
    from public.users where id = v_user
    for update;

    if v_last_voted = v_today then
      v_new_streak := coalesce(v_streak, 0);
    elsif v_last_voted = v_yesterday then
      v_new_streak := coalesce(v_streak, 0) + 1;
    else
      v_new_streak := 1;
    end if;

    update public.users
    set current_streak = v_new_streak,
        last_voted_date = v_today
    where id = v_user;

    -- 출석 1P (자동 — 매일 발생, 1P이라 마찰 없음)
    insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id, status)
    values (
      v_user, 'normal_daily_attendance', 1,
      'normal_daily_attendance:' || v_user::text || ':' || v_today::text,
      new.vote_id, 'pending'
    )
    on conflict (idempotency_key) do nothing;

    -- 출석 보너스 (수동 수령 — 마일스톤)
    if v_new_streak > 0 and v_new_streak % 10 = 0 then
      if v_new_streak = 10 then
        v_bonus := 1;
        v_bonus_trigger := 'normal_streak_10day';
      elsif v_new_streak = 20 then
        v_bonus := 2;
        v_bonus_trigger := 'normal_streak_20day';
      else
        v_bonus := 3;
        v_bonus_trigger := 'normal_streak_30plus';
      end if;

      insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id, status)
      values (
        v_user, v_bonus_trigger, v_bonus,
        v_bonus_trigger || ':' || v_user::text || ':' || v_new_streak::text || ':' || v_today::text,
        new.vote_id, 'unclaimed'
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 3. fn_record_moderation_result 갱신 — 등록/후보 보상은 'unclaimed'
-- ============================================================================

drop function if exists public.fn_record_moderation_result(uuid, uuid, vote_type, boolean, boolean, text);

create or replace function public.fn_record_moderation_result(
  p_vote_id uuid,
  p_user_id uuid,
  p_vote_type vote_type,
  p_eligible_for_register_reward boolean,
  p_approved boolean,
  p_rejection_source text default null
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
        insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id, status)
        values (
          p_user_id, 'normal_vote_register', 2,
          'normal_vote_register:' || p_user_id::text || ':' || p_vote_id::text,
          p_vote_id, 'unclaimed'
        )
        on conflict (idempotency_key) do nothing;
      elsif p_vote_type = 'today_candidate' then
        insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id, status)
        values (
          p_user_id, 'today_candidate_register', 5,
          'today_candidate_register:' || p_user_id::text || ':' || p_vote_id::text,
          p_vote_id, 'unclaimed'
        )
        on conflict (idempotency_key) do nothing;
      end if;
    end if;
  else
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

    if p_rejection_source = 'llm' then
      select ad_used_at_register into v_ad_used
      from public.votes where id = p_vote_id;

      if coalesce(v_ad_used, false) then
        select daily_ad_refund_count, daily_ad_refund_date
        into v_refund_count, v_refund_date
        from public.users where id = p_user_id
        for update;

        if v_refund_date is distinct from v_today then
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
      end if;
    end if;
  end if;
end;
$$;

grant execute on function public.fn_record_moderation_result(uuid, uuid, vote_type, boolean, boolean, text) to service_role;

-- ============================================================================
-- 4. promote_today_candidates 갱신 — 당선 'unclaimed'
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

    insert into public.points_log (
      user_id, trigger, amount, idempotency_key, related_vote_id, status
    )
    values (
      v_author_id, 'today_selection', 20,
      'today_selection:' || v_author_id::text || ':' || rec_vote_id::text,
      rec_vote_id, 'unclaimed'
    )
    on conflict (idempotency_key) do nothing;

    return query
      select rec_vote_id, rec_key, 'promoted'::text;
  end loop;
end;
$$;

grant execute on function public.promote_today_candidates(jsonb, date) to authenticated;

-- ============================================================================
-- 5. RPC: get_unclaimed_points — 본인 미수령 보상 목록
-- ============================================================================

create or replace function public.get_unclaimed_points()
returns table (
  id uuid,
  trigger text,
  amount int,
  related_vote_id uuid,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  return query
    select pl.id, pl.trigger, pl.amount, pl.related_vote_id, pl.created_at,
           pl.created_at + interval '7 days' as expires_at
    from public.points_log pl
    where pl.user_id = v_uid
      and pl.status = 'unclaimed'
    order by pl.created_at desc;
end;
$$;

grant execute on function public.get_unclaimed_points() to authenticated;

-- ============================================================================
-- 6. RPC: claim_points(p_log_ids uuid[]) — 선택한 row만 수령
--    - 본인 row만 처리 (auth.uid() 검증)
--    - status='unclaimed' → 'pending' 전환 + claimed_at 기록
--    - 존재하지 않거나 다른 status인 row는 silent skip
-- ============================================================================

create or replace function public.claim_points(p_log_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_count int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  with claimed as (
    update public.points_log
    set status = 'pending',
        claimed_at = now()
    where id = any(p_log_ids)
      and user_id = v_uid
      and status = 'unclaimed'
    returning id
  )
  select count(*) into v_count from claimed;

  return v_count;
end;
$$;

grant execute on function public.claim_points(uuid[]) to authenticated;

-- ============================================================================
-- 7. RPC: claim_all_unclaimed_points — 본인의 모든 미수령 일괄 수령
-- ============================================================================

create or replace function public.claim_all_unclaimed_points()
returns table (claimed_count int, total_amount int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_count int;
  v_amount int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  with claimed as (
    update public.points_log
    set status = 'pending',
        claimed_at = now()
    where user_id = v_uid
      and status = 'unclaimed'
    returning amount
  )
  select count(*)::int, coalesce(sum(amount), 0)::int
  into v_count, v_amount
  from claimed;

  return query select v_count, v_amount;
end;
$$;

grant execute on function public.claim_all_unclaimed_points() to authenticated;

-- ============================================================================
-- 8. fn_expire_unclaimed_points — 7일 경과 미수령 → 'expired'
--    pg_cron으로 1시간마다 호출
-- ============================================================================

create or replace function public.fn_expire_unclaimed_points()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with expired as (
    update public.points_log
    set status = 'expired',
        expired_at = now()
    where status = 'unclaimed'
      and created_at < now() - interval '7 days'
    returning id
  )
  select count(*) into v_count from expired;

  return v_count;
end;
$$;

revoke execute on function public.fn_expire_unclaimed_points() from public, anon, authenticated;

-- pg_cron 잡 등록 (1시간마다)
select cron.schedule(
  'points-expire-unclaimed',
  '0 * * * *',
  $$select public.fn_expire_unclaimed_points()$$
);
