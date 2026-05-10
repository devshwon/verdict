-- 오늘의 투표 cast 도 일반 투표와 동일하게 보상/미션 카운트 적립
--
-- 버그:
--   기존 fn_grant_vote_participation 트리거가 vote.type='normal' 만 처리하고
--   today / today_candidate 는 즉시 return → 사용자가 오늘의 투표 cast 해도:
--     - normal_vote_participation 1P 적립 X
--     - normal_daily_attendance 1P 적립 X (첫 투표 시)
--     - normal_daily_5vote_complete 카운트 미반영
--     - streak 업데이트 X
--
-- 변경:
--   1) 가드: type IN ('normal','today') 모두 처리 (today_candidate 는 cast 자체가 없으므로 자연 제외)
--   2) count 쿼리: normal + today 합산 (5건 보너스 미션도 통합)
--   3) trigger 이름은 normal_* 그대로 유지 — toss_promotions 매핑 / enum 영향 최소화
--      (의미상 "투표 참여 1P" 라 today 포함 정상)
--
-- 본문 외에는 20260504000008 의 fn_grant_vote_participation 와 동일.

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
  -- normal + today 모두 처리. today_candidate 는 cast 받지 않음 (후보 단계).
  if v_vote_type not in ('normal', 'today') then
    return new;
  end if;

  -- 일일 cast 카운트 — normal + today 합산 (5건 보너스 미션 통합)
  select count(*) into v_today_count
  from public.vote_casts c
  join public.votes v on v.id = c.vote_id
  where c.user_id = v_user
    and v.type in ('normal', 'today')
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

    -- 출석 1P (자동 — 매일 발생, 1P 이라 마찰 없음)
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
