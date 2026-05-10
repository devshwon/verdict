-- get_daily_missions 의 투표 참여 카운트도 normal + today 합산
--
-- 20260511000001 에서 fn_grant_vote_participation 트리거가 today cast 도 처리하도록 변경.
-- 미션 표시(MissionWidget / DailyMissionCard) 의 카운트도 동일하게 통합해야
-- "5건 투표 미션" 진행도가 일관성 있게 노출됨.
--
-- 변경 라인은 카운트 쿼리 한 줄만 — 본문 외 부분 동일.

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

  -- normal + today 합산 (today_candidate 는 cast 없음 — 자연 제외)
  select count(*) into v_normal_cast_count
  from public.vote_casts c
  join public.votes v on v.id = c.vote_id
  where c.user_id = v_uid
    and v.type in ('normal', 'today')
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
      'reward_points', 7
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
