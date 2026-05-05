-- 결과 통계 광고 게이트 (기획서 §4-2, §13-1)
--
-- 이전 상태:
--   v_vote_results를 authenticated가 직접 SELECT 가능 → 미참여자도 결과 노출
--   vote_casts SELECT가 authenticated 전체 허용 → 누가 어디 찍었는지도 노출
--
-- 변경 내용:
--   1) votes.participants_count 디노멀라이즈 + cast INSERT 트리거 (참여자 수는 항상 노출)
--   2) vote_unlocks 테이블 — 광고 시청 후 결과 노출 권한 기록
--   3) vote_casts SELECT 정책 강화 — 본인 row만
--   4) v_vote_results 직접 SELECT 권한 회수
--   5) RPC get_vote_results — 본인 cast / unlock / 본인 author 한해서 결과 반환
--   6) RPC unlock_vote_results — 마감된 투표에 한해 unlock 발급 (광고 시청 콜백 후 호출)

-- ============================================================================
-- 1. votes.participants_count 디노멀라이즈
-- ============================================================================

alter table public.votes
  add column participants_count int not null default 0;

-- 기존 데이터 백필 (현재는 vote_casts가 비어있어 NOOP)
update public.votes v
set participants_count = (
  select count(*) from public.vote_casts c where c.vote_id = v.id
);

-- vote_casts INSERT 시 카운트 +1
create or replace function public.fn_increment_participants()
returns trigger
language plpgsql
as $$
begin
  update public.votes
  set participants_count = participants_count + 1
  where id = new.vote_id;
  return new;
end;
$$;

create trigger trg_vote_casts_increment_count
after insert on public.vote_casts
for each row execute function public.fn_increment_participants();

-- (DELETE는 vote_casts RLS DELETE 정책이 없어 차단됨 → 카운트 감소 트리거 불필요)

-- ============================================================================
-- 2. vote_unlocks — 광고 시청 후 결과 열람 권한 기록
-- ============================================================================

create table public.vote_unlocks (
  vote_id uuid not null references public.votes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (vote_id, user_id)
);

create index idx_vote_unlocks_user on public.vote_unlocks(user_id, unlocked_at desc);

alter table public.vote_unlocks enable row level security;

-- 본인이 보유한 unlock만 조회 (UI에서 hasUnlock 판정용)
create policy vote_unlocks_self_select on public.vote_unlocks
  for select using (auth.uid() = user_id);

-- INSERT 정책 없음 → 직접 INSERT 차단
-- 발급 경로는 unlock_vote_results RPC (security definer)만 허용

-- ============================================================================
-- 3. vote_casts SELECT 정책 강화 — 본인 row만 노출
-- ============================================================================

drop policy vote_casts_select on public.vote_casts;

create policy vote_casts_self_select on public.vote_casts
  for select using (auth.uid() = user_id);

-- INSERT 정책은 그대로 (vote_casts_self_insert)

-- ============================================================================
-- 4. v_vote_results 직접 SELECT 권한 회수
-- ============================================================================

revoke select on public.v_vote_results from authenticated;

-- 뷰 자체는 owner(postgres) 권한으로 underlying 테이블을 읽으므로
-- RPC(security definer) 내부 SELECT는 정상 동작.

-- ============================================================================
-- 5. RPC get_vote_results — 권한 검증 후 결과 반환
-- ============================================================================
--
-- 권한 조건 (OR):
--   a) 본인이 해당 투표에 cast함
--   b) 본인이 해당 투표에 vote_unlocks 보유 (광고 시청 후)
--   c) 본인이 해당 투표의 author (자기가 만든 투표는 항상 통계 확인 가능)
--
-- 입력: 다수 vote_ids 배열 (홈피드 카드 일괄 조회 용이)
-- 출력: 권한 있는 vote_id 행만 — 권한 없는 투표는 반환 행에서 누락

create or replace function public.get_vote_results(p_vote_ids uuid[])
returns table (
  vote_id uuid,
  option_id uuid,
  total_count int,
  male_count int,
  female_count int,
  age_20s int,
  age_30s int,
  age_40plus int,
  age_undisclosed int
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return;
  end if;

  return query
  select r.vote_id, r.option_id, r.total_count, r.male_count, r.female_count,
         r.age_20s, r.age_30s, r.age_40plus, r.age_undisclosed
  from public.v_vote_results r
  where r.vote_id = any(p_vote_ids)
    and (
      exists (
        select 1 from public.vote_casts c
        where c.vote_id = r.vote_id and c.user_id = v_uid
      )
      or exists (
        select 1 from public.vote_unlocks u
        where u.vote_id = r.vote_id and u.user_id = v_uid
      )
      or exists (
        select 1 from public.votes v
        where v.id = r.vote_id and v.author_id = v_uid
      )
    );
end;
$$;

grant execute on function public.get_vote_results(uuid[]) to authenticated;

-- ============================================================================
-- 6. RPC unlock_vote_results — 광고 시청 후 unlock 발급
-- ============================================================================
--
-- 호출 조건:
--   - 인증된 사용자
--   - 마감된 투표(status='closed' or closed_at <= now())
-- 진행중 투표는 cast로 결과 확인하면 되므로 unlock 불필요 → 차단

create or replace function public.unlock_vote_results(p_vote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_status vote_status;
  v_closed_at timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select status, closed_at
    into v_status, v_closed_at
  from public.votes
  where id = p_vote_id;

  if not found then
    raise exception 'vote not found: %', p_vote_id using errcode = '23503';
  end if;

  if v_status = 'active' and v_closed_at > now() then
    raise exception 'vote is still active' using errcode = 'P0001';
  end if;

  insert into public.vote_unlocks (vote_id, user_id)
  values (p_vote_id, v_uid)
  on conflict (vote_id, user_id) do nothing;
end;
$$;

grant execute on function public.unlock_vote_results(uuid) to authenticated;

-- ============================================================================
-- TODO (별도 후속 마이그레이션):
--   - 일일 unlock 빈도 캡 (어뷰징 방지) — 광고 미시청 우회 방지
--   - 오늘의 투표 후보(today_candidate) 정리 정책 (선정 안 된 후보 자동 만료)
-- ============================================================================
