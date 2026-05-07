-- admin_list_users 의 nickname 참조 제거
--
-- 배경: 20260510000001 의 admin_list_users 가 public.users.nickname 을 참조했으나
-- public.users 에는 nickname 컬럼이 없음 (admin-config-page.md 기획 단계의 오류).
-- nickname 은 public.inquiries 에만 존재. SPA 호출 시 'column u.nickname does not exist'.
--
-- 본 마이그레이션:
--   1) admin_list_users 의 returns table 에서 nickname 제거
--   2) 검색 조건은 user_short(앞 4자리 hex) + auth.users.email 로 대체
--   3) returns table 변경이라 drop + create 필요

drop function if exists public.admin_list_users(text, text, int, int);

create or replace function public.admin_list_users(
  p_tab text default 'all',
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  user_short text,
  email text,
  created_at timestamptz,
  is_admin boolean,
  is_system boolean,
  register_blocked_until timestamptz,
  consecutive_rejections int,
  daily_rejection_count int,
  daily_rejection_date date,
  register_count bigint,
  cast_count bigint,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_search_norm text;
  v_short_norm text;
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

  if p_tab not in ('all','blocked','admin') then
    raise exception 'invalid tab: %', p_tab using errcode = '23514';
  end if;

  v_search_norm := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_short_norm := case
    when v_search_norm ~ '^[0-9a-f]{4}$' then upper(v_search_norm)
    else null
  end;

  return query
    with filtered as (
      select
        u.id,
        upper(substring(replace(u.id::text, '-', ''), 1, 4)) as user_short,
        a.email::text as email,
        u.created_at,
        coalesce(u.is_admin, false) as is_admin,
        coalesce(u.is_system, false) as is_system,
        u.register_blocked_until,
        u.consecutive_rejections,
        u.daily_rejection_count,
        u.daily_rejection_date,
        (select count(*) from public.votes v where v.author_id = u.id) as register_count,
        (select count(*) from public.vote_casts c where c.user_id = u.id) as cast_count
      from public.users u
      left join auth.users a on a.id = u.id
      where
        case p_tab
          when 'all' then true
          when 'blocked' then (u.register_blocked_until is not null and u.register_blocked_until > now())
          when 'admin' then coalesce(u.is_admin, false)
        end
        and (
          v_search_norm is null
          or lower(coalesce(a.email::text, '')) like '%' || v_search_norm || '%'
          or (v_short_norm is not null
              and upper(substring(replace(u.id::text, '-', ''), 1, 4)) = v_short_norm)
        )
    )
    select
      f.id, f.user_short, f.email, f.created_at,
      f.is_admin, f.is_system, f.register_blocked_until,
      f.consecutive_rejections, f.daily_rejection_count, f.daily_rejection_date,
      f.register_count, f.cast_count,
      count(*) over () as total_count
    from filtered f
    order by f.created_at desc
    limit p_limit offset p_offset;
end;
$$;

grant execute on function public.admin_list_users(text, text, int, int) to authenticated;
