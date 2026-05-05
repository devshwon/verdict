-- Admin 페이지 Phase 1 — 일반투표 관리 + 신고 처리 + 오늘의 투표 후보 조회
--
-- 추가:
--   1) admin_moderation_actions 테이블 — 운영자 액션 감사 로그
--   2) admin_list_today_candidates(p_date date) — 어제 후보 풀 조회 (CandidatesPage)
--   3) admin_list_votes(...)                   — 일반투표 목록 (VotesPage)
--   4) admin_soft_delete_vote(...)             — 부적절 투표 반려 (status='deleted', 사유 기록)
--   5) admin_list_reported_votes(...)          — 신고 1건+ 누적 큐 (ReportsPage)
--   6) admin_get_vote_reports(p_vote_id uuid)  — 특정 vote의 신고 상세
--   7) admin_restore_vote(...)                 — false positive 복원 (status='active')
--
-- 모든 함수는 security definer + is_admin 가드 (errcode P0008).

-- ============================================================================
-- 1. admin_moderation_actions — 감사 로그
-- ============================================================================

create table if not exists public.admin_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes(id) on delete cascade,
  admin_id uuid not null references public.users(id) on delete restrict,
  action text not null check (action in ('soft_delete', 'restore')),
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_actions_vote
  on public.admin_moderation_actions(vote_id, created_at desc);
create index if not exists idx_admin_actions_admin
  on public.admin_moderation_actions(admin_id, created_at desc);

alter table public.admin_moderation_actions enable row level security;

-- 직접 select/insert 차단 — 모든 접근은 RPC 경유
revoke all on public.admin_moderation_actions from public, anon, authenticated;

-- ============================================================================
-- 2. admin_list_today_candidates — 어제 후보 풀 (CandidatesPage)
-- ============================================================================

create or replace function public.admin_list_today_candidates(p_date date)
returns table (
  id uuid,
  category text,
  question text,
  status text,
  created_at timestamptz,
  author_id uuid,
  participants_count int,
  options jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_start timestamptz;
  v_end timestamptz;
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

  v_start := (p_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Seoul';
  v_end := v_start + interval '1 day';

  return query
    select
      v.id,
      v.category::text,
      v.question,
      v.status::text,
      v.created_at,
      v.author_id,
      v.participants_count,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', vo.id,
              'option_text', vo.option_text,
              'display_order', vo.display_order
            ) order by vo.display_order
          )
          from public.vote_options vo
          where vo.vote_id = v.id
        ),
        '[]'::jsonb
      ) as options
    from public.votes v
    where v.type = 'today_candidate'
      and v.created_at >= v_start
      and v.created_at < v_end
      and v.status in ('active', 'pending_review')
    order by v.category, v.created_at desc;
end;
$$;

grant execute on function public.admin_list_today_candidates(date) to authenticated;

-- ============================================================================
-- 3. admin_list_votes — 일반투표 목록 (VotesPage)
-- ============================================================================
--
-- 파라미터:
--   p_category : 'daily'|'relationship'|'work'|'game'|'etc'|null(전체)
--   p_status   : 상태 배열 (예: ARRAY['active','pending_review']). null = 모든 상태
--   p_search   : 질문 부분 일치 (ILIKE). null/빈문자열 = 검색 안 함
--   p_limit    : 페이지 크기 (기본 50, 최대 200)
--   p_offset   : 시작 인덱스
--
-- 반환에 reports_count 포함 — ReportsPage에서도 재사용

create or replace function public.admin_list_votes(
  p_category text default null,
  p_status text[] default null,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  category text,
  type text,
  question text,
  status text,
  participants_count int,
  reports_count int,
  created_at timestamptz,
  closed_at timestamptz,
  author_id uuid,
  rejection_reason text
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
      v.id,
      v.category::text,
      v.type::text,
      v.question,
      v.status::text,
      v.participants_count,
      coalesce(rc.cnt, 0)::int as reports_count,
      v.created_at,
      v.closed_at,
      v.author_id,
      v.rejection_reason
    from public.votes v
    left join lateral (
      select count(*)::int as cnt
      from public.vote_reports r
      where r.vote_id = v.id
    ) rc on true
    where (p_category is null or v.category::text = p_category)
      and (p_status is null or v.status::text = any(p_status))
      and (
        p_search is null or btrim(p_search) = ''
        or v.question ilike '%' || p_search || '%'
      )
    order by v.created_at desc
    limit v_limit offset coalesce(p_offset, 0);
end;
$$;

grant execute on function public.admin_list_votes(text, text[], text, int, int) to authenticated;

-- ============================================================================
-- 4. admin_soft_delete_vote — 부적절 투표 반려
-- ============================================================================
--
-- 동작:
--   1) is_admin 가드
--   2) status='deleted' 로 전환 + rejection_reason 갱신
--   3) admin_moderation_actions(action='soft_delete') INSERT
--   4) 이미 deleted 상태면 idempotent (no-op + 동일 응답)
--
-- 참고: 광고 환급/free pass 환급은 기존 trigger 가 status='blinded'/'deleted' 전환 시
-- 어떻게 동작하는지 별도 확인 필요. Phase 1에서는 확인 후 결정.

create or replace function public.admin_soft_delete_vote(
  p_vote_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_prev_status text;
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

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason required' using errcode = '23514';
  end if;

  select status::text into v_prev_status
  from public.votes where id = p_vote_id;

  if v_prev_status is null then
    raise exception 'vote not found' using errcode = 'P0001';
  end if;

  if v_prev_status = 'deleted' then
    return jsonb_build_object('ok', true, 'changed', false, 'prev_status', v_prev_status);
  end if;

  update public.votes
  set status = 'deleted',
      rejection_reason = p_reason
  where id = p_vote_id;

  insert into public.admin_moderation_actions (vote_id, admin_id, action, reason)
  values (p_vote_id, v_uid, 'soft_delete', p_reason);

  return jsonb_build_object('ok', true, 'changed', true, 'prev_status', v_prev_status);
end;
$$;

grant execute on function public.admin_soft_delete_vote(uuid, text) to authenticated;

-- ============================================================================
-- 5. admin_list_reported_votes — 신고 ≥1건 누적 큐 (ReportsPage)
-- ============================================================================
--
-- 파라미터:
--   p_only_pending : true → status='active' 만 (운영자 검토 필요), false → 전체
--   p_limit/p_offset
--
-- 정렬: 신고수 desc, 최근 신고 시각 desc

create or replace function public.admin_list_reported_votes(
  p_only_pending boolean default true,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  category text,
  question text,
  status text,
  participants_count int,
  reports_count int,
  last_reported_at timestamptz,
  author_id uuid,
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
      v.id,
      v.category::text,
      v.question,
      v.status::text,
      v.participants_count,
      rc.cnt::int as reports_count,
      rc.last_at as last_reported_at,
      v.author_id,
      v.created_at
    from public.votes v
    join lateral (
      select count(*) as cnt, max(r.created_at) as last_at
      from public.vote_reports r
      where r.vote_id = v.id
    ) rc on rc.cnt > 0
    where (not p_only_pending or v.status = 'active')
    order by rc.cnt desc, rc.last_at desc
    limit v_limit offset coalesce(p_offset, 0);
end;
$$;

grant execute on function public.admin_list_reported_votes(boolean, int, int) to authenticated;

-- ============================================================================
-- 6. admin_get_vote_reports — 특정 vote의 신고 상세
-- ============================================================================
--
-- 반환: 신고 행 + 신고자 닉네임 단편 (개인정보 최소화)

create or replace function public.admin_get_vote_reports(p_vote_id uuid)
returns table (
  id uuid,
  reporter_id uuid,
  reporter_short text,           -- user_id의 hex 앞 4자리 (닉네임 표시용)
  reason text,
  created_at timestamptz
)
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

  return query
    select
      r.id,
      r.reporter_id,
      upper(substring(replace(r.reporter_id::text, '-', ''), 1, 4)) as reporter_short,
      r.reason::text,
      r.created_at
    from public.vote_reports r
    where r.vote_id = p_vote_id
    order by r.created_at desc;
end;
$$;

grant execute on function public.admin_get_vote_reports(uuid) to authenticated;

-- ============================================================================
-- 7. admin_restore_vote — false positive 복원
-- ============================================================================
--
-- 동작:
--   1) 현재 status가 'blinded_by_reports' 또는 'blinded' 인 경우만 복원 허용
--   2) status='active' 로 복원 + rejection_reason=null
--   3) admin_moderation_actions(action='restore') INSERT

create or replace function public.admin_restore_vote(
  p_vote_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_prev_status text;
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

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason required' using errcode = '23514';
  end if;

  select status::text into v_prev_status
  from public.votes where id = p_vote_id;

  if v_prev_status is null then
    raise exception 'vote not found' using errcode = 'P0001';
  end if;

  if v_prev_status not in ('blinded', 'blinded_by_reports') then
    raise exception 'vote not in restorable status (current=%)', v_prev_status
      using errcode = 'P0010';
  end if;

  update public.votes
  set status = 'active',
      rejection_reason = null
  where id = p_vote_id;

  insert into public.admin_moderation_actions (vote_id, admin_id, action, reason)
  values (p_vote_id, v_uid, 'restore', p_reason);

  return jsonb_build_object('ok', true, 'prev_status', v_prev_status);
end;
$$;

grant execute on function public.admin_restore_vote(uuid, text) to authenticated;

-- ============================================================================
-- 새 에러 코드:
--   P0010 — 복원 불가 상태 (active/pending_review 등)
-- ============================================================================
