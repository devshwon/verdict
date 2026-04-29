-- Verdict 초기 스키마 (v0.1 draft)
-- 기준 문서: docs/pickit_plan.md v1.1
-- 설계 원칙:
--   1. Toss 인증을 신원, Supabase를 진실의 출처로 사용
--   2. ENUM은 변동 가능성이 낮은 필드에만 (category는 확장성을 위해 text+CHECK)
--   3. 일반 투표 30일 자동 삭제는 pg_cron으로 별도 운영 (이 파일에는 미포함)
--   4. RLS는 별도 마이그레이션에서 추가 (스키마 검증 후)

-- ============================================================================
-- 1. ENUM 타입
-- ============================================================================

create type vote_type as enum ('normal', 'today', 'today_candidate');
create type vote_status as enum ('active', 'closed', 'blinded', 'deleted');
create type gender as enum ('M', 'F', 'undisclosed');
create type age_bucket as enum ('age_20s', 'age_30s', 'age_40plus', 'undisclosed');
create type point_status as enum ('pending', 'completed', 'failed');
create type report_status as enum ('pending', 'reviewed_kept', 'reviewed_removed');

-- ============================================================================
-- 2. users — 토스 인증 기반 사용자
-- ============================================================================

-- public.users.id는 auth.users.id와 1:1 매칭 (Supabase Auth 브릿지)
-- 닉네임은 클라이언트에서 user.id 해시로 deterministic 생성 (DB에 저장하지 않음)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  -- 토스 식별자 (1인 1계정 보장의 핵심)
  toss_user_key text not null unique,

  -- 토스 동의 미수신 시 'undisclosed', 마이페이지에서 변경 가능
  gender gender not null default 'undisclosed',
  age_bucket age_bucket not null default 'undisclosed',

  -- 어뷰징 방지: 신규 가입 24시간 쿨다운, 위반 시 등록 정지
  created_at timestamptz not null default now(),
  register_blocked_until timestamptz,

  -- 7일 연속 참여 스트릭 (denormalized — 매 투표마다 갱신)
  current_streak int not null default 0,
  last_voted_date date,

  -- 누적 신고 (관리용)
  report_received_count int not null default 0
);

-- ============================================================================
-- 3. votes — 투표(질문) 본체
-- ============================================================================

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users(id) on delete cascade,

  question text not null check (char_length(question) between 1 and 60),
  -- 카테고리는 text+CHECK로 운영 (스포츠/육아 등 추후 추가)
  category text not null check (category in ('daily', 'relationship', 'work', 'game', 'etc')),

  type vote_type not null default 'normal',
  status vote_status not null default 'active',

  -- 10/30/60/360/1440 분만 허용
  duration_minutes int not null check (duration_minutes in (10, 30, 60, 360, 1440)),

  started_at timestamptz not null default now(),
  -- closed_at = started_at + duration_minutes (BEFORE 트리거로 자동 설정 — §하단 트리거 정의)
  closed_at timestamptz not null,

  -- 오늘의 투표로 선정/발행된 날짜 (nullable; 일반 투표는 null)
  today_published_date date,

  -- 어뷰징/품질
  ai_score numeric(4,2), -- Claude 흥미도 0.00~10.00
  report_count int not null default 0,

  created_at timestamptz not null default now()
);

-- 피드 노출 쿼리: 카테고리 + 상태 + 시간 기준
create index idx_votes_feed on public.votes(category, status, closed_at desc);
-- 마이페이지 "내가 올린" 조회
create index idx_votes_author on public.votes(author_id, created_at desc);
-- 지난 오늘의 투표 섹션
create index idx_votes_today_published on public.votes(today_published_date desc) where today_published_date is not null;
-- 30일 보관 자동 삭제 잡 (일반 투표 마감 후 30일)
create index idx_votes_normal_closed on public.votes(closed_at) where type = 'normal';

-- ============================================================================
-- 4. vote_options — 선택지 (2~5개)
-- ============================================================================

create table public.vote_options (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes(id) on delete cascade,
  option_text text not null check (char_length(option_text) between 1 and 30),
  display_order smallint not null check (display_order between 1 and 5),

  unique (vote_id, display_order)
);

create index idx_vote_options_vote on public.vote_options(vote_id);

-- ============================================================================
-- 5. vote_casts — 투표 기록 (1인 1투표 강제)
-- ============================================================================

create table public.vote_casts (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes(id) on delete cascade,
  option_id uuid not null references public.vote_options(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  cast_at timestamptz not null default now(),

  -- 핵심 제약: 같은 사용자가 같은 투표에 두 번 못 함
  unique (vote_id, user_id)
);

-- 결과 집계 (vote_id 기준 그룹바이) — 가장 빈번한 쿼리
create index idx_vote_casts_vote on public.vote_casts(vote_id);
-- 마이페이지 "참여한 투표"
create index idx_vote_casts_user on public.vote_casts(user_id, cast_at desc);

-- ============================================================================
-- 6. today_candidate_recommendations — 오늘의 투표 후보 공감
-- ============================================================================

create table public.today_candidate_recommendations (
  vote_id uuid not null references public.votes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (vote_id, user_id)
);

create index idx_today_recs_vote on public.today_candidate_recommendations(vote_id);

-- ============================================================================
-- 7. points_log — 토스 포인트 지급 이력
-- ============================================================================

create table public.points_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,

  trigger text not null check (trigger in (
    'today_vote_participation',  -- 오늘의 투표 참여 5~10원
    'streak_7d',                  -- 7일 연속 200원
    'today_selection',            -- 내 질문 상단 선정 100~500원
    'reach_100_participants'      -- 내 질문 100명 달성 50원
  )),
  amount int not null check (amount > 0),

  -- 중복 지급 방지: (user_id + trigger + 기준일/대상)로 결정적으로 생성
  -- 예: streak_7d:user_id:2026-04-29
  idempotency_key text not null unique,

  status point_status not null default 'pending',
  toss_transaction_id text,
  related_vote_id uuid references public.votes(id) on delete set null,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_points_log_user on public.points_log(user_id, created_at desc);
create index idx_points_log_status on public.points_log(status) where status = 'pending';

-- ============================================================================
-- 8. reports — 신고
-- ============================================================================

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes(id) on delete cascade,
  reporter_id uuid not null references public.users(id) on delete cascade,
  reason text not null check (char_length(reason) <= 500),
  status report_status not null default 'pending',
  created_at timestamptz not null default now(),

  -- 같은 사용자가 같은 투표를 중복 신고 못 함
  unique (vote_id, reporter_id)
);

create index idx_reports_pending on public.reports(created_at desc) where status = 'pending';

-- ============================================================================
-- 9. 트리거 — votes.closed_at 자동 설정 (started_at + duration_minutes)
-- ============================================================================

create or replace function public.fn_set_vote_closed_at()
returns trigger
language plpgsql
as $$
begin
  new.closed_at := new.started_at + make_interval(mins => new.duration_minutes);
  return new;
end;
$$;

create trigger trg_votes_set_closed_at
before insert or update of started_at, duration_minutes on public.votes
for each row execute function public.fn_set_vote_closed_at();

-- ============================================================================
-- 10. 트리거 — 신고 누적 시 자동 블라인드 (3회 이상)
-- ============================================================================

create or replace function public.fn_apply_report_count()
returns trigger
language plpgsql
as $$
begin
  update public.votes
  set report_count = report_count + 1,
      status = case when report_count + 1 >= 3 and status = 'active'
                    then 'blinded'::vote_status
                    else status
              end
  where id = new.vote_id;
  return new;
end;
$$;

create trigger trg_reports_apply_count
after insert on public.reports
for each row execute function public.fn_apply_report_count();

-- ============================================================================
-- 11. 뷰 — 결과 집계 (성별/연령대별)
-- ============================================================================

-- 단순 % 집계용 — 상세 페이지에서 SELECT
-- gender/age_bucket이 'undisclosed'인 응답은 해당 데모그래픽 카운트에서 제외
create view public.v_vote_results as
select
  c.vote_id,
  c.option_id,
  count(*)::int as total_count,
  count(*) filter (where u.gender = 'M')::int as male_count,
  count(*) filter (where u.gender = 'F')::int as female_count,
  count(*) filter (where u.age_bucket = 'age_20s')::int as age_20s,
  count(*) filter (where u.age_bucket = 'age_30s')::int as age_30s,
  count(*) filter (where u.age_bucket = 'age_40plus')::int as age_40plus,
  count(*) filter (where u.age_bucket = 'undisclosed')::int as age_undisclosed
from public.vote_casts c
join public.users u on u.id = c.user_id
group by c.vote_id, c.option_id;

-- ============================================================================
-- TODO (별도 마이그레이션):
--   - RLS 정책: users는 본인만, vote_casts는 본인 INSERT만, points_log는 본인 SELECT만
--   - pg_cron: 일반 투표 30일 후 자동 삭제 (delete from votes where type='normal' and closed_at < now() - interval '30 days')
--   - Edge Function: 토스 인증 → Supabase Admin API로 auth.users upsert → JWT 발급
--   - 일일 등록 제한 (1일 3건) 강제: 트리거 또는 RLS USING 절
-- ============================================================================
