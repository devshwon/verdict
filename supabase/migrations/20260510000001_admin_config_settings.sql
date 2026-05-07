-- 운영 설정 통합 관리 (TossPromotionsPage / SettingsPage / SystemStatusPage / UsersPage)
--
-- 본 마이그레이션은 다음을 처리:
--   1) admin_settings 통합 KV 테이블 신규 생성 (jsonb value)
--   2) 기존 admin_prompts 데이터를 admin_settings (category='prompt') 로 이관
--   3) admin_prompts 테이블을 view 로 대체 (Edge Function 호환성 유지 — SELECT 만 허용)
--   4) admin_settings_audit 감사 로그 테이블 신규
--   5) admin_* RPC 9종 신규 (Toss 매핑 / 설정 / 사용자 / 권한 / 감사 로그 / 시스템 상태)
--   6) 기존 fn_check_* / register_vote / fn_record_moderation_result / admin_unblock_user
--      함수들이 admin_settings 에서 lookup 하도록 재정의
--      (admin_settings 값 없으면 기존 하드코딩 default fallback)
--   7) admin_get_prompts / admin_set_prompt 를 admin_settings 기반으로 재정의
--
-- 참고:
--   - Edge Function payout-points/register-ad-watch 는 별도 PR 로 환경변수 → DB 키 전환
--   - admin_unblock_user 시그니처/반환값 변경 없음, 본문에 감사 로그 INSERT 만 추가
--
-- 신규 에러 코드:
--   P0012 — 자가 권한 변경 차단 / 마지막 admin 회수 차단
--
-- 의존:
--   - users.is_admin (20260430000011)
--   - users.is_system (20260509000001)
--   - toss_promotions (20260504000009)
--   - admin_prompts (20260509000001) — 본 마이그레이션에서 view 로 대체
--   - admin_create_rate_limit (20260509000001) — system_status 의 OpenAI 호출 카운트 보조

-- ============================================================================
-- 1. admin_settings 테이블
-- ============================================================================

create table public.admin_settings (
  key text primary key,
  value jsonb not null,
  category text not null check (category in ('toss','payout','moderation','ad','prompt','system')),
  value_type text not null check (value_type in ('text','int','bool','jsonb')),
  description text,
  min_value numeric,
  max_value numeric,
  risk_level text not null default 'low' check (risk_level in ('low','medium','high')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

create index idx_admin_settings_category on public.admin_settings(category);

create or replace function public.fn_admin_settings_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_admin_settings_touch
before update on public.admin_settings
for each row execute function public.fn_admin_settings_touch();

alter table public.admin_settings enable row level security;
revoke all on public.admin_settings from public, anon, authenticated;
-- 모든 접근은 admin RPC 경유 (또는 service_role 직접)

-- ============================================================================
-- 2. 시드 데이터 — payout / moderation / ad / system 카테고리
-- ============================================================================

insert into public.admin_settings (key, value, category, value_type, description, min_value, max_value, risk_level)
values
  ('payout_behavior_daily_cap',           to_jsonb(20),    'payout',     'int',  '행동 보상 일일 캡 (P)',         0,    1000, 'medium'),
  ('payout_content_daily_cap',            to_jsonb(130),   'payout',     'int',  '컨텐츠 보상 일일 캡 (P)',       0,    1000, 'medium'),
  ('payout_dry_run',                      to_jsonb(false), 'payout',     'bool', '시뮬레이션 모드 (실 지급 X)',   null, null, 'high'),
  ('moderation_daily_call_cap',           to_jsonb(20),    'moderation', 'int',  '사용자당 일일 검열 호출 한도',  1,    200,  'medium'),
  ('moderation_daily_rejection_cap',      to_jsonb(5),     'moderation', 'int',  '사용자당 일일 반려 한도(P0008)',1,    50,   'medium'),
  ('moderation_consecutive_threshold',    to_jsonb(3),     'moderation', 'int',  '연속 반려 자동 차단 임계값',    1,    10,   'medium'),
  ('moderation_block_duration_min',       to_jsonb(60),    'moderation', 'int',  '자동 차단 지속 시간(분)',       5,    1440, 'medium'),
  ('ad_watch_daily_cap',                  to_jsonb(100),   'ad',         'int',  '사용자당 일일 광고 시청 캡',    1,    500,  'medium'),
  ('admin_dashboard_show_dry_run_banner', to_jsonb(true),  'system',     'bool', 'DRY_RUN 활성 시 admin 상단 경고 띠 노출', null, null, 'low')
on conflict (key) do nothing;

-- ============================================================================
-- 3. admin_prompts → admin_settings 데이터 이관 + view 전환
-- ============================================================================

-- 3-1. 데이터 이관 (admin_prompts.value text → admin_settings.value jsonb)
insert into public.admin_settings (key, value, category, value_type, description, risk_level, updated_at, updated_by)
select
  p.key,
  to_jsonb(p.value),
  'prompt',
  'text',
  p.description,
  'medium',
  p.updated_at,
  p.updated_by
from public.admin_prompts p
on conflict (key) do nothing;

-- 3-2. 기존 admin_prompts 의존 RPC 임시 drop (view 재정의 전)
drop function if exists public.admin_get_prompts();
drop function if exists public.admin_set_prompt(text, text);

-- 3-3. 원본 테이블 drop → view 재생성 (READ-ONLY, Edge Function 호환)
drop table public.admin_prompts cascade;

create view public.admin_prompts as
  select
    s.key,
    s.value #>> '{}' as value,
    s.description,
    s.updated_at,
    s.updated_by
  from public.admin_settings s
  where s.category = 'prompt';

-- Edge Function 은 service_role 로 view 조회 (자동 부여), 다른 role 은 차단
revoke all on public.admin_prompts from public, anon, authenticated;

-- 3-4. admin_get_prompts / admin_set_prompt 를 admin_settings 기반으로 재정의 (시그니처 동일)
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
    select
      s.key,
      s.value #>> '{}' as value,
      s.description,
      s.updated_at,
      s.updated_by
    from public.admin_settings s
    where s.category = 'prompt'
    order by s.key;
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
  v_prev_value jsonb;
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

  select value into v_prev_value from public.admin_settings where key = p_key;

  insert into public.admin_settings (key, value, category, value_type, description, risk_level, updated_by)
  values (p_key, to_jsonb(p_value), 'prompt', 'text', null, 'medium', v_uid)
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by;

  insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
  values (v_uid, 'setting_change', p_key, v_prev_value, to_jsonb(p_value), 'admin_set_prompt');

  return jsonb_build_object('ok', true, 'key', p_key);
end;
$$;

grant execute on function public.admin_set_prompt(text, text) to authenticated;

-- ============================================================================
-- 4. admin_settings_audit — 감사 로그 (vote 와 무관한 변경 이력)
-- ============================================================================

create table public.admin_settings_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.users(id) on delete set null,
  action text not null check (action in (
    'setting_change',
    'toss_promotion_change',
    'unblock_user',
    'grant_admin',
    'revoke_admin'
  )),
  target_key text,
  prev_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index idx_admin_settings_audit_admin
  on public.admin_settings_audit(admin_id, created_at desc);
create index idx_admin_settings_audit_action
  on public.admin_settings_audit(action, created_at desc);
create index idx_admin_settings_audit_target
  on public.admin_settings_audit(target_key, created_at desc);

alter table public.admin_settings_audit enable row level security;
revoke all on public.admin_settings_audit from public, anon, authenticated;

-- ============================================================================
-- 5. 토스 프로모션 매핑 RPC
-- ============================================================================

create or replace function public.admin_list_toss_promotions()
returns table (
  trigger text,
  promotion_id text,
  promotion_name text,
  test_mode boolean,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  is_mapped boolean
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
      tp.trigger,
      tp.promotion_id,
      tp.promotion_name,
      tp.test_mode,
      tp.notes,
      tp.created_at,
      tp.updated_at,
      (tp.promotion_id is not null
        and tp.promotion_id <> ''
        and tp.promotion_id <> 'PASTE_PROMOTION_ID_HERE') as is_mapped
    from public.toss_promotions tp
    order by tp.trigger;
end;
$$;

grant execute on function public.admin_list_toss_promotions() to authenticated;

create or replace function public.admin_upsert_toss_promotion(
  p_trigger text,
  p_promotion_id text,
  p_promotion_name text default null,
  p_test_mode boolean default true,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_prev_id text;
  v_prev_test boolean;
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

  if p_trigger not in (
    'normal_vote_participation', 'normal_daily_5vote_complete',
    'normal_daily_attendance', 'normal_streak_10day',
    'normal_streak_20day', 'normal_streak_30plus',
    'normal_vote_register', 'today_candidate_register',
    'today_selection', 'normal_100_participants_bonus'
  ) then
    raise exception 'unknown trigger: %', p_trigger using errcode = '23514';
  end if;

  if p_promotion_id is null or btrim(p_promotion_id) = '' then
    raise exception 'promotion_id required' using errcode = '23514';
  end if;

  select promotion_id, test_mode into v_prev_id, v_prev_test
  from public.toss_promotions where trigger = p_trigger;

  insert into public.toss_promotions (trigger, promotion_id, promotion_name, test_mode, notes)
  values (p_trigger, btrim(p_promotion_id), p_promotion_name, coalesce(p_test_mode, true), p_notes)
  on conflict (trigger) do update set
    promotion_id = excluded.promotion_id,
    promotion_name = coalesce(excluded.promotion_name, public.toss_promotions.promotion_name),
    test_mode = excluded.test_mode,
    notes = coalesce(excluded.notes, public.toss_promotions.notes);

  insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
  values (
    v_uid,
    'toss_promotion_change',
    p_trigger,
    jsonb_build_object('promotion_id', v_prev_id, 'test_mode', v_prev_test),
    jsonb_build_object('promotion_id', btrim(p_promotion_id), 'test_mode', coalesce(p_test_mode, true)),
    null
  );
end;
$$;

grant execute on function public.admin_upsert_toss_promotion(text, text, text, boolean, text) to authenticated;

-- ============================================================================
-- 6. 통합 설정 조회/저장 RPC
-- ============================================================================

create or replace function public.admin_get_settings(p_category text default null)
returns table (
  key text,
  value jsonb,
  category text,
  value_type text,
  description text,
  min_value numeric,
  max_value numeric,
  risk_level text,
  updated_at timestamptz,
  updated_by uuid,
  updated_by_email text
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
      s.key, s.value, s.category, s.value_type, s.description,
      s.min_value, s.max_value, s.risk_level,
      s.updated_at, s.updated_by,
      a.email::text as updated_by_email
    from public.admin_settings s
    left join auth.users a on a.id = s.updated_by
    where (p_category is null or s.category = p_category)
    order by s.category, s.key;
end;
$$;

grant execute on function public.admin_get_settings(text) to authenticated;

create or replace function public.admin_set_setting(
  p_key text,
  p_value jsonb,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_setting record;
  v_num numeric;
  v_text text;
  v_prev_value jsonb;
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

  select * into v_setting from public.admin_settings where key = p_key;
  if not found then
    raise exception 'unknown setting key: %', p_key using errcode = 'P0001';
  end if;

  -- value_type 별 검증
  case v_setting.value_type
    when 'int' then
      begin
        v_num := (p_value #>> '{}')::numeric;
      exception when others then
        raise exception 'value must be int for key %', p_key using errcode = '23514';
      end;
      if v_setting.min_value is not null and v_num < v_setting.min_value then
        raise exception 'value below min (%) for key %', v_setting.min_value, p_key using errcode = '23514';
      end if;
      if v_setting.max_value is not null and v_num > v_setting.max_value then
        raise exception 'value above max (%) for key %', v_setting.max_value, p_key using errcode = '23514';
      end if;
    when 'bool' then
      if jsonb_typeof(p_value) <> 'boolean' then
        raise exception 'value must be bool for key %', p_key using errcode = '23514';
      end if;
    when 'text' then
      v_text := p_value #>> '{}';
      if v_text is null or btrim(v_text) = '' then
        raise exception 'value must be non-empty text for key %', p_key using errcode = '23514';
      end if;
    when 'jsonb' then
      if jsonb_typeof(p_value) is null then
        raise exception 'value must be valid jsonb for key %', p_key using errcode = '23514';
      end if;
  end case;

  v_prev_value := v_setting.value;

  update public.admin_settings
  set value = p_value,
      updated_by = v_uid
  where key = p_key;

  insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
  values (v_uid, 'setting_change', p_key, v_prev_value, p_value, p_reason);
end;
$$;

grant execute on function public.admin_set_setting(text, jsonb, text) to authenticated;

-- ============================================================================
-- 7. 시스템 상태 RPC (read-only 대시보드)
-- ============================================================================

create or replace function public.admin_get_system_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_dry_run boolean;
  v_cron jsonb := '[]'::jsonb;
  v_topic_gen_today int := 0;
  v_kst_today_start timestamptz;
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

  v_kst_today_start := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

  select coalesce((value #>> '{}')::boolean, false) into v_dry_run
  from public.admin_settings where key = 'payout_dry_run';

  -- pg_cron 잡 — cron 스키마 권한 없으면 빈 배열
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'jobname', j.jobname,
      'schedule', j.schedule,
      'last_run_at', d.start_time,
      'last_status', d.status,
      'recent_failure_count', (
        select count(*) from cron.job_run_details rd
        where rd.jobid = j.jobid
          and rd.start_time > now() - interval '1 day'
          and rd.status = 'failed'
      )
    )), '[]'::jsonb) into v_cron
    from cron.job j
    left join lateral (
      select start_time, status from cron.job_run_details
      where jobid = j.jobid
      order by start_time desc limit 1
    ) d on true
    where j.jobname in (
      'payout-points-worker','vote-cleanup',
      'cleanup-today-candidates-7d','moderate-vote-fallback'
    );
  exception when others then
    v_cron := '[]'::jsonb;
  end;

  -- OpenAI 호출 카운트 (admin_create_rate_limit 기준)
  begin
    select coalesce(sum(count), 0)::int into v_topic_gen_today
    from public.admin_create_rate_limit
    where bucket_minute >= v_kst_today_start;
  exception when others then
    v_topic_gen_today := 0;
  end;

  return jsonb_build_object(
    'payout_dry_run', coalesce(v_dry_run, false),
    'cron_jobs', v_cron,
    'openai_today', jsonb_build_object(
      'topic_gen_today', v_topic_gen_today
    ),
    'fetched_at', now()
  );
end;
$$;

grant execute on function public.admin_get_system_status() to authenticated;

-- ============================================================================
-- 8. 사용자 관리 RPC
-- ============================================================================

create or replace function public.admin_list_users(
  p_tab text default 'all',
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  user_short text,
  nickname text,
  email text,
  created_at timestamptz,
  is_admin boolean,
  is_system boolean,
  register_blocked_until timestamptz,
  consecutive_rejections int,
  daily_rejection_count int,
  daily_rejection_date date,
  register_count bigint,
  cast_count bigint,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_search_norm text;
  v_short_norm text;
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

  if p_tab not in ('all','blocked','admin') then
    raise exception 'invalid tab: %', p_tab using errcode = '23514';
  end if;

  v_search_norm := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_short_norm := case
    when v_search_norm ~ '^[0-9a-f]{4}$' then upper(v_search_norm)
    else null
  end;

  return query
    with filtered as (
      select
        u.id,
        upper(substring(replace(u.id::text, '-', ''), 1, 4)) as user_short,
        u.nickname,
        a.email::text as email,
        u.created_at,
        coalesce(u.is_admin, false) as is_admin,
        coalesce(u.is_system, false) as is_system,
        u.register_blocked_until,
        u.consecutive_rejections,
        u.daily_rejection_count,
        u.daily_rejection_date,
        (select count(*) from public.votes v where v.author_id = u.id) as register_count,
        (select count(*) from public.vote_casts c where c.user_id = u.id) as cast_count
      from public.users u
      left join auth.users a on a.id = u.id
      where
        case p_tab
          when 'all' then true
          when 'blocked' then (u.register_blocked_until is not null and u.register_blocked_until > now())
          when 'admin' then coalesce(u.is_admin, false)
        end
        and (
          v_search_norm is null
          or lower(coalesce(u.nickname, '')) like '%' || v_search_norm || '%'
          or (v_short_norm is not null
              and upper(substring(replace(u.id::text, '-', ''), 1, 4)) = v_short_norm)
        )
    )
    select
      f.id, f.user_short, f.nickname, f.email, f.created_at,
      f.is_admin, f.is_system, f.register_blocked_until,
      f.consecutive_rejections, f.daily_rejection_count, f.daily_rejection_date,
      f.register_count, f.cast_count,
      count(*) over () as total_count
    from filtered f
    order by f.created_at desc
    limit p_limit offset p_offset;
end;
$$;

grant execute on function public.admin_list_users(text, text, int, int) to authenticated;

-- ============================================================================
-- 9. admin 권한 부여 / 회수 RPC
-- ============================================================================

create or replace function public.admin_grant_admin(
  p_target_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_already_admin boolean;
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

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason required' using errcode = '23514';
  end if;
  if p_target_user_id = v_uid then
    raise exception 'cannot grant to self' using errcode = 'P0012';
  end if;

  select coalesce(u.is_admin, false) into v_already_admin
  from public.users u where u.id = p_target_user_id;
  if not found then
    raise exception 'user not found' using errcode = 'P0001';
  end if;
  if v_already_admin then
    raise exception 'already admin' using errcode = '23505';
  end if;

  update public.users set is_admin = true where id = p_target_user_id;

  insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
  values (v_uid, 'grant_admin', p_target_user_id::text,
          to_jsonb(false), to_jsonb(true), p_reason);
end;
$$;

grant execute on function public.admin_grant_admin(uuid, text) to authenticated;

create or replace function public.admin_revoke_admin(
  p_target_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_admin_count int;
  v_target_is_admin boolean;
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

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason required' using errcode = '23514';
  end if;
  if p_target_user_id = v_uid then
    raise exception 'cannot revoke self — to prevent admin lockout' using errcode = 'P0012';
  end if;

  select coalesce(u.is_admin, false) into v_target_is_admin
  from public.users u where u.id = p_target_user_id;
  if not found then
    raise exception 'user not found' using errcode = 'P0001';
  end if;
  if not v_target_is_admin then
    raise exception 'target is not admin' using errcode = '23514';
  end if;

  select count(*) into v_admin_count from public.users where is_admin = true;
  if v_admin_count <= 1 then
    raise exception 'cannot revoke last admin' using errcode = 'P0012';
  end if;

  update public.users set is_admin = false where id = p_target_user_id;

  insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
  values (v_uid, 'revoke_admin', p_target_user_id::text,
          to_jsonb(true), to_jsonb(false), p_reason);
end;
$$;

grant execute on function public.admin_revoke_admin(uuid, text) to authenticated;

-- ============================================================================
-- 10. 감사 로그 조회 RPC
-- ============================================================================

create or replace function public.admin_get_audit_log(
  p_target_key text default null,
  p_action text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  admin_id uuid,
  admin_email text,
  action text,
  target_key text,
  prev_value jsonb,
  new_value jsonb,
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
      l.id, l.admin_id, a.email::text as admin_email,
      l.action, l.target_key, l.prev_value, l.new_value, l.reason, l.created_at
    from public.admin_settings_audit l
    left join auth.users a on a.id = l.admin_id
    where (p_target_key is null or l.target_key = p_target_key)
      and (p_action is null or l.action = p_action)
    order by l.created_at desc
    limit p_limit offset p_offset;
end;
$$;

grant execute on function public.admin_get_audit_log(text, text, int, int) to authenticated;

-- ============================================================================
-- 11. 기존 함수 admin_settings lookup 으로 재정의 (default fallback 패턴)
-- ============================================================================

-- 11-1. fn_check_daily_payout_limit — 일일 보상 캡 lookup
create or replace function public.fn_check_daily_payout_limit(
  p_user_id uuid,
  p_category text,
  p_amount int
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kst_today_start timestamptz;
  v_today_total int;
  v_limit int;
  v_setting_key text;
  v_setting_value jsonb;
begin
  v_kst_today_start := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

  v_setting_key := case p_category
    when 'behavior' then 'payout_behavior_daily_cap'
    when 'content' then 'payout_content_daily_cap'
    else 'payout_behavior_daily_cap'
  end;

  select value into v_setting_value
  from public.admin_settings where key = v_setting_key;

  v_limit := coalesce(
    (v_setting_value #>> '{}')::int,
    case p_category when 'behavior' then 20 when 'content' then 130 else 20 end
  );

  select coalesce(sum(amount), 0) into v_today_total
  from public.points_log
  where user_id = p_user_id
    and created_at >= v_kst_today_start
    and status in ('pending', 'completed')
    and public.fn_points_category(trigger) = p_category;

  return (v_today_total + p_amount) > v_limit;
end;
$$;

-- 11-2. fn_check_moderation_call — 일일 검열 호출 캡 lookup
--   p_daily_cap 인자는 호환을 위해 유지하되, 호출자가 default(20) 로 호출하면 admin_settings 우선
create or replace function public.fn_check_moderation_call(
  p_user_id uuid,
  p_daily_cap int default 20
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_count int;
  v_date date;
  v_setting_value jsonb;
  v_effective_cap int;
begin
  select value into v_setting_value
  from public.admin_settings where key = 'moderation_daily_call_cap';

  -- admin_settings 우선, 없으면 호출자 인자 사용
  v_effective_cap := coalesce((v_setting_value #>> '{}')::int, p_daily_cap);

  select daily_moderation_calls, daily_moderation_date
  into v_count, v_date
  from public.users where id = p_user_id
  for update;

  if v_date is distinct from v_today then
    update public.users
    set daily_moderation_calls = 1,
        daily_moderation_date = v_today
    where id = p_user_id;
    return true;
  end if;

  if coalesce(v_count, 0) >= v_effective_cap then
    return false;
  end if;

  update public.users
  set daily_moderation_calls = coalesce(daily_moderation_calls, 0) + 1
  where id = p_user_id;
  return true;
end;
$$;

-- 11-3. register_vote — 일일 반려 캡 lookup (>= 5 → admin_settings)
drop function if exists public.register_vote(text, text[], text, int, vote_type, boolean, boolean, text);

create or replace function public.register_vote(
  p_question text,
  p_options text[],
  p_category text,
  p_duration_minutes int,
  p_type vote_type,
  p_ad_used boolean default false,
  p_use_free_pass boolean default false,
  p_ad_token text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_normal int;
  v_today_cand int;
  v_vote_id uuid;
  v_idx int;
  v_blocked timestamptz;
  v_option text;
  v_opt_count int;
  v_pass_remaining int;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_rej_count int;
  v_rej_date date;
  v_ad_used boolean := false;
  v_free_pass_used boolean := false;
  v_setting_value jsonb;
  v_rejection_cap int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  if p_question is null or char_length(trim(p_question)) = 0 then
    raise exception 'question required' using errcode = '23514';
  end if;
  if char_length(trim(p_question)) > 60 then
    raise exception 'question too long' using errcode = '23514';
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

  if p_duration_minutes not in (5, 10, 30, 60) then
    raise exception 'invalid duration' using errcode = '23514';
  end if;
  if p_category not in ('daily', 'relationship', 'work', 'game', 'etc') then
    raise exception 'invalid category' using errcode = '23514';
  end if;
  if p_type not in ('normal', 'today_candidate') then
    raise exception 'invalid type for self-register' using errcode = '23514';
  end if;

  select register_blocked_until, daily_rejection_count, daily_rejection_date
  into v_blocked, v_rej_count, v_rej_date
  from public.users where id = v_uid;
  if v_blocked is not null and v_blocked > now() then
    raise exception 'register blocked until %', v_blocked using errcode = 'P0003';
  end if;

  -- 일일 반려 캡 (admin_settings lookup)
  select value into v_setting_value
  from public.admin_settings where key = 'moderation_daily_rejection_cap';
  v_rejection_cap := coalesce((v_setting_value #>> '{}')::int, 5);

  if v_rej_date = v_today and coalesce(v_rej_count, 0) >= v_rejection_cap then
    raise exception 'daily rejection cap reached' using errcode = 'P0008';
  end if;

  if p_type = 'normal' then
    select count(*) into v_normal
    from public.votes
    where author_id = v_uid
      and type = 'normal'
      and created_at >= date_trunc('day', now()) at time zone 'utc';

    if v_normal >= 10 then
      raise exception 'daily normal cap reached' using errcode = 'P0002';
    end if;

    if v_normal >= 2 then
      if coalesce(p_use_free_pass, false) then
        update public.users
        set free_pass_balance = free_pass_balance - 1
        where id = v_uid
          and free_pass_balance > 0
        returning free_pass_balance into v_pass_remaining;

        if not found then
          raise exception 'free pass not available' using errcode = 'P0006';
        end if;
        v_free_pass_used := true;
      elsif coalesce(p_ad_used, false) then
        if not public.fn_consume_ad_token(v_uid, p_ad_token, 'register_3plus') then
          raise exception 'ad token invalid or expired' using errcode = 'P0007';
        end if;
        v_ad_used := true;
      else
        raise exception 'ad or free pass required for 3rd+ normal vote' using errcode = 'P0004';
      end if;
    end if;

  elsif p_type = 'today_candidate' then
    if coalesce(p_use_free_pass, false) then
      raise exception 'free pass not applicable to today_candidate' using errcode = 'P0006';
    end if;

    select count(*) into v_today_cand
    from public.votes
    where author_id = v_uid
      and type = 'today_candidate'
      and created_at >= date_trunc('day', now()) at time zone 'utc';

    if v_today_cand >= 1 then
      raise exception 'daily today candidate cap reached' using errcode = 'P0002';
    end if;
  end if;

  insert into public.votes (
    author_id, question, category, type, status, duration_minutes,
    ad_used_at_register, free_pass_used_at_register
  )
  values (
    v_uid, trim(p_question), p_category, p_type, 'pending_review', p_duration_minutes,
    v_ad_used, v_free_pass_used
  )
  returning id into v_vote_id;

  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

  return v_vote_id;
end;
$$;

grant execute on function public.register_vote(text, text[], text, int, vote_type, boolean, boolean, text) to authenticated;

-- 11-4. fn_record_moderation_result — 연속 반려 임계값/차단 시간 lookup
drop function if exists public.fn_record_moderation_result(uuid, uuid, vote_type, boolean, boolean, text);

create or replace function public.fn_record_moderation_result(
  p_vote_id uuid,
  p_user_id uuid,
  p_vote_type vote_type,
  p_eligible_for_register_reward boolean,
  p_approved boolean,
  p_rejection_source text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_consecutive int;
  v_ad_used boolean;
  v_free_pass_used boolean;
  v_refund_eligible boolean;
  v_refund_count int;
  v_refund_date date;
  v_setting_value jsonb;
  v_consec_threshold int;
  v_block_min int;
begin
  if p_approved then
    update public.users
    set consecutive_rejections = 0
    where id = p_user_id;

    if p_eligible_for_register_reward then
      if p_vote_type = 'normal' then
        insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id, status)
        values (
          p_user_id, 'normal_vote_register', 2,
          'normal_vote_register:' || p_user_id::text || ':' || p_vote_id::text,
          p_vote_id, 'unclaimed'
        )
        on conflict (idempotency_key) do nothing;
      elsif p_vote_type = 'today_candidate' then
        insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id, status)
        values (
          p_user_id, 'today_candidate_register', 5,
          'today_candidate_register:' || p_user_id::text || ':' || p_vote_id::text,
          p_vote_id, 'unclaimed'
        )
        on conflict (idempotency_key) do nothing;
      end if;
    end if;
  else
    if p_rejection_source is distinct from 'call_cap' then
      update public.users
      set consecutive_rejections = consecutive_rejections + 1,
          daily_rejection_count = case
            when daily_rejection_date is distinct from v_today then 1
            else daily_rejection_count + 1
          end,
          daily_rejection_date = v_today
      where id = p_user_id
      returning consecutive_rejections into v_consecutive;

      -- 연속 반려 임계값 (admin_settings lookup)
      select value into v_setting_value
      from public.admin_settings where key = 'moderation_consecutive_threshold';
      v_consec_threshold := coalesce((v_setting_value #>> '{}')::int, 3);

      if coalesce(v_consecutive, 0) >= v_consec_threshold then
        -- 차단 지속 시간 (admin_settings lookup)
        select value into v_setting_value
        from public.admin_settings where key = 'moderation_block_duration_min';
        v_block_min := coalesce((v_setting_value #>> '{}')::int, 60);

        update public.users
        set register_blocked_until = greatest(
              coalesce(register_blocked_until, now()),
              now() + make_interval(mins => v_block_min)
            ),
            consecutive_rejections = 0
        where id = p_user_id;
      end if;
    end if;

    -- 보호 환급: LLM 반려 + (광고 또는 무료이용권 사용) + 일일 합산 캡(2) 미도달
    if p_rejection_source = 'llm' then
      select ad_used_at_register, free_pass_used_at_register
      into v_ad_used, v_free_pass_used
      from public.votes where id = p_vote_id;

      v_refund_eligible := coalesce(v_ad_used, false) or coalesce(v_free_pass_used, false);

      if v_refund_eligible then
        select daily_ad_refund_count, daily_ad_refund_date
        into v_refund_count, v_refund_date
        from public.users where id = p_user_id
        for update;

        if v_refund_date is distinct from v_today then
          update public.users
          set free_pass_balance = free_pass_balance + 1,
              daily_ad_refund_count = 1,
              daily_ad_refund_date = v_today
          where id = p_user_id;
        elsif coalesce(v_refund_count, 0) < 2 then
          update public.users
          set free_pass_balance = free_pass_balance + 1,
              daily_ad_refund_count = coalesce(daily_ad_refund_count, 0) + 1
          where id = p_user_id;
        end if;
      end if;
    end if;
  end if;
end;
$$;

grant execute on function public.fn_record_moderation_result(uuid, uuid, vote_type, boolean, boolean, text) to service_role;

-- 11-5. admin_unblock_user — 감사 로그 INSERT 추가 (시그니처/반환값 변경 없음)
create or replace function public.admin_unblock_user(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_prev_until timestamptz;
  v_prev_consecutive int;
  v_prev_daily int;
  v_prev_date date;
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

  select register_blocked_until,
         consecutive_rejections,
         daily_rejection_count,
         daily_rejection_date
    into v_prev_until,
         v_prev_consecutive,
         v_prev_daily,
         v_prev_date
    from public.users
    where id = p_user_id;

  if not found then
    raise exception 'user not found' using errcode = 'P0001';
  end if;

  update public.users
  set register_blocked_until = null,
      consecutive_rejections = 0,
      daily_rejection_count = 0,
      daily_rejection_date = null
  where id = p_user_id;

  insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
  values (
    v_uid, 'unblock_user', p_user_id::text,
    jsonb_build_object(
      'register_blocked_until', v_prev_until,
      'consecutive_rejections', coalesce(v_prev_consecutive, 0),
      'daily_rejection_count', coalesce(v_prev_daily, 0),
      'daily_rejection_date', v_prev_date
    ),
    jsonb_build_object('register_blocked_until', null),
    null
  );

  return jsonb_build_object(
    'ok', true,
    'prev', jsonb_build_object(
      'register_blocked_until', v_prev_until,
      'consecutive_rejections', coalesce(v_prev_consecutive, 0),
      'daily_rejection_count', coalesce(v_prev_daily, 0),
      'daily_rejection_date', v_prev_date
    )
  );
end;
$$;

grant execute on function public.admin_unblock_user(uuid) to authenticated;
