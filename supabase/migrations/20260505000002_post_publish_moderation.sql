-- 사후 모더레이션 인프라 (A안)
--
-- 배경:
--   사전 LLM 검열은 한국어 정상 질문도 false positive로 반려해 사용자 이탈 위험.
--   사전 휴리스틱 통과 → 즉시 게시 → 사용자 신고 임계 도달 → admin 큐 검토 흐름으로 전환.
--   LLM 호출은 moderate-vote Edge Function의 MODERATION_MODE env로 토글 (이 마이그레이션 범위 밖).
--
-- 변경 요약:
--   1) vote_status enum 에 'blinded_by_reports' 추가 — 신고 임계 도달로 비공개 처리된 상태
--   2) vote_reports 테이블 + RLS — 사용자 신고 1행씩 적재 (vote_id, reporter_id) unique
--   3) users.report_weight — 신고자 가중치 (기본 1.0). 어뷰저는 운영자가 down
--   4) report_vote RPC — insert + 가중 합 임계(3.0) 도달 시 status 전환
--   5) report_reason enum — 신고 사유 표준화

-- ============================================================================
-- 1. vote_status enum 확장
-- ============================================================================

alter type vote_status add value if not exists 'blinded_by_reports';

-- ============================================================================
-- 2. report_reason enum
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_reason') then
    create type report_reason as enum (
      'hate',          -- 혐오/비하
      'spam',          -- 도배/광고
      'sexual',        -- 선정적
      'violence',      -- 폭력/범죄 미화
      'personal_info', -- 개인정보 노출
      'other'          -- 기타
    );
  end if;
end$$;

-- ============================================================================
-- 3. users.report_weight — 신고 가중치 (어뷰저 down)
-- ============================================================================

alter table public.users
  add column if not exists report_weight numeric(4,2) not null default 1.0
  check (report_weight >= 0);

-- ============================================================================
-- 4. vote_reports 테이블
-- ============================================================================

create table if not exists public.vote_reports (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes(id) on delete cascade,
  reporter_id uuid not null references public.users(id) on delete cascade,
  reason report_reason not null,
  created_at timestamptz not null default now(),
  unique (vote_id, reporter_id)  -- 같은 사용자 같은 vote 중복 신고 차단
);

create index if not exists idx_vote_reports_vote on public.vote_reports(vote_id, created_at desc);
create index if not exists idx_vote_reports_reporter on public.vote_reports(reporter_id, created_at desc);

alter table public.vote_reports enable row level security;

-- 본인 신고 이력만 select (admin 은 service_role 사용)
create policy vote_reports_self_select on public.vote_reports
  for select using (auth.uid() = reporter_id);

-- insert 는 RPC(report_vote)를 통해서만 — 정책 추가 안 함

-- ============================================================================
-- 5. report_vote RPC — 신고 적재 + 임계 판정
-- ============================================================================
--
-- 임계 정책:
--   - report_weight 합계 ≥ 3.0 도달 시 votes.status='blinded_by_reports' 전환
--   - 이미 blinded / blinded_by_reports / deleted 상태면 추가 신고는 받되 status 재전환 안 함
--   - 자기 글 신고 차단
--   - 동일 사용자 중복 신고는 unique 제약으로 무시 (UPSERT 아님 — 첫 신고 사유 보존)

create or replace function public.report_vote(
  p_vote_id uuid,
  p_reason report_reason
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_author uuid;
  v_status vote_status;
  v_weight_sum numeric;
  v_threshold numeric := 3.0;
  v_blinded boolean := false;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select author_id, status into v_author, v_status
  from public.votes where id = p_vote_id;

  if v_author is null then
    raise exception 'vote not found' using errcode = 'P0001';
  end if;

  if v_author = v_uid then
    raise exception 'cannot report own vote' using errcode = 'P0009';
  end if;

  -- 신고 적재 (중복은 unique 위반 → silent skip)
  begin
    insert into public.vote_reports (vote_id, reporter_id, reason)
    values (p_vote_id, v_uid, p_reason);
  exception when unique_violation then
    return jsonb_build_object(
      'ok', true,
      'duplicated', true,
      'blinded', false
    );
  end;

  -- 이미 비공개 상태인 vote 는 임계 재판정 스킵
  if v_status in ('blinded', 'blinded_by_reports', 'deleted') then
    return jsonb_build_object(
      'ok', true,
      'duplicated', false,
      'blinded', false
    );
  end if;

  -- 신고자 가중치 합계
  select coalesce(sum(u.report_weight), 0)
  into v_weight_sum
  from public.vote_reports r
  join public.users u on u.id = r.reporter_id
  where r.vote_id = p_vote_id;

  if v_weight_sum >= v_threshold then
    update public.votes
    set status = 'blinded_by_reports'
    where id = p_vote_id
      and status not in ('blinded', 'blinded_by_reports', 'deleted');
    v_blinded := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicated', false,
    'blinded', v_blinded
  );
end;
$$;

grant execute on function public.report_vote(uuid, report_reason) to authenticated;
