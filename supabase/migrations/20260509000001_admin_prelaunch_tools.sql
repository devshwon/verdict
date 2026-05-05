-- Admin 사전 운영 컨텐츠 도구 — 일반투표 직접 등록 + 오늘의 투표 수동 발행
--
-- 기획: docs/operations/admin-pre-launch-content-tools.md
--
-- 추가:
--   1) auth.users + public.users 봇 계정 부트스트랩 (BOT_USER_ID = '00000000-0000-0000-0000-000000000001')
--   2) public.users.is_system 컬럼
--   3) admin_prompts 테이블 + 4건 시드 (normal_vote_gen_*, today_vote_gen_*)
--   4) admin_moderation_actions.action CHECK 확장 (admin_create_normal, admin_create_today)
--   5) admin_create_rate_limit 테이블 (분당 5/일 100 cap)
--   6) RPC: admin_create_normal_vote, admin_create_today_vote
--   7) RPC: admin_get_prompts, admin_set_prompt
--
-- 모든 RPC는 security definer + is_admin 가드 (errcode P0008).
-- 새 에러 코드: P0011 — admin create rate limit 초과

-- ============================================================================
-- 1. 봇 계정 부트스트랩
-- ============================================================================

-- auth.users에 시스템 봇 row 1건 (Supabase Auth는 우회 — 로그인 불가)
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'bot@verdict.local',
  '',
  now(),
  '{"provider":"system","providers":["system"]}'::jsonb,
  '{"system":true}'::jsonb,
  now(),
  now(),
  false
)
on conflict (id) do nothing;

-- public.users.is_system 컬럼 추가
alter table public.users
  add column if not exists is_system boolean not null default false;

create index if not exists idx_users_is_system
  on public.users(id) where is_system;

-- public.users에 봇 row (auth.users FK 충족)
insert into public.users (id, toss_user_key, gender, age_bucket, is_system, is_admin)
values (
  '00000000-0000-0000-0000-000000000001',
  '__system_bot__',
  'undisclosed',
  'undisclosed',
  true,
  false
)
on conflict (id) do nothing;

-- ============================================================================
-- 2. admin_prompts — Edge Function이 사용할 프롬프트 외부화
-- ============================================================================

create table if not exists public.admin_prompts (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

alter table public.admin_prompts enable row level security;
revoke all on public.admin_prompts from public, anon, authenticated;
-- 모든 접근은 admin RPC 또는 service_role 경유

-- 시드 (4건) — on conflict로 idempotent
insert into public.admin_prompts (key, value, description) values
('normal_vote_gen_system',
$$당신은 한국어 소셜 투표 앱 Verdict의 콘텐츠 큐레이터입니다.
20~40대 한국 사용자가 술자리/단톡방에서 가볍게 던질 만한, 의견이 갈리는 주제로 투표 후보를 만듭니다.

규칙:
- 정치/종교/혐오/특정 인물 비방 금지
- 정답이 명백한 질문 금지 (의견이 갈리는 회색지대)
- 한국 일상 맥락 (한국 직장 문화, 한국 연애 매너, 한국 게임 유저 논쟁 등)
- 질문은 4~60자, 캐주얼한 반말체
- 선택지는 2~3개 권장, 각 1~30자, 중립 회피·대비 강조
- 출력은 반드시 지정된 JSON 스키마만$$,
'일반투표 일괄 생성기 — system'),

('normal_vote_gen_user',
$$카테고리: {category}
생성 개수: {count}
직전 라운드에서 보여준 질문 (중복 회피):
{exclude}

JSON으로만 응답:
{
  "items": [
    { "question": "...", "options": ["...","..."] }
  ]
}$$,
'일반투표 일괄 생성기 — user 템플릿'),

('today_vote_gen_system',
$$당신은 한국어 소셜 투표 앱 Verdict의 "오늘의 투표" 큐레이터입니다.
오늘의 투표는 하루 카테고리당 1건만 노출되는 메인 컨텐츠로, 일반 투표보다 더 많은 사용자가 참여하기를 기대합니다.

규칙:
- 의견이 정확히 50:50 근처로 갈릴 것 같은 주제 우선
- 카테고리 정체성에 맞는 주제 (daily=일상/소비/습관, relationship=연애·친구·가족, work=직장·학교, game=게임 유저 논쟁)
- 질문 4~60자 반말체, 선택지 2개 권장 (양자택일이 가장 강력)
- 정치/종교/혐오/비방 금지
- 출력은 반드시 지정된 JSON 스키마만$$,
'오늘의 투표 즉시 등록기 — system'),

('today_vote_gen_user',
$$카테고리: {category}

JSON으로만 응답:
{
  "question": "...",
  "options": ["...","..."]
}$$,
'오늘의 투표 즉시 등록기 — user 템플릿')
on conflict (key) do nothing;

-- ============================================================================
-- 3. admin_moderation_actions.action CHECK 확장
-- ============================================================================

alter table public.admin_moderation_actions
  drop constraint if exists admin_moderation_actions_action_check;

alter table public.admin_moderation_actions
  add constraint admin_moderation_actions_action_check
  check (action in ('soft_delete', 'restore', 'admin_create_normal', 'admin_create_today'));

-- ============================================================================
-- 4. admin_create_rate_limit — 비용/오남용 방어 (분당 5건, 일일 100건)
-- ============================================================================

create table if not exists public.admin_create_rate_limit (
  admin_id uuid not null references public.users(id) on delete cascade,
  bucket_minute timestamptz not null,
  count int not null default 0,
  primary key (admin_id, bucket_minute)
);

create index if not exists idx_admin_create_rl_admin_recent
  on public.admin_create_rate_limit(admin_id, bucket_minute desc);

alter table public.admin_create_rate_limit enable row level security;
revoke all on public.admin_create_rate_limit from public, anon, authenticated;

-- 내부 함수 — RPC 두 개가 공유. (private 네이밍 prefix `_`)
create or replace function public._admin_check_and_bump_create_rl(p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz;
  v_minute_count int;
  v_day_count int;
begin
  v_bucket := date_trunc('minute', now());

  insert into public.admin_create_rate_limit (admin_id, bucket_minute, count)
  values (p_admin_id, v_bucket, 1)
  on conflict (admin_id, bucket_minute)
    do update set count = public.admin_create_rate_limit.count + 1
  returning count into v_minute_count;

  if v_minute_count > 5 then
    raise exception 'admin create rate limit (per-minute) exceeded' using errcode = 'P0011';
  end if;

  select coalesce(sum(count), 0) into v_day_count
  from public.admin_create_rate_limit
  where admin_id = p_admin_id
    and bucket_minute >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

  if v_day_count > 100 then
    raise exception 'admin create rate limit (daily) exceeded' using errcode = 'P0011';
  end if;
end;
$$;

-- ============================================================================
-- 5. admin_create_normal_vote — 일반투표 직접 등록 (봇 명의)
-- ============================================================================

create or replace function public.admin_create_normal_vote(
  p_question text,
  p_options text[],
  p_category text,
  p_duration_minutes int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_bot_id uuid := '00000000-0000-0000-0000-000000000001';
  v_vote_id uuid;
  v_idx int;
  v_opt_count int;
  v_option text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;
  select coalesce(is_admin, false) into v_is_admin
  from public.users where id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  perform public._admin_check_and_bump_create_rl(v_uid);

  if p_question is null or char_length(trim(p_question)) < 4 then
    raise exception 'question too short (min 4)' using errcode = '23514';
  end if;
  if char_length(trim(p_question)) > 60 then
    raise exception 'question too long (max 60)' using errcode = '23514';
  end if;
  v_opt_count := coalesce(array_length(p_options, 1), 0);
  if v_opt_count < 2 or v_opt_count > 5 then
    raise exception 'option count must be 2~5' using errcode = '23514';
  end if;
  for v_idx in 1..v_opt_count loop
    v_option := trim(p_options[v_idx]);
    if char_length(v_option) = 0 or char_length(v_option) > 30 then
      raise exception 'invalid option text at %', v_idx using errcode = '23514';
    end if;
  end loop;
  -- 선택지 중복 차단
  if (
    select count(distinct lower(trim(o))) from unnest(p_options) o
  ) <> v_opt_count then
    raise exception 'duplicate option text' using errcode = '23514';
  end if;
  if p_duration_minutes not in (10, 30, 60, 360, 1440) then
    raise exception 'invalid duration (allowed: 10/30/60/360/1440)' using errcode = '23514';
  end if;
  if p_category not in ('daily', 'relationship', 'work', 'game', 'etc') then
    raise exception 'invalid category' using errcode = '23514';
  end if;

  insert into public.votes (
    author_id, question, category, type, status, duration_minutes, started_at
  )
  values (
    v_bot_id, trim(p_question), p_category, 'normal', 'active', p_duration_minutes, now()
  )
  returning id into v_vote_id;

  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

  -- 보상 적립 없음 — 봇 명의

  insert into public.admin_moderation_actions (vote_id, admin_id, action, reason)
  values (v_vote_id, v_uid, 'admin_create_normal', 'pre-launch content seeding');

  return v_vote_id;
end;
$$;

grant execute on function public.admin_create_normal_vote(text, text[], text, int) to authenticated;

-- ============================================================================
-- 6. admin_create_today_vote — 오늘의 투표 즉시 등록 (봇 명의, type='today' 직행)
-- ============================================================================

create or replace function public.admin_create_today_vote(
  p_question text,
  p_options text[],
  p_category text,
  p_publish_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_bot_id uuid := '00000000-0000-0000-0000-000000000001';
  v_vote_id uuid;
  v_publish_ts timestamptz;
  v_idx int;
  v_opt_count int;
  v_option text;
  v_existing uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;
  select coalesce(is_admin, false) into v_is_admin
  from public.users where id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  perform public._admin_check_and_bump_create_rl(v_uid);

  if p_category not in ('daily', 'relationship', 'work', 'game') then
    raise exception 'invalid today category (etc not allowed): %', p_category using errcode = '23514';
  end if;

  -- 동일 발행일·카테고리에 이미 today vote가 있으면 차단
  select id into v_existing
  from public.votes
  where type = 'today'
    and category = p_category
    and today_published_date = p_publish_date
    and status = 'active'
  limit 1;
  if v_existing is not null then
    raise exception 'today vote already exists for %/% (vote_id=%)',
      p_publish_date, p_category, v_existing
      using errcode = '23505';
  end if;

  -- 입력 검증 (admin_create_normal_vote와 동일 규칙)
  if p_question is null or char_length(trim(p_question)) < 4 then
    raise exception 'question too short (min 4)' using errcode = '23514';
  end if;
  if char_length(trim(p_question)) > 60 then
    raise exception 'question too long (max 60)' using errcode = '23514';
  end if;
  v_opt_count := coalesce(array_length(p_options, 1), 0);
  if v_opt_count < 2 or v_opt_count > 5 then
    raise exception 'option count must be 2~5' using errcode = '23514';
  end if;
  for v_idx in 1..v_opt_count loop
    v_option := trim(p_options[v_idx]);
    if char_length(v_option) = 0 or char_length(v_option) > 30 then
      raise exception 'invalid option text at %', v_idx using errcode = '23514';
    end if;
  end loop;
  if (
    select count(distinct lower(trim(o))) from unnest(p_options) o
  ) <> v_opt_count then
    raise exception 'duplicate option text' using errcode = '23514';
  end if;

  v_publish_ts := (p_publish_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Seoul';

  insert into public.votes (
    author_id, question, category, type, status,
    duration_minutes, started_at, today_published_date
  )
  values (
    v_bot_id, trim(p_question), p_category, 'today', 'active',
    1440, v_publish_ts, p_publish_date
  )
  returning id into v_vote_id;

  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

  -- today_selection 보상 INSERT 없음 — 봇 명의

  insert into public.admin_moderation_actions (vote_id, admin_id, action, reason)
  values (
    v_vote_id, v_uid, 'admin_create_today',
    format('emergency publish %s/%s', p_publish_date, p_category)
  );

  return v_vote_id;
end;
$$;

grant execute on function public.admin_create_today_vote(text, text[], text, date) to authenticated;

-- ============================================================================
-- 7. admin_get_prompts / admin_set_prompt
-- ============================================================================

create or replace function public.admin_get_prompts()
returns table (
  key text,
  value text,
  description text,
  updated_at timestamptz,
  updated_by uuid
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
  select coalesce(is_admin, false) into v_is_admin
  from public.users where id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  return query
    select p.key, p.value, p.description, p.updated_at, p.updated_by
    from public.admin_prompts p
    order by p.key;
end;
$$;

grant execute on function public.admin_get_prompts() to authenticated;

create or replace function public.admin_set_prompt(
  p_key text,
  p_value text
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
  select coalesce(is_admin, false) into v_is_admin
  from public.users where id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  if p_key is null or length(btrim(p_key)) = 0 then
    raise exception 'key required' using errcode = '23514';
  end if;
  if p_value is null or length(btrim(p_value)) = 0 then
    raise exception 'value required' using errcode = '23514';
  end if;

  insert into public.admin_prompts (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  return jsonb_build_object('ok', true, 'key', p_key);
end;
$$;

grant execute on function public.admin_set_prompt(text, text) to authenticated;

-- ============================================================================
-- 새 에러 코드:
--   P0011 — admin create rate limit (per-minute 5 / per-day 100) 초과
-- ============================================================================
