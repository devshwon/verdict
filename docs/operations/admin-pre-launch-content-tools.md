# Admin 사전 운영 컨텐츠 도구 — 일반투표 직접 등록 + 오늘의 투표 수동 발행

> **상태**: 기획 (DoD 작성 → 구현 예정)
> **목적**: 상용화 전(=실사용자 유입 전) 컨텐츠 풀 부족·후보 0건 상황에서 운영자가 직접 컨텐츠를 채워 서비스 빈손 노출을 방지.
> **위치**: 기존 `admin-page-design.md`(verdict-admin SPA 설계서)의 **부록 패킷**. Phase 1 위에 얹는 추가 도구이며, 본 문서는 **상용화 시점에 sunset(§9)** 한다.
> **버전**: v0.1 / 2026-05-05

---

## 0. 한 줄 요약

| 도구 | 트리거 | 흐름 |
|---|---|---|
| **일반투표 일괄 생성기** | 운영자가 카테고리 선택 + "AI 주제 생성" 클릭 | OpenAI가 2~5개 흥미로운 주제 카드 반환 → 운영자가 편집/취사 → "등록" 클릭 시 `votes(type='normal')` 일괄 INSERT |
| **오늘의 투표 즉시 등록기** | 어제 후보 풀에 해당 카테고리가 0건일 때 (또는 운영자 판단으로 강제) | "AI 후보 생성"으로 1건 자동 생성 **또는** 직접 입력 폼 → 카테고리당 1건 → `votes(type='today')`로 직접 INSERT (today_candidate 단계 우회) |

두 도구 모두 **운영 봇 계정(`bot_user_id`)** 명의로 등록되며, 사용자 `register_vote` RPC와 별도 admin RPC를 통해 일일 캡/광고 게이트/일일 후보 캡을 우회한다.

---

## 1. 배경 / 문제

### 1-1. 상용화 전 시점의 컨텐츠 공백
- 베타·내부 테스트 중에는 신규 등록 일반투표가 하루 0~5건 수준
- 일반 피드가 빈손 → 첫 사용자가 빈 화면을 보고 이탈
- `today_candidate` 풀에 카테고리별 후보가 0건일 수 있음 → 다음날 오늘의 투표 발행 불가 → 4-카테고리 카드 슬롯 하나가 빔

### 1-2. 기존 운영 도구의 한계
- `admin-page-design.md` Phase 1 `CandidatesPage`는 **기존 후보를 선택**할 뿐, 후보 자체를 만들 수 없음
- Phase 2 `auto-rank-today` cron도 후보 풀이 비어 있으면 무력
- 운영자가 본인 토스 계정으로 매일 4건 등록하는 우회는 부자연스럽고 보상 적립까지 자기 자신에게 들어감 → 통계 오염

### 1-3. 본 패킷이 해결하는 것
- 운영자가 어드민 UI에서 **OpenAI로 흥미로운 주제를 다량 자동 생성** → 검토 → 일괄 등록
- 어제 후보 풀이 비었어도 **당일 강제로 오늘의 투표를 발행**할 수 있는 비상 등록기 제공
- 모든 운영 자동 컨텐츠는 별도 봇 계정 명의 → 사용자 통계와 분리, 보상 적립 없음

---

## 2. 운영 봇 계정 (`bot_user_id`) 설계

### 2-1. 단일 시스템 사용자
- `users` 테이블에 1행 추가 (`is_admin=false`, `is_system=true` 신규 컬럼)
- 모든 운영 자동 등록 vote의 `author_id`로 사용
- 닉네임: `Verdict 운영팀` (UI에서는 시스템 뱃지 표기)
- 토스 인증 미연동 → `toss_user_key=null`, `phone_verified=false`

### 2-2. 신규 컬럼 — `users.is_system boolean default false`
```sql
alter table public.users add column if not exists is_system boolean not null default false;
create index if not exists idx_users_is_system on public.users(id) where is_system;
```

### 2-3. 시스템 vote 식별
- `votes`에 `is_system_authored boolean` 추가 안 함 (조인으로 판단 가능 + 컬럼 증식 회피)
- 통계/마이페이지에서 `author_id = bot_user_id`인 vote는:
  - **참여**: 일반 사용자에게 그대로 노출 (정상 컨텐츠로 동작)
  - **마이페이지 "내가 쓴 투표"**: 봇 계정 자체 사용 안 하므로 노출 케이스 없음
  - **보상 적립**: §3·§4의 admin RPC가 `points_log` INSERT 자체를 안 함

### 2-4. 운영 봇 계정 부트스트랩 마이그레이션 (예시)
```sql
-- 시스템 사용자 단일 행 보장
insert into public.users (id, nickname, is_system, is_admin)
values ('00000000-0000-0000-0000-000000000001', 'Verdict 운영팀', true, false)
on conflict (id) do nothing;
```
> UUID는 고정값 사용해 환경 간 통일. Auth user(=auth.users)와는 무관 — 본 행은 `public.users`에만 존재하는 가상 사용자.

### 2-5. 환경변수
- Edge Function에 `BOT_USER_ID=00000000-0000-0000-0000-000000000001`로 주입
- 어드민 SPA에는 노출 안 함 (RPC가 내부에서 사용)

---

## 3. 일반투표 일괄 생성기 (Bulk Normal Vote Composer)

### 3-1. 사용자 시나리오
1. 운영자가 어드민 SPA → "컨텐츠 생성" 메뉴 → "일반투표 생성기" 진입
2. 카테고리 선택 (`daily / relationship / work / game / etc` 중 하나, 또는 "전체 분산")
3. 생성 개수 슬라이더: 2~5건 (기본 3건)
4. **[AI 주제 생성]** 버튼 클릭
5. 0.5~3초 후 카드 N개 등장 — 각 카드:
   - 카테고리 뱃지
   - 질문 (60자 이내, 편집 가능)
   - 선택지 2~5개 (각 30자 이내, 편집/추가/삭제 가능)
   - 마감 시간 드롭다운 (10/30/60/360/1440 분, 기본 1440)
   - "X 제외" 버튼 / "재생성" 버튼 (개별 카드 1건만 다시 뽑기)
6. **[모두 등록]** 또는 카드별 **[등록]** 클릭 → 일괄/단일 INSERT
7. 등록된 카드는 회색 처리 + "등록 완료 ✓" 뱃지

### 3-2. 화면 모형
```
┌─────────────────────────────────────────────────────┐
│ 일반투표 생성기                        [등록 이력 ▾]│
├─────────────────────────────────────────────────────┤
│ 카테고리: [일상 ▾]   생성 개수: [● 3개]             │
│ 마감 기본값: [1440분 (24시간) ▾]                     │
│                              [✨ AI 주제 생성]      │
├─────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐            │
│ │ [일상]                  [재생성] [×] │            │
│ │ Q: 카톡 1분만에 답 안 오면 답답해?    │            │
│ │  ① 답답해                            │            │
│ │  ② 신경 안 써                        │            │
│ │  [+ 선택지 추가]                     │            │
│ │ 마감: [1440분 ▾]            [등록]   │            │
│ └──────────────────────────────────────┘            │
│ ┌──────────────────────────────────────┐            │
│ │ ... 카드 2 ...                       │            │
│ └──────────────────────────────────────┘            │
│ ┌──────────────────────────────────────┐            │
│ │ ... 카드 3 ...                       │            │
│ └──────────────────────────────────────┘            │
│                              [모두 등록 (3건)]      │
└─────────────────────────────────────────────────────┘
```

### 3-3. Edge Function — `admin-generate-vote-topics`
경로: `supabase/functions/admin-generate-vote-topics/index.ts`

요청:
```json
{
  "category": "daily",       // daily | relationship | work | game | etc
  "count": 3,                 // 2~5
  "exclude_questions": ["..."]// 선택, 직전 라운드에서 보여준 주제 (중복 회피)
}
```

응답:
```json
{
  "items": [
    {
      "question": "카톡 1분만에 답 안 오면 답답해?",
      "options": ["답답해", "신경 안 써"]
    },
    { "question": "...", "options": ["...","..."] }
  ],
  "prompt_version": "v1-2026-05-05"
}
```

흐름:
1. `Authorization: Bearer <user JWT>` 검증 → service_role 클라이언트로 `users.is_admin` 확인 (P0008)
2. `admin_prompts`에서 `normal_vote_gen_system`, `normal_vote_gen_user` 조회 (없으면 기본값 fallback)
3. `{category}` `{count}` `{exclude}` placeholder 치환
4. OpenAI Chat Completions 호출 (gpt-5.4-nano, JSON 모드, temperature=0.9)
5. 응답 JSON 검증:
   - `items.length` ∈ [2, 5]
   - 각 question: 4~60자
   - 각 options: 2~5개, 각 1~30자, 중복 없음
   - 검증 실패 → 1회 재시도, 그래도 실패 시 4xx 반환
6. 검증 통과 항목만 반환 (DB 저장 없음 — 미리보기 단계)

비용 추정 (1회 생성):
- 입력 ~600 토큰, 출력 ~250 토큰
- gpt-5.4-nano: 모델 단가 기준 재산정 필요

### 3-4. 신규 RPC — `admin_create_normal_vote`
파일: 신규 마이그레이션 (§7)

```sql
create or replace function public.admin_create_normal_vote(
  p_question text,
  p_options text[],
  p_category text,
  p_duration_minutes int,
  p_skip_moderation boolean default true   -- 운영 등록은 검열 우회
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
  select coalesce(is_admin, false) into v_is_admin from public.users where id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  -- 입력 검증 (register_vote와 동일 규칙 — 사용자 vote와 형식 일관성 유지)
  if p_question is null or char_length(trim(p_question)) < 4 then
    raise exception 'question too short' using errcode = '23514';
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
  if p_duration_minutes not in (10, 30, 60, 360, 1440) then
    raise exception 'invalid duration' using errcode = '23514';
  end if;
  if p_category not in ('daily', 'relationship', 'work', 'game', 'etc') then
    raise exception 'invalid category' using errcode = '23514';
  end if;

  -- 봇 계정 명의 + status='active' (운영 등록은 즉시 활성)
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

  -- points_log INSERT 안 함 — 봇은 보상 대상 아님
  -- admin_moderation_actions에 action='admin_create_normal' 기록
  insert into public.admin_moderation_actions (vote_id, admin_id, action, reason)
  values (v_vote_id, v_uid, 'admin_create_normal', 'pre-launch content seeding');

  return v_vote_id;
end;
$$;

grant execute on function public.admin_create_normal_vote(text, text[], text, int, boolean) to authenticated;
```

> `admin_moderation_actions.action`의 CHECK 제약을 `('soft_delete','restore','admin_create_normal','admin_create_today')`로 확장하는 ALTER 가 본 패킷 마이그레이션에 포함된다.

### 3-5. 일괄 등록 동작
- 어드민 SPA가 카드별로 위 RPC를 순차 호출 (또는 신규 `admin_create_normal_votes_bulk(p_items jsonb)` 한 번 호출 — 권장: 단건 호출 N회로 단순화. 카드별 결과 표기 용이)
- 한 카드 실패해도 나머지 진행, 실패는 카드 위 빨간 토스트 + 사유 표시
- 응답 `vote_id`는 카드에 저장 → "보기" 버튼으로 본 앱 상세 페이지 이동 (`/vote/:id`)

---

## 4. 오늘의 투표 즉시 등록기 (Today Vote Emergency Composer)

### 4-1. 사용자 시나리오
1. 운영자가 `CandidatesPage` 진입 → 카테고리별 후보 카운트 확인
2. **후보 0건 카테고리**에 빨간 경고 배지 + **[즉시 등록]** 버튼 노출
3. 클릭 시 모달:
   - **[✨ AI 후보 생성]** 버튼 (1건만 생성)
   - **[직접 입력]** 토글 (질문 + 선택지 폼)
   - 발행일: 기본 오늘(KST), 변경 가능 (오늘/내일만)
4. 운영자가 검토/편집 후 **[발행]** → `votes(type='today')` 직접 INSERT
5. 모달 닫히고 카테고리 카드에 "✅ 발행됨 (운영팀 직접 등록)" 표기

### 4-2. 화면 모형
```
┌─────────────────────────────────────────────────────┐
│ 오늘의 투표 후보 (발행 대상일: 2026-05-05)          │
├─────────────────────────────────────────────────────┤
│ [일상]    후보 12건  ✅ 발행됨                       │
│ [연애]    후보  3건  → 선택 대기                     │
│ [직장]    후보  0건  ⚠️  [즉시 등록]                │
│ [게임]    후보  5건  → 선택 대기                     │
└─────────────────────────────────────────────────────┘

[즉시 등록] 클릭 시 모달:
┌──────────────────────────────────────┐
│ 오늘의 투표 즉시 등록 — [직장]       │
│ 발행일: [2026-05-05 ▾]               │
├──────────────────────────────────────┤
│ ◉ AI 자동 생성   ○ 직접 입력          │
│                                      │
│ [✨ AI 후보 생성]                    │
│   ──생성 결과──                      │
│   Q: 야근 수당 없는 야근 그냥 해?    │
│    ① 그냥 한다 ② 안 한다             │
│   [재생성] [편집]                    │
│                                      │
│            [취소]    [발행]          │
└──────────────────────────────────────┘
```

### 4-3. Edge Function — `admin-generate-today-candidate`
경로: `supabase/functions/admin-generate-today-candidate/index.ts`

요청:
```json
{ "category": "work" }   // daily | relationship | work | game (etc 제외)
```

응답:
```json
{
  "question": "야근 수당 없는 야근 그냥 해?",
  "options": ["그냥 한다", "안 한다"],
  "prompt_version": "v1-2026-05-05"
}
```

흐름은 §3-3과 동일하되, `admin_prompts`의 `today_vote_gen_system` / `today_vote_gen_user` 사용. 항상 1건만 생성.

### 4-4. 신규 RPC — `admin_create_today_vote`
```sql
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
  v_existing uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;
  select coalesce(is_admin, false) into v_is_admin from public.users where id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  if p_category not in ('daily', 'relationship', 'work', 'game') then
    raise exception 'invalid today category: %', p_category using errcode = '23514';
  end if;

  -- 동일 발행일·카테고리에 이미 today vote가 있으면 차단 (idempotent)
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

  -- (입력 검증은 §3-4와 동일 — 생략)

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

  v_opt_count := array_length(p_options, 1);
  for v_idx in 1..v_opt_count loop
    insert into public.vote_options (vote_id, option_text, display_order)
    values (v_vote_id, trim(p_options[v_idx]), v_idx);
  end loop;

  -- today_selection 보상 INSERT 안 함 (봇 계정)

  insert into public.admin_moderation_actions (vote_id, admin_id, action, reason)
  values (v_vote_id, v_uid, 'admin_create_today', format('emergency publish %s/%s', p_publish_date, p_category));

  return v_vote_id;
end;
$$;

grant execute on function public.admin_create_today_vote(text, text[], text, date) to authenticated;
```

### 4-5. 검증 정책
- **idempotency**: 동일 (publish_date, category)에 이미 active today가 있으면 23505 에러 → SPA가 "이미 발행됨" 토스트
- **대상 카테고리**: `etc` 제외 (오늘의 투표 카드 슬롯 4개 = `TODAY_CARD_CATEGORIES`)
- **발행일 범위**: SPA에서 오늘/내일만 허용 (과거 발행 = 데이터 정합성 사고 가능). RPC 자체는 임의 날짜 허용 — UI에서 가드.
- **봇 명의 today vote는 promote_today_candidates 흐름과 무관**: 본 RPC는 type='today'로 직접 생성하므로 today_candidate 단계 없음, today_rankings/auto_selections에 기록 안 함

---

## 5. `admin_prompts` 테이블 — 프롬프트 외부화

### 5-1. 신규 테이블 (Phase 2 계획에 있던 테이블을 본 패킷에서 선반입)
```sql
create table if not exists public.admin_prompts (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);
alter table public.admin_prompts enable row level security;
revoke all on public.admin_prompts from public, anon, authenticated;
-- 모든 접근은 admin RPC 경유 (§5-3)
```

### 5-2. 시드 — 본 패킷용 4개 키
```sql
insert into public.admin_prompts (key, value, description) values
('normal_vote_gen_system', $$
당신은 한국어 소셜 투표 앱 Verdict의 콘텐츠 큐레이터입니다.
20~40대 한국 사용자가 술자리/단톡방에서 가볍게 던질 만한,
의견이 갈리는 주제로 투표 후보를 만듭니다.

규칙:
- 정치/종교/혐오/특정 인물 비방 금지
- 정답이 명백한 질문 금지 (의견이 갈리는 회색지대)
- 한국 일상 맥락 (한국 직장 문화, 한국 연애 매너, 한국 게임 유저 논쟁 등)
- 질문은 60자 이내 캐주얼한 반말체
- 선택지는 2~3개 권장, 각 30자 이내, 중립적이지 않게 대비되도록
- 출력은 반드시 지정된 JSON 스키마만
$$, '일반투표 일괄 생성기 — system'),

('normal_vote_gen_user', $$
카테고리: {category}
생성 개수: {count}
직전 라운드에서 보여준 질문 (중복 회피):
{exclude}

JSON으로만 응답:
{
  "items": [
    { "question": "...", "options": ["...","..."] },
    ...
  ]
}
$$, '일반투표 일괄 생성기 — user 템플릿'),

('today_vote_gen_system', $$
당신은 한국어 소셜 투표 앱 Verdict의 "오늘의 투표" 큐레이터입니다.
오늘의 투표는 하루에 카테고리당 1건만 노출되는 메인 컨텐츠로,
일반 투표보다 더 많은 사용자가 참여하기를 기대합니다.

규칙:
- 의견이 정확히 50:50 근처로 갈릴 것 같은 주제 우선
- 카테고리 정체성에 맞는 주제 (daily=일상/소비/습관, relationship=연애·친구·가족, work=직장·학교, game=게임 유저 논쟁)
- 질문 60자 이내 반말, 선택지 2개 권장 (양자택일이 가장 강력)
- 정치/종교/혐오/비방 금지
- 출력은 반드시 지정된 JSON 스키마만
$$, '오늘의 투표 즉시 등록기 — system'),

('today_vote_gen_user', $$
카테고리: {category}

JSON으로만 응답:
{
  "question": "...",
  "options": ["...","..."]
}
$$, '오늘의 투표 즉시 등록기 — user 템플릿')
on conflict (key) do nothing;
```

### 5-3. 신규 RPC — 프롬프트 CRUD
- `admin_get_prompts()` — 모든 키 반환 (admin only)
- `admin_set_prompt(p_key text, p_value text)` — UPSERT, `updated_by=auth.uid()`
- 두 RPC 모두 `is_admin` 가드 (P0008)
- Edge Function은 service_role로 직접 SELECT (RPC 우회)

> 본 RPC는 §3·§4의 도구가 동작하기 위한 최소 인프라. PromptsPage UI는 admin-page-design.md Phase 2에 이미 명세되어 있으므로 본 패킷에서는 **RPC와 시드만** 추가하고 UI는 임시로 Supabase Dashboard 직접 편집으로 운영.

---

## 6. 권한 / 보안 정리

| 항목 | 처리 |
|---|---|
| 봇 계정 vote의 RLS | 기존 `votes_public_select`로 모두 노출 (정상 컨텐츠) |
| 봇 계정 vote의 신고/검열 | 일반 vote와 동일 처리 — 운영 자체 컨텐츠도 사용자 신고 5건+ 시 `blinded_by_reports` |
| 봇 계정 사칭 | 봇 user_id는 auth.users에 없으므로 로그인 자체 불가 |
| RPC 호출 권한 | `authenticated` role + 함수 내부 `is_admin` 가드 (P0008) — anon/anonymous JWT 차단 |
| OpenAI 키 | Edge Function 환경변수 (`OPENAI_API_KEY`)만, SPA에 노출 없음 |
| 비용 폭주 방어 | Edge Function 단에 IP/사용자별 분당 5회, 일일 100회 캡 (§7-3) |
| 감사 로그 | `admin_moderation_actions(action='admin_create_normal'/'admin_create_today')`에 운영자 ID + 사유 자동 기록 |

---

## 7. 신규 마이그레이션 — `20260509000001_admin_prelaunch_tools.sql`

### 7-1. 포함 항목
1. `users.is_system` 컬럼 + 봇 계정 부트스트랩 INSERT (§2)
2. `admin_prompts` 테이블 + 4건 시드 (§5)
3. `admin_moderation_actions.action` CHECK 확장 (`admin_create_normal`, `admin_create_today` 추가)
4. `admin_create_normal_vote` RPC (§3-4)
5. `admin_create_today_vote` RPC (§4-4)
6. `admin_get_prompts` / `admin_set_prompt` RPC (§5-3)
7. `admin_create_rate_limit` 테이블 (§7-3)

### 7-2. 작성 순서 (위 순서대로)
- 봇 user 부트스트랩이 가장 먼저 (FK 의존성 없음)
- 컬럼 ALTER → 테이블 CREATE → RPC CREATE 순

### 7-3. 비용/속도 제한 — `admin_create_rate_limit`
```sql
create table if not exists public.admin_create_rate_limit (
  admin_id uuid not null references public.users(id) on delete cascade,
  bucket_minute timestamptz not null,
  count int not null default 0,
  primary key (admin_id, bucket_minute)
);

-- 두 admin_create_* RPC 모두 호출 직후:
--   현재 분 bucket UPSERT, count >= 5 → P0009 raise
--   당일 합계 >= 100 → P0009 raise
```
> 현실적으로 운영자 한 명이 분당 5건/일 100건을 초과할 일은 거의 없지만, OpenAI 비용 사고와 RPC 자동화 오남용 방어용 안전망.

---

## 8. 어드민 SPA 변경 사항 (verdict-admin 레포)

> 본 문서가 정의하는 SPA 변경은 **별도 레포 `verdict-admin`** 작업이다. 본 verdict 레포에는 마이그레이션과 Edge Function만 들어간다.

### 8-1. 신규 페이지
- `src/pages/CreateNormalVotesPage.tsx` — §3-2 화면
- `CandidatesPage.tsx` 내 모달 추가 — §4-2 즉시 등록 모달

### 8-2. 신규 라이브러리 함수 (`src/lib/admin-create.ts`)
```typescript
export async function generateNormalVoteTopics(category: string, count: number, exclude: string[]) {
  // /functions/v1/admin-generate-vote-topics POST
}
export async function createNormalVote(item: { question, options, category, duration_minutes }) {
  return supabase.rpc('admin_create_normal_vote', { ... });
}
export async function generateTodayCandidate(category: string) {
  // /functions/v1/admin-generate-today-candidate POST
}
export async function createTodayVote(item: { question, options, category, publish_date }) {
  return supabase.rpc('admin_create_today_vote', { ... });
}
```

### 8-3. 사이드바 항목 추가
- "컨텐츠 생성" 섹션 (Phase 1 신규)
  - 일반투표 생성기
  - (오늘의 투표 즉시 등록은 CandidatesPage 내 인라인이라 별도 메뉴 X)

---

## 9. 베타 종료 후 처리 (Sunset 정책)

### 9-1. 트리거 조건
- DAU 1,000 도달 **또는** 일평균 사용자 등록 일반투표 50건+ 도달 시점
- 이후 운영 자동 컨텐츠 비중이 **카테고리당 일 신규 등록의 20% 이하**로 떨어지면 단계적 sunset

### 9-2. Sunset 단계
1. **1단계 — 일반투표 생성기 비활성화**: 어드민 SPA에서 메뉴 숨김 (RPC는 살려둠 — 비상시 재개)
2. **2단계 — 오늘의 투표 즉시 등록 제한**: 후보 0건일 때만 노출 (현재 정책 유지). 평소엔 숨김.
3. **3단계 — 봇 계정 컨텐츠 정책 결정**: 기존 봇 컨텐츠를 그대로 둘지, `is_system=true`인 author의 일반투표를 피드 노출에서 제외할지 운영 메트릭 보고 결정

### 9-3. 완전 제거 시
- 본 문서 자체를 `docs/operations/_archive/`로 이동
- RPC `drop function`, 테이블 `drop table` (마이그레이션 작성)
- 봇 계정은 보존 (FK 깨짐 방지)

---

## 10. DoD 체크리스트 (구현 시 패킷)

### 10-1. DB
- [ ] `users.is_system` 컬럼 추가 + 봇 user 부트스트랩
- [ ] `admin_prompts` 테이블 + 4건 시드
- [ ] `admin_moderation_actions.action` CHECK 확장
- [ ] `admin_create_normal_vote` RPC
- [ ] `admin_create_today_vote` RPC
- [ ] `admin_get_prompts` / `admin_set_prompt` RPC
- [ ] `admin_create_rate_limit` 테이블 + RPC 내부 카운터

### 10-2. Edge Functions
- [ ] `admin-generate-vote-topics` (Deno + OpenAI gpt-5.4-nano)
- [ ] `admin-generate-today-candidate` (동일 스택)
- [ ] 두 함수 모두 JWT 검증 + `is_admin` 확인 + JSON 스키마 검증 + 1회 재시도

### 10-3. Verdict-admin SPA (별도 레포)
- [ ] `CreateNormalVotesPage` 화면 + 카드 편집/등록
- [ ] `CandidatesPage` 모달 — 즉시 등록 흐름
- [ ] 사이드바 "컨텐츠 생성" 섹션

### 10-4. 운영 검증 (스모크)
- [ ] 운영자 1명에 `is_admin=true` 부여
- [ ] 일반투표 카테고리별 3건씩 생성 → 본 앱 피드에 노출 확인
- [ ] 오늘의 투표 카테고리 1개에 후보 0 상태 만들기 → 즉시 등록 → 메인 카드 노출 확인
- [ ] 봇 계정 vote 참여/결과 동작 확인 (보상 적립 없음 확인)
- [ ] `admin_moderation_actions`에 audit row 생성 확인
- [ ] OpenAI 키 미설정 환경에서 graceful 에러 (4xx + 메시지) 확인

---

## 11. 미정 사항 / 추후 결정

| 항목 | 옵션 | 비고 |
|---|---|---|
| 봇 vote의 마감 시간 기본값 | 24h(1440) vs 카테고리별 차등 | 일단 1440 고정으로 시작, 데이터 보고 조정 |
| 일반투표 생성기 — 자동 일정 | 수동 트리거만 vs cron으로 매일 자동 N건 | 베타 1주차는 수동만. 이후 cron 도입 검토 |
| 오늘의 투표 즉시 등록 — etc 카테고리 | 현재 제외 | TODAY_CARD_CATEGORIES와 정합 — 변경 시 디자인 토큰 동시 변경 필요 |
| 봇 vote 리워드 | 영구 비지급 | 변경 시 §3-4 / §4-4 RPC 갱신 |
| 프롬프트 PromptsPage UI | 본 패킷 vs Phase 2 | 본 패킷에서는 RPC만, UI는 Phase 2 또는 Supabase Dashboard 임시 |
| 봇 계정 닉네임 표기 | "Verdict 운영팀" 그대로 vs "에디터픽" 같은 자연스러운 라벨 | 카피 작업 필요 |

---

## 12. 의존성

| 사전 조건 | 상태 |
|---|---|
| `users.is_admin` 컬럼 | ✅ (`20260430000011`) |
| `admin_moderation_actions` 테이블 | ✅ (`20260506000001`) |
| `votes` / `vote_options` / `vote_type` enum | ✅ (`20260429000000`) |
| `OPENAI_API_KEY` Supabase secret | ✅ (검열용 재사용) |
| 어드민 SPA 레포 (`verdict-admin`) 셋업 | ⏳ admin-page-design.md Phase 1 진행 필요 |

---

*문서 버전: v0.1 | 작성: 2026-05-05 | 별도 패킷, 기존 기획 비파괴*
