-- RLS 정책 (v0.1 draft)
-- 원칙:
--   1. 모든 테이블 RLS 활성화
--   2. 인증된 사용자만 SELECT (anon은 차단)
--   3. 본인 데이터 INSERT/UPDATE/DELETE는 auth.uid() 기반
--   4. service_role(Edge Function)은 RLS 우회 — 별도 정책 불필요
--   5. UPDATE/DELETE 정책이 없으면 거부 (vote_casts 변경 불가 등)

-- ============================================================================
-- users — 본인 row만 SELECT/UPDATE 가능 (INSERT/DELETE는 Edge Function)
-- ============================================================================

alter table public.users enable row level security;

create policy users_self_select on public.users
  for select using (auth.uid() = id);

create policy users_self_update on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ============================================================================
-- votes — 인증 사용자에게 active/closed 공개, 본인 것은 상태 무관 노출
-- ============================================================================

alter table public.votes enable row level security;

create policy votes_public_select on public.votes
  for select using (
    auth.uid() = author_id
    or (auth.role() = 'authenticated' and status in ('active', 'closed'))
  );

create policy votes_self_insert on public.votes
  for insert with check (auth.uid() = author_id);

create policy votes_self_update on public.votes
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy votes_self_delete on public.votes
  for delete using (auth.uid() = author_id);

-- ============================================================================
-- vote_options — 부모 vote 가시성 따라감, 작성자만 수정
-- ============================================================================

alter table public.vote_options enable row level security;

create policy vote_options_select on public.vote_options
  for select using (
    exists (
      select 1 from public.votes v
      where v.id = vote_options.vote_id
        and (
          auth.uid() = v.author_id
          or (auth.role() = 'authenticated' and v.status in ('active', 'closed'))
        )
    )
  );

create policy vote_options_author_insert on public.vote_options
  for insert with check (
    exists (select 1 from public.votes v where v.id = vote_options.vote_id and v.author_id = auth.uid())
  );

create policy vote_options_author_update on public.vote_options
  for update using (
    exists (select 1 from public.votes v where v.id = vote_options.vote_id and v.author_id = auth.uid())
  );

create policy vote_options_author_delete on public.vote_options
  for delete using (
    exists (select 1 from public.votes v where v.id = vote_options.vote_id and v.author_id = auth.uid())
  );

-- ============================================================================
-- vote_casts — 인증 사용자 SELECT (집계용), 본인만 INSERT, 수정/삭제 불가
-- ============================================================================

alter table public.vote_casts enable row level security;

create policy vote_casts_select on public.vote_casts
  for select using (auth.role() = 'authenticated');

create policy vote_casts_self_insert on public.vote_casts
  for insert with check (auth.uid() = user_id);

-- UPDATE/DELETE 정책 없음 → 클라이언트는 변경 불가 (서비스 역할만 가능)

-- ============================================================================
-- today_candidate_recommendations — 인증 사용자 SELECT, 본인 INSERT/DELETE
-- ============================================================================

alter table public.today_candidate_recommendations enable row level security;

create policy candidates_select on public.today_candidate_recommendations
  for select using (auth.role() = 'authenticated');

create policy candidates_self_insert on public.today_candidate_recommendations
  for insert with check (auth.uid() = user_id);

create policy candidates_self_delete on public.today_candidate_recommendations
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- points_log — 본인만 SELECT, 쓰기는 service_role만 (RLS 미통과 = 차단)
-- ============================================================================

alter table public.points_log enable row level security;

create policy points_self_select on public.points_log
  for select using (auth.uid() = user_id);

-- ============================================================================
-- reports — 본인 신고만 SELECT, 본인만 INSERT (수정/삭제는 운영자만 = service_role)
-- ============================================================================

alter table public.reports enable row level security;

create policy reports_self_select on public.reports
  for select using (auth.uid() = reporter_id);

create policy reports_self_insert on public.reports
  for insert with check (auth.uid() = reporter_id);

-- ============================================================================
-- v_vote_results 뷰 — 인증 사용자에게 SELECT 권한 부여
-- (뷰는 owner 권한으로 underlying RLS 우회, 집계 정상 동작)
-- ============================================================================

grant select on public.v_vote_results to authenticated;
