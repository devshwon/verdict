-- 사용자 등록 차단 해제 운영 RPC
--
-- 배경:
--   사전 휴리스틱(4자 미만 / 선택지 중복) 연속 3회 반려 시
--   register_blocked_until = now() + 1h 가 자동 설정됨 (20260504000003).
--   또한 일일 반려 5회 누적 시 register_vote 호출 자체가 P0008로 차단됨.
--   운영자가 admin 페이지에서 즉시 해제할 수 있도록 RPC 제공.
--
-- 추가:
--   1) admin_find_user(p_email, p_short) — 이메일 또는 user_id 앞 4자리(hex)로 조회
--      - 두 인자 중 하나만 채워서 호출 (둘 다 null 이면 빈 결과)
--   2) admin_unblock_user(p_user_id) — 차단/카운터 리셋

-- ============================================================================
-- 1. admin_find_user — 사용자 조회 (이메일/short hex)
-- ============================================================================
--
-- 반환:
--   id, email, user_short(uuid 앞 4자리),
--   register_blocked_until, consecutive_rejections,
--   daily_rejection_count, daily_rejection_date,
--   is_admin

create or replace function public.admin_find_user(
  p_email text default null,
  p_short text default null
)
returns table (
  id uuid,
  email text,
  user_short text,
  register_blocked_until timestamptz,
  consecutive_rejections int,
  daily_rejection_count int,
  daily_rejection_date date,
  is_admin boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_short_norm text;
  v_email_norm text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select coalesce(u.is_admin, false) into v_is_admin
  from public.users u where u.id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  v_short_norm := nullif(upper(btrim(coalesce(p_short, ''))), '');
  v_email_norm := nullif(lower(btrim(coalesce(p_email, ''))), '');

  if v_short_norm is null and v_email_norm is null then
    return;
  end if;

  return query
    select
      u.id,
      a.email::text,
      upper(substring(replace(u.id::text, '-', ''), 1, 4)) as user_short,
      u.register_blocked_until,
      u.consecutive_rejections,
      u.daily_rejection_count,
      u.daily_rejection_date,
      coalesce(u.is_admin, false) as is_admin
    from public.users u
    left join auth.users a on a.id = u.id
    where (
      v_short_norm is not null
      and upper(substring(replace(u.id::text, '-', ''), 1, 4)) = v_short_norm
    )
    or (
      v_email_norm is not null
      and lower(a.email) = v_email_norm
    )
    order by u.id
    limit 20;
end;
$$;

grant execute on function public.admin_find_user(text, text) to authenticated;

-- ============================================================================
-- 2. admin_unblock_user — 차단/카운터 리셋
-- ============================================================================
--
-- 동작:
--   - register_blocked_until = NULL
--   - consecutive_rejections = 0
--   - daily_rejection_count = 0
--   - daily_rejection_date = NULL
--
-- 반환: 변경 전 상태(jsonb) — 운영 추적용

create or replace function public.admin_unblock_user(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_prev_until timestamptz;
  v_prev_consecutive int;
  v_prev_daily int;
  v_prev_date date;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select coalesce(u.is_admin, false) into v_is_admin
  from public.users u where u.id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  select register_blocked_until,
         consecutive_rejections,
         daily_rejection_count,
         daily_rejection_date
    into v_prev_until,
         v_prev_consecutive,
         v_prev_daily,
         v_prev_date
    from public.users
    where id = p_user_id;

  if not found then
    raise exception 'user not found' using errcode = 'P0001';
  end if;

  update public.users
  set register_blocked_until = null,
      consecutive_rejections = 0,
      daily_rejection_count = 0,
      daily_rejection_date = null
  where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'prev', jsonb_build_object(
      'register_blocked_until', v_prev_until,
      'consecutive_rejections', coalesce(v_prev_consecutive, 0),
      'daily_rejection_count', coalesce(v_prev_daily, 0),
      'daily_rejection_date', v_prev_date
    )
  );
end;
$$;

grant execute on function public.admin_unblock_user(uuid) to authenticated;
