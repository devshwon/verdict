-- 사용자 삭제 시 points_log를 anonymize (회계 기록 보존, PII만 제거)
-- 변경 전: on delete restrict + not null  → 사용자 삭제 불가
-- 변경 후: on delete set null + nullable  → 사용자 삭제 시 user_id가 null로 변경됨

alter table public.points_log
  drop constraint points_log_user_id_fkey;

alter table public.points_log
  alter column user_id drop not null;

alter table public.points_log
  add constraint points_log_user_id_fkey
    foreign key (user_id) references public.users(id) on delete set null;

-- 익명화된 레코드 조회용 인덱스 (정산/감사 시 user_id is null 필터)
create index idx_points_log_anonymized on public.points_log(created_at desc) where user_id is null;
