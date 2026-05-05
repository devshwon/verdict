-- 인구통계 raw 값 분리 저장 (버그 수정)
--
-- 기존 동작 문제:
--   1) toggle OFF 시 users.gender = 'undisclosed'로 덮어쓰기 → raw 값 유실
--   2) 다음 toss 로그인 전엔 toggle ON 해도 비공개 상태 고정
--   3) age_bucket은 toss-auth가 birthday 복호화 미구현이라 항상 'undisclosed'
--
-- 변경:
--   1) gender_raw / age_bucket_raw 컬럼 추가 — 토스 원본값 보존
--   2) gender / age_bucket은 derived (visibility 적용된 effective 값)
--   3) toggle은 *_public 플래그만 변경 + effective 값 자동 재계산
--   4) toss-auth가 raw 값만 갱신, effective는 트리거가 자동 처리

-- ============================================================================
-- 1. raw 컬럼 추가 + 기존 값 백필
-- ============================================================================

alter table public.users
  add column gender_raw gender not null default 'undisclosed',
  add column age_bucket_raw age_bucket not null default 'undisclosed';

-- 기존 effective 값을 raw로 백필 (이미 'undisclosed'면 그대로)
update public.users
set gender_raw = gender,
    age_bucket_raw = age_bucket;

-- ============================================================================
-- 2. effective 값 자동 재계산 트리거
--    INSERT/UPDATE 시 (gender_raw, gender_public) → gender 자동 동기화
-- ============================================================================

create or replace function public.fn_users_sync_effective_demographics()
returns trigger
language plpgsql
as $$
begin
  new.gender := case when new.gender_public then new.gender_raw else 'undisclosed' end;
  new.age_bucket := case when new.age_public then new.age_bucket_raw else 'undisclosed' end;
  return new;
end;
$$;

drop trigger if exists trg_users_sync_demographics on public.users;
create trigger trg_users_sync_demographics
before insert or update of gender_raw, age_bucket_raw, gender_public, age_public
on public.users
for each row execute function public.fn_users_sync_effective_demographics();

-- ============================================================================
-- 3. 신규 RPC — 인구통계 공개 토글 (effective 자동 동기화)
--    클라이언트는 직접 UPDATE 대신 이 RPC 사용 권장 (투명성 + race 방어)
-- ============================================================================

create or replace function public.update_demographics_visibility(
  p_gender_public boolean default null,
  p_age_public boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  update public.users
  set gender_public = coalesce(p_gender_public, gender_public),
      age_public = coalesce(p_age_public, age_public)
  where id = v_uid;
end;
$$;

grant execute on function public.update_demographics_visibility(boolean, boolean) to authenticated;
