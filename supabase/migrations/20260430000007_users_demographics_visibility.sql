-- 인구통계 공개/비공개 토글 (기획서 §4-4)
--
-- 기존 동작:
--   - users.gender / age_bucket이 토스에서 가져온 값 그대로 저장
--   - 매 세션 시작 시 toss-auth Edge Function이 토스 값으로 덮어씀
--   - 사용자가 마이페이지에서 'undisclosed'로 변경해도 다음 로그인에 복원되어 토글 효과 유실
--
-- 변경:
--   1) gender_public / age_public boolean 컬럼 추가 (기본 true)
--   2) toss-auth Edge Function이 sync 시 이 플래그를 존중하도록 별도 갱신 (코드 변경)
--   3) RLS users_self_update 정책은 기존대로 본인 row만 — 토글 자유롭게 가능
--   4) v_vote_results 뷰는 그대로 (users.gender 'undisclosed'면 자동으로 미공개 카운트)

alter table public.users
  add column gender_public boolean not null default true,
  add column age_public boolean not null default true;

-- TODO (Edge Function 갱신 필요 — 별도 deploy):
--   supabase/functions/toss-auth/index.ts 의 update 블록을:
--
--     const { error: updErr } = await admin
--       .from('users')
--       .update({
--         gender: <user_chose_to_hide_gender> ? 'undisclosed' : <toss_gender>,
--         age_bucket: <user_chose_to_hide_age> ? 'undisclosed' : <toss_age>,
--       })
--       .eq('id', userId)
--
--   처럼 변경 — gender_public/age_public 컬럼을 먼저 SELECT한 후 분기.
--   또는 sync에서 gender/age_bucket을 건드리지 않고, 별도로 raw 토스 값을 저장하는
--   gender_raw / age_bucket_raw 컬럼을 신설하는 방식도 가능(향후).
