-- 사용자 문의(Inquiries) — 단방향 접수
--
-- 정책:
--   1) 사용자가 마이페이지에서 메시지(+선택적 닉네임)를 남기면 inquiries 행으로 적재
--   2) 사용자에게 처리 결과/답변 회신은 안 함 (의견/제안/버그 1방향 접수 채널)
--   3) admin 페이지에서 목록 조회 + 처리 완료 표시 + 삭제 가능
--
-- 메시지 길이: 10 ~ 1000자
-- 닉네임: NULL 허용 (선택 입력)

-- ============================================================================
-- 1. inquiries 테이블
-- ============================================================================

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  nickname text,                                -- 사용자가 남긴 닉네임/이름 (옵션)
  message text not null,
  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed')),
  admin_note text,                              -- 운영자 내부 메모 (사용자 비공개)
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inquiries_message_length
    check (char_length(btrim(message)) between 10 and 1000),
  constraint inquiries_nickname_length
    check (nickname is null or char_length(btrim(nickname)) between 1 and 30)
);

create index if not exists idx_inquiries_user_created
  on public.inquiries(user_id, created_at desc);
create index if not exists idx_inquiries_status_created
  on public.inquiries(status, created_at desc);

alter table public.inquiries enable row level security;

-- 직접 SELECT/INSERT 차단 — 모든 접근은 RPC 경유
revoke all on public.inquiries from public, anon, authenticated;

-- ============================================================================
-- 2. create_inquiry — 사용자 INSERT
-- ============================================================================

create or replace function public.create_inquiry(
  p_message text,
  p_nickname text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_message text;
  v_nickname text;
  v_inquiry_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  v_message := btrim(coalesce(p_message, ''));
  if char_length(v_message) < 10 or char_length(v_message) > 1000 then
    raise exception 'message must be between 10 and 1000 chars'
      using errcode = '23514';
  end if;

  v_nickname := nullif(btrim(coalesce(p_nickname, '')), '');
  if v_nickname is not null and char_length(v_nickname) > 30 then
    raise exception 'nickname too long' using errcode = '23514';
  end if;

  insert into public.inquiries (user_id, nickname, message)
  values (v_uid, v_nickname, v_message)
  returning id into v_inquiry_id;

  return v_inquiry_id;
end;
$$;

grant execute on function public.create_inquiry(text, text) to authenticated;

-- ============================================================================
-- 3. admin_list_inquiries — 운영자 목록 조회
-- ============================================================================
--
-- 파라미터:
--   p_status_filter : 'open'|'resolved'|'dismissed'|null(전체)
--   p_limit/p_offset
-- 반환: 사용자 user_id의 hex 앞 4자리(short)만 노출 (개인정보 최소화)

create or replace function public.admin_list_inquiries(
  p_status_filter text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  user_short text,
  nickname text,
  message text,
  status text,
  admin_note text,
  resolved_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_limit int;
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

  v_limit := least(coalesce(p_limit, 50), 200);

  return query
    select
      i.id,
      upper(substring(replace(i.user_id::text, '-', ''), 1, 4)) as user_short,
      i.nickname,
      i.message,
      i.status,
      i.admin_note,
      i.resolved_at,
      i.created_at
    from public.inquiries i
    where (p_status_filter is null or i.status = p_status_filter)
    order by
      case i.status when 'open' then 0 else 1 end,
      i.created_at desc
    limit v_limit offset coalesce(p_offset, 0);
end;
$$;

grant execute on function public.admin_list_inquiries(text, int, int) to authenticated;

-- ============================================================================
-- 4. admin_resolve_inquiry — 처리 완료 표시
-- ============================================================================

create or replace function public.admin_resolve_inquiry(
  p_inquiry_id uuid,
  p_status text default 'resolved',
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
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

  if p_status not in ('open', 'resolved', 'dismissed') then
    raise exception 'invalid status' using errcode = '23514';
  end if;

  update public.inquiries
  set status = p_status,
      admin_note = p_admin_note,
      resolved_at = case when p_status = 'open' then null else now() end,
      resolved_by = case when p_status = 'open' then null else v_uid end
  where id = p_inquiry_id;

  if not found then
    raise exception 'inquiry not found' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

grant execute on function public.admin_resolve_inquiry(uuid, text, text) to authenticated;

-- ============================================================================
-- 5. admin_delete_inquiry — 처리 후 삭제
-- ============================================================================

create or replace function public.admin_delete_inquiry(p_inquiry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
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

  delete from public.inquiries where id = p_inquiry_id;
  if not found then
    raise exception 'inquiry not found' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_delete_inquiry(uuid) to authenticated;
