# Admin 설정/운영 관리 페이지 — 토스 프로모션 매핑 + 통합 설정 + 사용자/권한 관리

> **상태**: 기획 (DoD 작성 → 구현 예정)
> **목적**: 지금 SQL Editor에서 직접 만져야 하는 운영 설정값과 사용자/권한 관리를 admin SPA UI로 빼서, 수동 SQL 실수 / 출시 직후 검수 전환 사고를 줄인다.
> **위치**: `admin-page-design.md` (본체 설계서) / `admin-pre-launch-content-tools.md` (사전 컨텐츠 도구) 의 **부록 패킷**. 두 문서와 같은 위상.
> **버전**: v0.1 / 2026-05-07

---

## 0. 한 줄 요약

| 페이지 | 책임 | 핵심 동작 |
|---|---|---|
| **TossPromotionsPage** | 토스 비즈월렛 프로모션 매핑 9건 CRUD | trigger ↔ promotion_id 매핑, test_mode 토글, 누락 매핑 경고 |
| **SettingsPage** | 일일 캡 / 어뷰즈 임계값 / 운영 토글 | 하드코딩 → DB로 외부화된 값 일괄 편집, dry-run 토글, 카테고리별 그룹 |
| **SystemStatusPage** | 시크릿/배포/cron 상태 read-only 대시보드 | OPENAI_API_KEY / 비즈월렛 키 / pg_cron 잡 마지막 실행 / 광고 키 표시 |
| **UsersPage** | 사용자 관리 — 전체/차단됨/관리자 탭 | 페이지네이션·검색, 차단 해제, admin 부여/회수 |

모든 변경은 `admin_moderation_actions` 에 감사 로그가 자동 적재된다. 기존 `admin_prompts` 테이블은 본 패킷의 통합 `admin_settings` 테이블로 흡수되며, 호환성을 위해 `admin_prompts` view 로 남긴다.

---

## 1. 배경 / 문제

### 1-1. 지금의 운영 부담
- 토스 콘솔에서 발급된 9개 프로모션 ID를 매번 SQL Editor에서 INSERT/UPDATE — `toss-promotion-mapping.sql` 템플릿을 매번 열어 자리 채우기
- 검수 → 운영 전환 (`test_mode=false`) 도 SQL UPDATE
- 일일 캡 (`fn_check_daily_payout_limit` 의 20/130) / 검열 일일 캡 / 연속 반려 임계값 등이 함수 본문에 **하드코딩** 되어 있어 조정하려면 마이그레이션 필요
- `TOSS_PAYOUT_DRY_RUN` 은 환경변수라 토글 시 Edge Function 재배포
- 사용자 차단 해제는 `admin_find_user` 로 이메일/short hex 검색만 가능, 전체 목록·블록된 계정 모아보기 없음
- admin 부여는 SQL Editor에서 `update users set is_admin=true`

### 1-2. 본 패킷이 해결하는 것
- 운영자가 SQL을 한 줄도 안 쓰고 admin SPA에서 위 모든 작업 처리
- 단일 진입점(`admin_settings` 테이블)으로 운영 설정값 통합 관리
- DRY_RUN 토글 시 안전장치(확인 모달 + 상시 경고 띠 + 감사 로그)
- 사용자 관리 탭형 UI — 차단된 계정만 모아보기, 관리자 권한 일괄 관리

---

## 2. 통합 `admin_settings` 테이블 설계

### 2-1. 왜 통합인가
기존 `admin_prompts` (key, value, description) 와 본 패킷에서 추가될 운영 설정값들을 **하나의 KV 테이블** 로 합친다. 이유:
- 운영자 입장에서 진입점이 한 곳 (admin SPA의 SettingsPage 한 페이지)
- jsonb value 로 모든 타입(text, int, boolean, jsonb) 수용
- 카테고리 컬럼으로 UI 그룹핑 / 변경 위험도별 분류
- 본 베타 단계라 `admin_prompts` 데이터 이관 비용 작음

### 2-2. 스키마

```sql
create table public.admin_settings (
  key text primary key,
  value jsonb not null,
  category text not null,             -- 'toss' | 'payout' | 'moderation' | 'ad' | 'prompt' | 'system'
  value_type text not null,           -- 'text' | 'int' | 'bool' | 'jsonb'
  description text,
  -- value 가 int/bool/text 인 경우 검증 보조
  min_value numeric,
  max_value numeric,
  -- 위험도: 변경 시 확인 모달 강도 결정
  risk_level text not null default 'low'   -- 'low' | 'medium' | 'high'
    check (risk_level in ('low','medium','high')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  check (category in ('toss','payout','moderation','ad','prompt','system'))
);

create index idx_admin_settings_category on public.admin_settings(category);

-- updated_at 자동 갱신
create or replace function public.fn_admin_settings_touch()
returns trigger language plpgsql as $$
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
-- 모든 접근은 admin RPC 경유
```

### 2-3. 시드 데이터

```sql
insert into public.admin_settings (key, value, category, value_type, description, min_value, max_value, risk_level)
values
  -- payout 카테고리
  ('payout_behavior_daily_cap',       to_jsonb(20),   'payout', 'int', '행동 보상 일일 캡 (P)',    0,  1000, 'medium'),
  ('payout_content_daily_cap',        to_jsonb(130),  'payout', 'int', '컨텐츠 보상 일일 캡 (P)',  0,  1000, 'medium'),
  ('payout_dry_run',                  to_jsonb(false),'payout', 'bool','시뮬레이션 모드 (실 지급 X)', null, null, 'high'),

  -- moderation 카테고리
  ('moderation_daily_call_cap',       to_jsonb(20),   'moderation', 'int', '사용자당 일일 검열 호출 한도', 1, 200, 'medium'),
  ('moderation_daily_rejection_cap',  to_jsonb(5),    'moderation', 'int', '사용자당 일일 반려 한도(초과 시 P0008)', 1, 50, 'medium'),
  ('moderation_consecutive_threshold',to_jsonb(3),    'moderation', 'int', '연속 반려 자동 차단 임계값', 1, 10, 'medium'),
  ('moderation_block_duration_min',   to_jsonb(60),   'moderation', 'int', '자동 차단 지속 시간(분)', 5, 1440, 'medium'),

  -- ad 카테고리
  ('ad_watch_daily_cap',              to_jsonb(100),  'ad', 'int', '사용자당 일일 광고 시청 캡', 1, 500, 'medium'),

  -- system 카테고리
  ('admin_dashboard_show_dry_run_banner', to_jsonb(true), 'system', 'bool', 'DRY_RUN 활성 시 admin 상단 경고 띠 노출', null, null, 'low')
on conflict (key) do nothing;

-- 기존 admin_prompts → admin_settings (category='prompt') 이관
insert into public.admin_settings (key, value, category, value_type, description, risk_level, updated_at, updated_by)
select
  key,
  to_jsonb(value),
  'prompt',
  'text',
  description,
  'medium',
  updated_at,
  updated_by
from public.admin_prompts
on conflict (key) do nothing;
```

### 2-4. `admin_prompts` 호환 view

기존 Edge Function (`admin-generate-vote-topics`, `admin-generate-today-candidate`) 이 `admin_prompts` 직접 SELECT 하므로, 호환성 유지 위해 view 로 대체:

```sql
-- 원본 테이블 drop 전, view 가 같은 인터페이스 제공
drop table public.admin_prompts cascade;

create view public.admin_prompts as
  select
    key,
    value #>> '{}' as value,            -- jsonb → text 캐스팅 (시드는 to_jsonb('...') 형태이므로 추출)
    description,
    updated_at,
    updated_by
  from public.admin_settings
  where category = 'prompt';

grant select on public.admin_prompts to service_role;
```

> Edge Function 측 코드는 **그대로** 동작 (`select key, value from admin_prompts`). 향후 코드 리팩터링 시 `admin_settings` 직접 SELECT 로 교체.

---

## 3. TossPromotionsPage — 토스 프로모션 매핑 CRUD (A)

### 3-1. 화면 구성

```
┌──────────────────────────────────────────────────────────────┐
│ 토스 프로모션 매핑 (9건)              ⚠️ 미설정 3건           │
├──────────────────────────────────────────────────────────────┤
│ trigger                       │ promotion_id        │ test │ 액션 │
│ normal_vote_participation     │ PROMO_xxxx (편집)   │  ✅  │ 저장 │
│ normal_daily_5vote_complete   │ ⚠️ 미설정          │  ✅  │ 입력 │
│ normal_daily_attendance       │ PROMO_yyyy          │  ✅  │ 저장 │
│ normal_streak_10day           │ PROMO_zzzz          │  ✅  │ 저장 │
│ normal_streak_20day           │ ⚠️ 미설정          │  ✅  │ 입력 │
│ normal_streak_30plus          │ ⚠️ 미설정          │  ✅  │ 입력 │
│ normal_vote_register          │ PROMO_aaa           │  ❌  │ 저장 │  ← 운영 전환됨
│ today_candidate_register      │ PROMO_bbb           │  ✅  │ 저장 │
│ today_selection               │ PROMO_ccc           │  ✅  │ 저장 │
├──────────────────────────────────────────────────────────────┤
│ [모두 운영 전환 (test_mode → false)]                          │
│ [매핑 누락 알림 — 워커 unmapped 카운트 보기]                  │
└──────────────────────────────────────────────────────────────┘
```

- 행 클릭 → 우측 사이드 패널 또는 모달
  - `promotion_id` 입력 (필수)
  - `promotion_name` 메모용 표시 (편집 가능)
  - `test_mode` 토글 (검수 통과 후 false)
  - `notes` 자유 메모
- "저장" → `admin_upsert_toss_promotion` RPC
- "test → 운영 전환" 버튼: 모달 확인("실 토스포인트 지급이 시작됩니다") → `admin_upsert_toss_promotion` 으로 일괄 UPDATE
- 미설정 매핑이 있으면 상단에 빨간 배너 + 워커 호출 시 unmapped 카운트 모니터링

### 3-2. 신규 RPC

#### `admin_list_toss_promotions()`

```sql
create or replace function public.admin_list_toss_promotions()
returns table (
  trigger text,
  promotion_id text,
  promotion_name text,
  test_mode boolean,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  is_mapped boolean              -- promotion_id 가 placeholder 값('PASTE_PROMOTION_ID_HERE') 이거나 NULL 이면 false
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
```

#### `admin_upsert_toss_promotion(p_trigger, p_promotion_id, p_promotion_name, p_test_mode, p_notes)`

```sql
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

  -- trigger 화이트리스트 검증 (toss-promotion-mapping.sql 의 9개 + 향후 100명 보너스)
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

  -- 변경 전 값 (감사 로그용)
  select promotion_id, test_mode into v_prev_id, v_prev_test
  from public.toss_promotions where trigger = p_trigger;

  insert into public.toss_promotions (trigger, promotion_id, promotion_name, test_mode, notes)
  values (p_trigger, btrim(p_promotion_id), p_promotion_name, coalesce(p_test_mode, true), p_notes)
  on conflict (trigger) do update set
    promotion_id = excluded.promotion_id,
    promotion_name = coalesce(excluded.promotion_name, public.toss_promotions.promotion_name),
    test_mode = excluded.test_mode,
    notes = coalesce(excluded.notes, public.toss_promotions.notes);

  -- 감사 로그 (vote_id 컬럼 NOT NULL 가드 — admin_moderation_actions 는 vote_id 가 NOT NULL 일 가능성. 본 케이스는 vote 와 무관해서 별도 로그 테이블 필요. §10 참고)
  insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
  values (
    v_uid,
    'toss_promotion_change',
    p_trigger,
    jsonb_build_object('promotion_id', v_prev_id, 'test_mode', v_prev_test),
    jsonb_build_object('promotion_id', p_promotion_id, 'test_mode', coalesce(p_test_mode, true)),
    null
  );
end;
$$;

grant execute on function public.admin_upsert_toss_promotion(text, text, text, boolean, text) to authenticated;
```

### 3-3. 누락 매핑 경고 표시

- 페이지 로드 시 `admin_list_toss_promotions().filter(r => !r.is_mapped)` 카운트
- ≥1 이면 상단 경고 배너: "토스 프로모션 매핑 X건 누락 — 해당 트리거의 토스포인트 지급이 실패합니다"
- "누락 알림 보기" → 최근 24h `points_log.status='failed'` 이고 unmapped 사유인 row 카운트 표시 (선택, Phase 2)

---

## 4. SettingsPage — 일일 캡 / 어뷰즈 임계값 (B)

### 4-1. 화면 구성

```
┌──────────────────────────────────────────────────────────────┐
│ 운영 설정                                                     │
│ ─ 카테고리: [전체 ▾] (payout / moderation / ad / system)      │
├──────────────────────────────────────────────────────────────┤
│ 💰 PAYOUT                                                     │
│  payout_behavior_daily_cap         [   20] P  [저장]         │
│  payout_content_daily_cap          [  130] P  [저장]         │
│  payout_dry_run                    [● OFF]    [⚠️ 토글]      │
│                                                                │
│ 🛡️ MODERATION                                                 │
│  moderation_daily_call_cap         [   20]    [저장]         │
│  moderation_daily_rejection_cap    [    5]    [저장]         │
│  moderation_consecutive_threshold  [    3]    [저장]         │
│  moderation_block_duration_min     [   60]분  [저장]         │
│                                                                │
│ 📺 AD                                                         │
│  ad_watch_daily_cap                [  100]    [저장]         │
│                                                                │
│ ⚙️ SYSTEM                                                     │
│  admin_dashboard_show_dry_run_banner [● ON]   [토글]         │
└──────────────────────────────────────────────────────────────┘
```

- 행 클릭 시 인라인 편집 (int 는 number input, bool 은 토글, text 는 textarea)
- `risk_level='high'` 인 키 (예: `payout_dry_run`) 는 변경 시 **확인 모달**
- `min_value` / `max_value` 클라이언트 + RPC 양쪽에서 검증
- "저장" 시 `admin_set_setting(key, value)` RPC 호출
- 변경 이력은 우측 사이드에 마지막 5건 (`admin_settings_audit` 조회)

### 4-2. 신규 RPC

#### `admin_get_settings(p_category text default null)`

```sql
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
```

#### `admin_set_setting(p_key text, p_value jsonb, p_reason text default null)`

```sql
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
  v_bool boolean;
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
```

### 4-3. 기존 함수 lookup 적용 — `coalesce(setting, default)` 패턴

`admin_settings` 가 비어 있어도 동작 유지를 위해 **기존 하드코딩 default 를 fallback** 으로 둔다.

#### `fn_check_daily_payout_limit` 갱신

```sql
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
  v_setting jsonb;
begin
  v_kst_today_start := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

  v_setting_key := case p_category
    when 'behavior' then 'payout_behavior_daily_cap'
    when 'content' then 'payout_content_daily_cap'
    else 'payout_behavior_daily_cap'
  end;

  select value into v_setting from public.admin_settings where key = v_setting_key;
  v_limit := coalesce((v_setting #>> '{}')::int,
    case p_category when 'behavior' then 20 when 'content' then 130 else 20 end);

  select coalesce(sum(amount), 0) into v_today_total
  from public.points_log
  where user_id = p_user_id
    and created_at >= v_kst_today_start
    and status in ('pending', 'completed')
    and public.fn_points_category(trigger) = p_category;

  return (v_today_total + p_amount) > v_limit;
end;
$$;
```

#### 검열/어뷰즈 가드 갱신

`fn_check_moderation_daily_cap`, 연속 반려 자동 차단, 일일 반려 한도 함수들 각각 동일 패턴으로 `admin_settings` lookup → fallback 으로 변경. (구체 SQL 은 마이그레이션 작성 시 기존 함수 본문 그대로 복사 후 lookup 라인만 추가 — 본 문서에서는 패턴만 명세)

#### 광고 일일 캡 (`register-ad-watch` Edge Function)

Edge Function 측은 SDK 호출 직전 `admin_settings` SELECT (service_role) 로 `ad_watch_daily_cap` 값 가져옴. 미설정 시 100 fallback.

---

## 5. SystemStatusPage — Read-only 대시보드 (C)

### 5-1. 화면 구성

```
┌──────────────────────────────────────────────────────────────┐
│ 시스템 상태                                                    │
├──────────────────────────────────────────────────────────────┤
│ 🔑 시크릿 (Edge Function 환경변수)                             │
│  OPENAI_API_KEY              ✅ 설정됨                        │
│  TOSS_BIZWALLET_API_KEY      ⚠️  미설정 (DRY_RUN 자동 모드)   │
│  TOSS_BIZWALLET_BASE_URL     ⚠️  미설정                       │
│                                                                │
│ 💸 토스포인트 지급 모드                                        │
│  현재: ⚠️ 시뮬레이션 (DRY_RUN ON)  [→ 실 지급 모드로 전환]   │
│  가짜 transaction_id 발급 중                                  │
│                                                                │
│ 📺 광고 키 (빌드 타임 상수)                                    │
│  banner: ait.v2.live.cce93...                                 │
│  reward: ait.v2.live.961fe...                                 │
│  변경: src/config/ads.ts 수정 + 재배포 필요                    │
│                                                                │
│ ⏰ pg_cron 잡 (마지막 실행)                                    │
│  payout-points-worker        ✅ 5분 전     성공률 100%        │
│  vote-cleanup                ✅ 12시간 전  성공률 100%        │
│  cleanup-today-candidates-7d ✅ 12시간 전  성공률 100%        │
│  moderate-vote-fallback      ⚠️ 1시간 전   성공률 95% (실패 1건)│
│                                                                │
│ 🤖 OpenAI 호출 추이 (오늘)                                     │
│  검열 모더레이션  124건  ($0.03)                              │
│  주제 생성        12건   ($0.05)                              │
└──────────────────────────────────────────────────────────────┘
```

### 5-2. 신규 RPC — `admin_get_system_status()`

```sql
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
  v_cron jsonb;
  v_ad_keys jsonb;
  v_openai_today jsonb;
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

  -- DRY_RUN 상태 (DB 플래그)
  select (value #>> '{}')::boolean into v_dry_run
  from public.admin_settings where key = 'payout_dry_run';

  -- 시크릿 설정 여부는 DB에서 직접 알 수 없음 — Edge Function 헬스 체크에서 별도 보고
  -- (heartbeat 패턴 — §5-3)

  -- pg_cron 마지막 실행 — cron schema SELECT 권한 필요
  select jsonb_agg(jsonb_build_object(
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
  )) into v_cron
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

  -- OpenAI 호출 카운트 — moderation_logs / admin_create_rate_limit 가 있으면 합산
  select jsonb_build_object(
    'moderation_today', (
      select count(*) from public.moderation_logs
      where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
    ),
    'topic_gen_today', (
      select coalesce(sum(count), 0) from public.admin_create_rate_limit
      where bucket_minute >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
    )
  ) into v_openai_today;

  return jsonb_build_object(
    'payout_dry_run', coalesce(v_dry_run, false),
    'cron_jobs', coalesce(v_cron, '[]'::jsonb),
    'openai_today', v_openai_today,
    'fetched_at', now()
  );
end;
$$;

grant execute on function public.admin_get_system_status() to authenticated;
```

> `cron` 스키마 권한이 RPC owner(보통 supabase_admin) 에 부여되어 있어야 함. 없으면 `grant select on cron.job, cron.job_run_details to <owner>;` 별도 실행. 권한 없으면 빈 배열 반환하도록 예외 처리 추가 권장.

### 5-3. 시크릿 설정 여부 — Edge Function heartbeat (선택, Phase 2)

DB 에서 직접 환경변수 검사 불가. 두 가지 선택:

- **간단**: SystemStatusPage 에 "시크릿 상태는 `payout-points` Edge Function 호출 결과로 판단" 안내. 광고 키는 빌드 시 `src/config/ads.ts` 그대로 표시.
- **풀 모니터링** (Phase 2): 신규 Edge Function `admin-heartbeat` 가 `Deno.env.get(...)` 으로 시크릿 존재 여부 + 길이만 반환. SPA 가 페이지 로드 시 호출.

본 패킷에서는 **간단 안** 적용. heartbeat 는 추후 결정.

---

## 6. DRY_RUN 토글 안전장치 (D)

### 6-1. 흐름

1. SettingsPage 에서 `payout_dry_run` 행의 토글 클릭
2. **확인 모달** — risk_level='high' 이므로 강한 경고:
   ```
   ⚠️ 토스포인트 지급 모드 변경

   현재: 실 지급 모드 (테스트포인트가 사용자 토스 계정에 적립됩니다)
   변경 후: 시뮬레이션 모드 (가짜 transaction_id 만 발급, 실 지급 안 됨)

   변경 사유 (필수):
   [_______________________________________]

   [취소]  [변경 진행]
   ```
3. `admin_set_setting('payout_dry_run', to_jsonb(true), p_reason='검수용')` 호출
4. 다음 cron 호출(5분 후) 부터 적용
5. admin SPA 모든 페이지 상단에 **노란 경고 띠** 상시:
   `⚠️ DRY_RUN 모드 — 토스포인트 실 지급 중단 중. 활성 시각: 2026-05-07 14:32 by admin@verdict`

### 6-2. `payout-points/index.ts` 수정

기존 환경변수 fetch 를 DB lookup 으로:

```typescript
// 기존
const TOSS_PAYOUT_DRY_RUN = Deno.env.get('TOSS_PAYOUT_DRY_RUN') === '1'

// 변경 — cron 진입 시 1회 fetch
const { data: dryRunSetting } = await admin
  .from('admin_settings')
  .select('value')
  .eq('key', 'payout_dry_run')
  .single()
const TOSS_PAYOUT_DRY_RUN = (dryRunSetting?.value as boolean) ?? false

// 환경변수 fallback (DB 미설정 시 안전)
const ENV_DRY_RUN = Deno.env.get('TOSS_PAYOUT_DRY_RUN') === '1'
const FINAL_DRY_RUN = TOSS_PAYOUT_DRY_RUN || ENV_DRY_RUN
```

> 환경변수도 OR 로 살려두는 이유: DB 가 깨지거나 admin 페이지 미배포 시 emergency stop 용. 환경변수 ON 이면 DB false 여도 시뮬레이션 유지.

### 6-3. 상시 경고 띠 (admin SPA)

`admin_get_system_status()` 응답의 `payout_dry_run=true` + `admin_dashboard_show_dry_run_banner=true` 일 때 모든 페이지 최상단에 sticky 띠 렌더. 5분 마다 재폴링.

---

## 7. UsersPage — 사용자 관리 (E + F)

### 7-1. 화면 구성

```
┌──────────────────────────────────────────────────────────────┐
│ 사용자 관리                                                    │
│ [전체] [차단됨] [관리자]                                       │
│ 검색: [닉네임 / user_id 앞 4자리]               [필터 적용]    │
├──────────────────────────────────────────────────────────────┤
│ 닉네임   │ user_id │ 가입일     │ 상태       │ 액션           │
│ 홍길동   │ A1B2    │ 2026-04-30 │ ✅ 정상    │ [상세][차단해제]│
│ 김철수   │ C3D4    │ 2026-05-01 │ ⛔ 차단됨  │ [상세][해제]   │
│ 이영희   │ E5F6    │ 2026-04-15 │ 👑 admin   │ [상세][권한회수]│
├──────────────────────────────────────────────────────────────┤
│ ◀ 1 2 3 ▶                                              총 N명 │
└──────────────────────────────────────────────────────────────┘

[행 클릭 → 상세 다이얼로그]
┌─────────────────────────────────────────┐
│ 홍길동 (A1B2)                            │
│ user_id: a1b2-c3d4-...                  │
│ email: hong@example.com                 │
│ 가입: 2026-04-30 14:23                  │
│ ─ 활동 ──                                │
│   등록한 투표: 12건 (반려 1건)           │
│   참여: 84건                              │
│   포인트 적립: 1,240P (지급 1,200P)      │
│ ─ 차단 상태 ──                            │
│   register_blocked_until: NULL          │
│   consecutive_rejections: 0              │
│   daily_rejection_count: 0              │
│ ─ 권한 ──                                 │
│   is_admin: false                        │
│   is_system: false                       │
│                                          │
│ [차단 해제] [관리자 부여]  [닫기]        │
└─────────────────────────────────────────┘
```

- **전체** 탭: 모든 사용자 (페이지네이션, 가입일 desc)
- **차단됨** 탭: `register_blocked_until > now()` 또는 `daily_rejection_count >= 일일 한도` 인 행만
- **관리자** 탭: `is_admin = true`
- 검색: 닉네임 contains (대소문자 무시) / user_id 앞 4자리 (hex)
- 행 액션: 상세 / 차단 해제 / admin 부여·회수

### 7-2. 신규 RPC — `admin_list_users`

```sql
create or replace function public.admin_list_users(
  p_tab text default 'all',           -- 'all' | 'blocked' | 'admin'
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
  total_count bigint                  -- 페이지네이션 용 — window count
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
          or lower(u.nickname) like '%' || v_search_norm || '%'
          or (v_short_norm is not null
              and upper(substring(replace(u.id::text, '-', ''), 1, 4)) = v_short_norm)
        )
    )
    select
      f.*,
      count(*) over () as total_count
    from filtered f
    order by f.created_at desc
    limit p_limit offset p_offset;
end;
$$;

grant execute on function public.admin_list_users(text, text, int, int) to authenticated;
```

### 7-3. 차단 해제 — 기존 `admin_unblock_user` 재사용

이미 `20260508000001` 마이그레이션에 있음. 변경 없음. 단 본 페이지 호출 시 감사 로그도 `admin_settings_audit` 에 기록되도록 RPC 본문에 INSERT 추가 권장 (별도 마이그레이션):

```sql
-- 본 패킷에서 admin_unblock_user 본문 끝에 추가
insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
values (
  v_uid, 'unblock_user', p_user_id::text,
  jsonb_build_object('register_blocked_until', v_prev_until,
                     'consecutive_rejections', v_prev_consecutive,
                     'daily_rejection_count', v_prev_daily),
  jsonb_build_object('register_blocked_until', null),
  null
);
```

### 7-4. admin 부여/회수 (F)

#### `admin_grant_admin(p_target_user_id uuid, p_reason text)`

```sql
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
  v_target_exists boolean;
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
    raise exception 'cannot grant to self' using errcode = '23514';
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
```

#### `admin_revoke_admin(p_target_user_id uuid, p_reason text)`

```sql
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
    raise exception 'cannot revoke self — to prevent admin lockout' using errcode = '23514';
  end if;

  select coalesce(u.is_admin, false) into v_target_is_admin
  from public.users u where u.id = p_target_user_id;
  if not found then
    raise exception 'user not found' using errcode = 'P0001';
  end if;
  if not v_target_is_admin then
    raise exception 'target is not admin' using errcode = '23514';
  end if;

  -- 마지막 admin 이면 회수 차단 (자기 회수 차단과 별개 — 다른 admin 이 이 사람을 회수해도 마지막이면 거부)
  select count(*) into v_admin_count from public.users where is_admin = true;
  if v_admin_count <= 1 then
    raise exception 'cannot revoke last admin' using errcode = '23514';
  end if;

  update public.users set is_admin = false where id = p_target_user_id;

  insert into public.admin_settings_audit (admin_id, action, target_key, prev_value, new_value, reason)
  values (v_uid, 'revoke_admin', p_target_user_id::text,
          to_jsonb(true), to_jsonb(false), p_reason);
end;
$$;

grant execute on function public.admin_revoke_admin(uuid, text) to authenticated;
```

---

## 8. 감사 로그 — `admin_settings_audit` (신규)

### 8-1. 왜 새 테이블인가
기존 `admin_moderation_actions` 는 `vote_id` NOT NULL 컬럼이 있어 vote 와 무관한 감사 로그(설정 변경, 토스 매핑 변경, admin 권한 변경)에 부적합. 별도 테이블로 분리.

### 8-2. 스키마

```sql
create table public.admin_settings_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.users(id) on delete set null,
  action text not null check (action in (
    'setting_change',
    'toss_promotion_change',
    'unblock_user',
    'grant_admin',
    'revoke_admin'
  )),
  target_key text,           -- setting key / promotion trigger / target user_id (text)
  prev_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index idx_admin_settings_audit_admin on public.admin_settings_audit(admin_id, created_at desc);
create index idx_admin_settings_audit_action on public.admin_settings_audit(action, created_at desc);
create index idx_admin_settings_audit_target on public.admin_settings_audit(target_key, created_at desc);

alter table public.admin_settings_audit enable row level security;
revoke all on public.admin_settings_audit from public, anon, authenticated;
```

### 8-3. 조회 RPC — `admin_get_audit_log`

```sql
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
```

---

## 9. 신규 마이그레이션 — `20260510000001_admin_config_settings.sql`

### 9-1. 포함 항목 (작성 순서)

1. `admin_settings` 테이블 + trigger + RLS
2. 시드 데이터 INSERT (§2-3)
3. `admin_prompts` 데이터 → `admin_settings` 이관 (§2-3 후반)
4. `admin_prompts` table drop + view 재생성 (§2-4)
5. `admin_settings_audit` 테이블 + 인덱스 + RLS (§8-2)
6. RPC 8종:
   - `admin_list_toss_promotions` (§3-2)
   - `admin_upsert_toss_promotion` (§3-2)
   - `admin_get_settings` (§4-2)
   - `admin_set_setting` (§4-2)
   - `admin_get_system_status` (§5-2)
   - `admin_list_users` (§7-2)
   - `admin_grant_admin` (§7-4)
   - `admin_revoke_admin` (§7-4)
   - `admin_get_audit_log` (§8-3)
7. 기존 함수 lookup 적용:
   - `fn_check_daily_payout_limit` 재정의 (§4-3)
   - `fn_check_moderation_daily_cap` 재정의 (admin_settings lookup + fallback)
   - 연속 반려 자동 차단 가드 재정의 (admin_settings lookup)
8. `admin_unblock_user` 본문에 감사 로그 INSERT 추가 (§7-3)

### 9-2. 마이그레이션 헤더 주석 템플릿

```sql
-- 운영 설정 통합 관리 (TossPromotionsPage / SettingsPage / SystemStatusPage / UsersPage)
--
-- 본 마이그레이션은 다음을 처리:
--   1) admin_settings 통합 KV 테이블 신규 생성 (jsonb value)
--   2) 기존 admin_prompts 데이터를 admin_settings (category='prompt') 로 이관
--   3) admin_prompts 테이블을 view 로 대체 (Edge Function 호환성 유지)
--   4) admin_settings_audit 감사 로그 테이블 신규
--   5) admin_* RPC 8종 신규 (Toss 매핑 / 설정 / 사용자 / 권한 / 감사 로그 / 시스템 상태)
--   6) 기존 fn_check_* 함수들이 admin_settings 에서 lookup 하도록 재정의
--      (admin_settings 값 없으면 기존 하드코딩 default fallback)
--
-- 참고:
--   - 본 패킷의 어드민 SPA 변경은 별도 verdict-admin 레포에서 진행
--   - Edge Function payout-points/index.ts 는 별도 PR 로 환경변수 → DB 키 전환
```

---

## 10. 어드민 SPA 변경 사항 (verdict-admin 레포)

본 verdict 본 레포에는 마이그레이션만 들어가고, SPA 변경은 별도 `verdict-admin` 레포에서 진행한다.

### 10-1. 신규 페이지

- `src/pages/TossPromotionsPage.tsx` (§3)
- `src/pages/SettingsPage.tsx` (§4)
- `src/pages/SystemStatusPage.tsx` (§5)
- `src/pages/UsersPage.tsx` (§7) — 기존 차단 해제 기능 흡수

### 10-2. 신규 라이브러리 함수 (`src/lib/admin-config.ts`)

```typescript
// Toss 프로모션 매핑
export async function listTossPromotions() {
  return supabase.rpc('admin_list_toss_promotions');
}
export async function upsertTossPromotion(params: {
  trigger: string; promotion_id: string; promotion_name?: string;
  test_mode?: boolean; notes?: string;
}) {
  return supabase.rpc('admin_upsert_toss_promotion', {
    p_trigger: params.trigger,
    p_promotion_id: params.promotion_id,
    p_promotion_name: params.promotion_name ?? null,
    p_test_mode: params.test_mode ?? true,
    p_notes: params.notes ?? null,
  });
}

// 통합 설정
export async function getSettings(category?: string) {
  return supabase.rpc('admin_get_settings', { p_category: category ?? null });
}
export async function setSetting(key: string, value: unknown, reason?: string) {
  return supabase.rpc('admin_set_setting', {
    p_key: key,
    p_value: value,
    p_reason: reason ?? null,
  });
}

// 시스템 상태
export async function getSystemStatus() {
  return supabase.rpc('admin_get_system_status');
}

// 사용자 관리
export async function listUsers(params: {
  tab: 'all' | 'blocked' | 'admin';
  search?: string;
  limit?: number;
  offset?: number;
}) {
  return supabase.rpc('admin_list_users', {
    p_tab: params.tab,
    p_search: params.search ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
}
export async function unblockUser(userId: string) {
  return supabase.rpc('admin_unblock_user', { p_user_id: userId });
}
export async function grantAdmin(targetUserId: string, reason: string) {
  return supabase.rpc('admin_grant_admin', {
    p_target_user_id: targetUserId,
    p_reason: reason,
  });
}
export async function revokeAdmin(targetUserId: string, reason: string) {
  return supabase.rpc('admin_revoke_admin', {
    p_target_user_id: targetUserId,
    p_reason: reason,
  });
}

// 감사 로그
export async function getAuditLog(params: {
  target_key?: string; action?: string; limit?: number; offset?: number;
}) {
  return supabase.rpc('admin_get_audit_log', {
    p_target_key: params.target_key ?? null,
    p_action: params.action ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
}
```

### 10-3. 사이드바 항목 추가

```
📊 대시보드
📝 컨텐츠 관리
  ├ 일반투표
  ├ 신고 처리
  └ 오늘의 투표 후보
✨ 컨텐츠 생성  (admin-pre-launch-content-tools.md)
👥 사용자 관리        ← 신규 (탭: 전체/차단됨/관리자)
⚙️ 운영 설정          ← 신규 그룹
  ├ 토스 프로모션 매핑
  ├ 통합 설정
  └ 시스템 상태
📜 감사 로그          ← 신규 (선택)
```

### 10-4. 상시 경고 띠 (DRY_RUN)

`App.tsx` 또는 레이아웃 컴포넌트에서 5분마다 `getSystemStatus()` 폴링 → `payout_dry_run=true` 이면 sticky banner 렌더.

---

## 11. 보안 / 감사 정리

| 항목 | 처리 |
|---|---|
| RLS | 모든 admin RPC는 `auth.uid() + is_admin` 가드 (P0008) |
| 자가 권한 변경 | `admin_grant_admin` / `admin_revoke_admin` 모두 `p_target=v_uid` 차단 |
| 마지막 admin 락아웃 | `admin_revoke_admin` 에서 `count(is_admin)<=1` 차단 |
| 시크릿 노출 | DB·SPA 어디에도 키 값 자체 저장 X. SystemStatusPage 는 "설정됨/미설정" 만 표시 |
| DRY_RUN 사고 | risk_level='high' + 확인 모달 + 상시 경고 띠 + 환경변수 OR 우선 (emergency stop) |
| 감사 로그 | 모든 RPC 가 `admin_settings_audit` INSERT (admin_id + prev/new + reason) |
| value_type 위반 | `admin_set_setting` 에서 int/bool/text/jsonb 별 타입 검증 + min/max |
| 기존 함수 호환 | `coalesce(setting, default)` 패턴으로 admin_settings 비어 있어도 동작 유지 |

---

## 12. DoD 체크리스트 (구현 시 패킷)

### 12-1. DB (verdict 본 레포)
- [ ] `admin_settings` 테이블 + trigger + RLS + 시드 11건
- [ ] `admin_prompts` 데이터 이관 + table → view 전환
- [ ] `admin_settings_audit` 테이블 + 인덱스 + RLS
- [ ] `admin_list_toss_promotions` / `admin_upsert_toss_promotion` RPC
- [ ] `admin_get_settings` / `admin_set_setting` RPC
- [ ] `admin_get_system_status` RPC
- [ ] `admin_list_users` RPC
- [ ] `admin_grant_admin` / `admin_revoke_admin` RPC
- [ ] `admin_get_audit_log` RPC
- [ ] `fn_check_daily_payout_limit` admin_settings lookup 재정의
- [ ] `fn_check_moderation_daily_cap` 동 재정의
- [ ] 연속 반려 자동 차단 가드 재정의
- [ ] `admin_unblock_user` 감사 로그 INSERT 추가

### 12-2. Edge Function (verdict 본 레포)
- [ ] `payout-points/index.ts` — `TOSS_PAYOUT_DRY_RUN` 환경변수 OR `admin_settings.payout_dry_run` 으로 변경
- [ ] `register-ad-watch/index.ts` — 일일 캡 100 → `admin_settings.ad_watch_daily_cap` lookup

### 12-3. Verdict-admin SPA (별도 레포)
- [ ] `TossPromotionsPage` — 9건 매핑 CRUD + 누락 경고
- [ ] `SettingsPage` — 카테고리별 그룹 + risk_level 별 확인 모달
- [ ] `SystemStatusPage` — 시크릿/cron/광고 키 read-only
- [ ] `UsersPage` — 탭형(전체/차단됨/관리자) + 검색 + 차단 해제 + admin 부여/회수
- [ ] `AuditLogPage` (선택) — 감사 로그 타임라인
- [ ] DRY_RUN 상시 경고 띠 (App 레이아웃)
- [ ] `src/lib/admin-config.ts` lib 함수
- [ ] 사이드바 신규 그룹 ("운영 설정")

### 12-4. 운영 검증 (스모크)
- [ ] 토스 프로모션 9건 매핑 입력 → `admin_list_toss_promotions().is_mapped=true` 확인
- [ ] `admin_set_setting('payout_behavior_daily_cap', to_jsonb(50))` → `fn_check_daily_payout_limit` 가 50 으로 동작 확인
- [ ] DRY_RUN 토글 → 다음 cron 5분 후 `points_log.toss_transaction_id LIKE 'simulated-%'` 확인
- [ ] DRY_RUN OFF → `points_log.toss_transaction_id` 가 실 토스 응답 ID 형식 확인
- [ ] 차단된 계정에 본인 토스 인증으로 등록 시도 → P0003 거부 → admin SPA 에서 해제 → 재등록 성공
- [ ] 다른 사용자에게 admin 부여 → 그 사용자가 admin SPA 로그인 가능
- [ ] 본인이 본인 admin 회수 시도 → P0001 거부
- [ ] 마지막 admin 회수 시도 → 23514 거부
- [ ] 모든 변경이 `admin_settings_audit` 에 기록 확인

---

## 13. 미정 사항 / 추후 결정

| 항목 | 옵션 | 비고 |
|---|---|---|
| 시크릿 heartbeat | SystemStatusPage 안내문 vs `admin-heartbeat` Edge Function | 본 패킷은 안내문만, heartbeat 는 Phase 2 |
| 광고 키 admin 변경 | 빌드타임 상수 유지 vs DB 외부화 | 변경 빈도 낮아 read-only 표시만. DB 외부화는 SDK init 흐름 변경 필요 — 별도 패킷 |
| 비즈월렛 잔액 | admin SPA 표시 | 토스 API 별도 호출 필요. Phase 3 |
| `admin_settings` 외래 의존 | 일부 키 삭제 시 기존 RPC default 로 자동 fallback | 안전한 패턴이라 별도 가드 불필요 |
| 100명 보너스 trigger | `normal_100_participants_bonus` 매핑 추후 추가 | 본 패킷의 화이트리스트에 미리 포함시킴 (§3-2) |

---

## 14. 의존성

| 사전 조건 | 상태 |
|---|---|
| `users.is_admin` 컬럼 | ✅ (`20260430000011`) |
| `users.is_system` 컬럼 | ✅ (`20260509000001`) |
| `toss_promotions` 테이블 | ✅ (`20260504000009`) |
| `admin_prompts` 테이블 (이관 대상) | ✅ (`20260509000001`) |
| `admin_moderation_actions` 테이블 (별도 — 본 패킷은 admin_settings_audit 사용) | ✅ |
| `cron` 스키마 SELECT 권한 (system status 용) | ⏳ 마이그레이션에서 확인 |
| 어드민 SPA 레포 (`verdict-admin`) Phase 1 진행 | ⏳ |

---

## 15. 다음 단계

1. **본 verdict 레포에서** `20260510000001_admin_config_settings.sql` 마이그레이션 작성
2. **본 verdict 레포에서** `payout-points/index.ts` DRY_RUN DB lookup 으로 전환
3. **본 verdict 레포에서** `register-ad-watch/index.ts` 일일 캡 admin_settings lookup 으로 전환
4. **verdict-admin 별도 레포에서** 신규 4개 페이지 + lib 구현 (본 문서 §10 참조)
5. 베타 디바이스에서 토스 프로모션 9건 입력 + 검수 완료 후 운영 전환
6. DRY_RUN OFF 전환 + 5분 cron 후 실 지급 동작 확인

---

*문서 버전: v0.1 | 작성: 2026-05-07 | 별도 패킷, 기존 기획 비파괴*
