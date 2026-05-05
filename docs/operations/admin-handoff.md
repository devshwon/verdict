# Verdict Admin 인수인계

> 별도 React SPA 프로젝트(`verdict-admin`)에서 이 파일만 가지고 시작할 수 있도록 정리한 단일 인수인계 문서.
> 본체 레포(`verdict`)와 같은 Supabase 프로젝트를 공유한다.
> 관리 범위: 카테고리별 일반투표 관리 / 신고 처리 / 오늘의 투표 후보 선정 / 자동 랭킹 검토 / OpenAI 프롬프트 편집.

---

## 0. TL;DR — 시작 전에 알아야 할 것

| 항목 | 값 |
|---|---|
| 프레임워크 | Vite + React 18 + TypeScript |
| 라우팅 | React Router (HashRouter 권장 — GitHub Pages SPA fallback 회피) |
| 데이터 | `@supabase/supabase-js` (anon key) |
| 권한 | `users.is_admin = true` + 모든 admin RPC가 `security definer + is_admin` 가드 |
| 배포 | GitHub Pages (정적, 무료) |
| Supabase URL | `https://oclmcgsjucfyyhjtaktt.supabase.co` |
| Supabase anon key | `.env`(본체) 또는 Supabase Dashboard → Settings → API |
| service_role key | **절대 client에 노출 금지**. Edge Function 환경변수에만 |

**Phase 1**(MVP)은 본체 레포 마이그레이션 `20260506000001_admin_phase1.sql` 적용 후 즉시 시작 가능.
**Phase 2**(자동 랭킹)는 추후 진행 — 본 문서 §8 ~ §10 참고.

---

## 1. 디렉터리 / 파일 구조

```
verdict-admin/
├── package.json
├── tsconfig.json
├── vite.config.ts                 # base: '/verdict-admin/'
├── index.html
├── .env.local                     # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── src/
│   ├── main.tsx
│   ├── App.tsx                    # 라우팅 + AuthGuard
│   ├── config/
│   │   └── supabase.ts            # createClient
│   ├── auth/
│   │   ├── LoginPage.tsx          # magic link 발송
│   │   ├── AuthCallback.tsx       # /auth/callback 처리
│   │   └── AuthGuard.tsx          # 비관리자 차단
│   ├── lib/
│   │   ├── votes.ts               # 일반투표 목록/삭제/복원
│   │   ├── reports.ts             # 신고 큐 / 상세
│   │   ├── candidates.ts          # 어제 후보 / 발행
│   │   ├── rankings.ts            # 자동 랭킹 조회 / 수동 발행 (Phase 2)
│   │   └── prompts.ts             # 프롬프트 CRUD (Phase 2)
│   ├── pages/
│   │   ├── DashboardPage.tsx      # 홈 — 신고 미처리 카운트 + 어제 발행 결과
│   │   ├── VotesPage.tsx          # Phase 1 — 일반투표 검색/필터/삭제
│   │   ├── ReportsPage.tsx        # Phase 1 — 신고 큐
│   │   ├── InquiriesPage.tsx      # Phase 1 — 사용자 문의 큐 (단방향 접수)
│   │   ├── CandidatesPage.tsx     # Phase 1 — 어제 후보 + 발행
│   │   ├── RankingsPage.tsx       # Phase 2 — top 5 + 발행
│   │   └── PromptsPage.tsx        # Phase 2 — 프롬프트 편집
│   └── components/
│       ├── Sidebar.tsx
│       └── ConfirmDialog.tsx
├── public/
│   └── 404.html                   # GitHub Pages SPA fallback (HashRouter 사용 시 불필요)
└── .github/
    └── workflows/
        └── deploy.yml             # GitHub Pages 자동 배포
```

---

## 2. 환경 / Supabase 클라이언트

### 2-1. `.env.local`
```
VITE_SUPABASE_URL=https://oclmcgsjucfyyhjtaktt.supabase.co
VITE_SUPABASE_ANON_KEY=<anon publishable key>
```
Supabase Dashboard → Settings → API → `Project URL` / `anon public` 그대로 사용. 본체와 같은 키 사용 가능.

### 2-2. `src/config/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error('Supabase env vars missing');
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
```

---

## 3. 인증 / 권한

### 3-1. 로그인 흐름
1. 운영자 이메일로 Supabase Auth magic link 발송
2. `/auth/callback` 라우트가 세션 확립
3. 세션 확립 후 `users.is_admin` 조회
4. `false` → `signOut()` + "권한 없음" 에러 노출

### 3-2. AuthGuard 의사코드
```typescript
// AuthGuard.tsx
const { data: { user } } = await supabase.auth.getUser();
if (!user) return <Navigate to="/login" />;

const { data: profile } = await supabase
  .from('users')
  .select('is_admin')
  .eq('id', user.id)
  .single();

if (!profile?.is_admin) {
  await supabase.auth.signOut();
  return <Navigate to="/login?error=not_admin" />;
}

return children;
```

### 3-3. 첫 운영자 등록 (Supabase SQL Editor)
```sql
update public.users set is_admin = true
where id = '<운영자 user uuid>';
```

> 토스 인증으로 가입한 사용자에게 부여하거나 별도 admin 전용 계정(Auth dashboard에서 invite) 생성 후 부여.

### 3-4. 권한 정책 요약
- anon key는 client에 노출되지만, admin RPC는 모두 `auth.uid()` 검증 + `is_admin` 가드 → 비관리자가 RPC를 직접 호출해도 `P0008` 에러
- 직접 INSERT/UPDATE 가능한 admin 테이블은 없음 (`admin_moderation_actions`는 RPC 경유 강제)

---

## 4. 본체 레포에 이미 준비된 자산

### 4-1. DB 컬럼/테이블
| 자산 | 위치 | 용도 |
|---|---|---|
| `users.is_admin` | `20260430000011` | 운영자 가드 |
| `users.report_weight` | `20260505000002` | 신고자 가중치 (Phase 3 어뷰저 down) |
| `vote_reports` | `20260505000002` | 사용자 신고 적재 |
| `points_log` | `20260429000000` | 보상 적립/지급 (운영 메트릭) |
| `today_candidate_recommendations` | `20260429000000` | 후보 공감 (재사용/폐기 결정 필요) |

### 4-2. RPC
| RPC | 용도 |
|---|---|
| `promote_today_candidates(p_selections jsonb, p_publish_date date)` | 카테고리당 1건 today 승격 + 30P 보상 적립 (idempotent) |
| `report_vote(p_vote_id uuid, p_reason report_reason)` | 사용자 신고 (admin과 무관, 본체에서 호출) |

### 4-3. cron / Edge Function (운영 GUC 필요)
- `cleanup-today-candidates-7d` — 미선정 후보 7일 후 삭제
- `moderate-vote-fallback` — 검열 누락 vote 5분 단위 재시도 (`app.moderate_vote_url`, `app.service_role_key` GUC 필요)

---

## 5. Phase 1 — 신규 마이그레이션 (이미 작성됨)

본체 레포에 추가된 마이그레이션: **`supabase/migrations/20260506000001_admin_phase1.sql`**

내용:
- `admin_moderation_actions` 테이블 — 감사 로그
- RPC 6종 (모두 `is_admin` 가드, errcode `P0008`)

| RPC | 시그니처 | 반환 |
|---|---|---|
| `admin_list_today_candidates(p_date date)` | 어제 후보 풀 (CandidatesPage) | `setof(...)` |
| `admin_list_votes(p_category text, p_status text[], p_search text, p_limit int, p_offset int)` | 일반투표 목록 (VotesPage) | `setof(...)` + `reports_count` 포함 |
| `admin_soft_delete_vote(p_vote_id uuid, p_reason text)` | 부적절 투표 반려 | `jsonb` |
| `admin_list_reported_votes(p_only_pending boolean, p_limit int, p_offset int)` | 신고 ≥1건 큐 (ReportsPage) | `setof(...)` |
| `admin_get_vote_reports(p_vote_id uuid)` | 특정 vote 신고 상세 | `setof(...)` (reporter_short = user_id 앞 4자리) |
| `admin_restore_vote(p_vote_id uuid, p_reason text)` | false positive 복원 | `jsonb` |

새 에러 코드: `P0008`(권한), `P0010`(복원 불가 상태).

### 5-A. Phase 1 추가 마이그레이션 — 사용자 문의

**`supabase/migrations/20260507000001_inquiries.sql`**

- `inquiries` 테이블 (id, user_id, nickname nullable, message 10~1000자, status enum open/resolved/dismissed, admin_note, resolved_at/resolved_by, created_at)
- RLS 활성화 + 직접 SELECT/INSERT 차단 → RPC 경유

| RPC | 시그니처 | 용도 |
|---|---|---|
| `create_inquiry(p_message text, p_nickname text)` | 사용자 INSERT | `returns uuid` (auth만 필요) |
| `admin_list_inquiries(p_status_filter text, p_limit int, p_offset int)` | 운영자 목록 (open 우선 정렬, user_short만 노출) | `setof(...)` |
| `admin_resolve_inquiry(p_inquiry_id uuid, p_status text, p_admin_note text)` | open/resolved/dismissed 전환 + 메모 | `jsonb` |
| `admin_delete_inquiry(p_inquiry_id uuid)` | 처리 후 행 삭제 | `jsonb` |

### 5-B. Phase 1 추가 마이그레이션 — 사용자 등록 차단 해제

**`supabase/migrations/20260508000001_admin_unblock_user.sql`**

배경: 사전 휴리스틱 연속 3회 반려 시 `users.register_blocked_until = now() + 1h` 자동 설정 (`20260504000003_moderation_abuse_guards.sql`). 일일 반려 5회 시 `register_vote` 호출 자체가 P0008로 차단. 운영자가 즉시 해제할 수 있도록 RPC 제공.

| RPC | 시그니처 | 용도 |
|---|---|---|
| `admin_find_user(p_email text, p_short text)` | 이메일 또는 user_id 앞 4자리(hex)로 조회 | `setof(id, email, user_short, register_blocked_until, consecutive_rejections, daily_rejection_count, daily_rejection_date, is_admin)` |
| `admin_unblock_user(p_user_id uuid)` | `register_blocked_until = null` + 카운터 리셋 | `jsonb { ok, prev: {...} }` |

> 이 마이그레이션들이 적용된 후 admin 페이지를 시작하세요. 적용은 본체 레포에서 `supabase db push` 또는 Supabase Dashboard SQL Editor에서 수동 실행.

---

## 6. Phase 1 — UI 명세

### 6-1. VotesPage (일반투표 관리)

**필터 바**:
- 카테고리: `전체 / 일상 / 연애 / 직장 / 게임 / 기타`
- 상태: `active / pending_review / closed / blinded / blinded_by_reports / deleted` (다중 선택)
- 검색: 질문 부분 일치

**테이블 컬럼**:
- 카테고리 / 질문 / 참여수 / 신고수 / 상태 / 등록일

**행 클릭 → 다이얼로그**:
- 질문 + 선택지(`vote_options` 별도 조회) + 메타 + 반려 사유 입력 + `[반려 처리]`
- 반려 사유는 필수, 빈 값이면 `23514` 에러 (RPC 가드)

**호출**:
```typescript
// lib/votes.ts
export async function listVotes(filter) {
  const { data, error } = await supabase.rpc('admin_list_votes', {
    p_category: filter.category ?? null,
    p_status: filter.status ?? null,
    p_search: filter.search ?? null,
    p_limit: 50,
    p_offset: filter.page * 50,
  });
  if (error) throw error;
  return data;
}

export async function softDeleteVote(voteId: string, reason: string) {
  const { data, error } = await supabase.rpc('admin_soft_delete_vote', {
    p_vote_id: voteId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}
```

### 6-2. ReportsPage (신고 처리)

**필터**:
- `미처리만 ☑` (status='active' 만) / `전체`
- 정렬: 신고수 desc 고정

**아코디언 행**:
- 닫힘: 카테고리 / 질문 / 신고수 / 상태 / 마지막 신고 시각
- 열림: 신고 목록 (시각 / `reporter_short` / 사유) + `[반려 처리]` (사유 입력) / `[유지]` (false positive — `admin_restore_vote`)

**호출**:
```typescript
// lib/reports.ts
export async function listReportedVotes(onlyPending = true) {
  const { data, error } = await supabase.rpc('admin_list_reported_votes', {
    p_only_pending: onlyPending,
    p_limit: 50,
    p_offset: 0,
  });
  if (error) throw error;
  return data;
}

export async function getVoteReports(voteId: string) {
  const { data, error } = await supabase.rpc('admin_get_vote_reports', {
    p_vote_id: voteId,
  });
  if (error) throw error;
  return data;
}

export async function restoreVote(voteId: string, reason: string) {
  const { data, error } = await supabase.rpc('admin_restore_vote', {
    p_vote_id: voteId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}
```

### 6-3. CandidatesPage (오늘의 투표 후보 — 수동 선정)

**조회 일자**: 발행일(`KST today`) 기준 어제 등록된 후보

**화면**:
- 카테고리 4개(`daily / relationship / work / game`) 섹션 분할
- 각 섹션에 후보 카드 (질문 / 작성자 short / 선택지 / 등록 시각 / 상태)
- 카테고리당 1개만 라디오 선택 가능
- 하단 `[발행]` 버튼 → 카테고리별 선택 매핑 객체로 RPC 호출

**호출**:
```typescript
// lib/candidates.ts
export async function listYesterdayCandidates(yesterdayKst: string) {
  const { data, error } = await supabase.rpc('admin_list_today_candidates', {
    p_date: yesterdayKst, // YYYY-MM-DD
  });
  if (error) throw error;
  return data;
}

export async function publishToday(
  selections: Record<'daily'|'relationship'|'work'|'game', string>,
  publishDateKst: string,
) {
  const { data, error } = await supabase.rpc('promote_today_candidates', {
    p_selections: selections,
    p_publish_date: publishDateKst,
  });
  if (error) throw error;
  return data;
}
```

**유의**:
- 카테고리 키는 DB enum (`daily/relationship/work/game`) — UI 한글 라벨과 별도
- `promote_today_candidates`는 카테고리 키 검증 (`daily/relationship/work/game` 외 거부)
- `today_selection` 보상 30P는 idempotency_key로 중복 차단되므로 재호출 안전

### 6-4. UsersPage (사용자 차단 해제) — Phase 1 미니 도구

**위치**: 사이드바 또는 DashboardPage 하단 작은 박스로 충분 (별도 풀 페이지 불필요)

**화면**:
```
┌──────────────────────────────────────────────┐
│ 사용자 등록 차단 해제                         │
│ 이메일 또는 ID 앞 4자리 입력 후 조회          │
│ [_______________________]  [조회]            │
├──────────────────────────────────────────────┤
│ • 9F2C  user@email.com                       │
│   차단 만료: 2026-05-08 14:32                │
│   연속 반려: 0  /  일일 반려: 3 (2026-05-08) │
│   [차단 해제]                                │
└──────────────────────────────────────────────┘
```

**호출**:
```typescript
// lib/users.ts
export async function findUser(opts: { email?: string; short?: string }) {
  const { data, error } = await supabase.rpc('admin_find_user', {
    p_email: opts.email ?? null,
    p_short: opts.short ?? null,
  });
  if (error) throw error;
  return data;
}

export async function unblockUser(userId: string) {
  const { data, error } = await supabase.rpc('admin_unblock_user', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
}
```

**유의**:
- `admin_find_user`는 이메일/short 둘 중 하나만 채워서 호출. 둘 다 비면 빈 결과
- `user_short`는 `vote_reports`/`inquiries`/`admin_list_*` 결과에 같이 노출되니, 그 화면에서 복붙해서 조회 가능
- 차단 해제 후 자동 새로고침 → 사용자가 즉시 등록 가능

---

### 6-5. InquiriesPage (사용자 문의 큐)

**정책**: 단방향 접수. 사용자에게 답변 회신 안 함. 운영자는 목록 보고 처리(`resolved`/`dismissed`) 마킹 또는 삭제.

**필터**:
- 상태: `미처리만 (open) ☑` / `처리됨 (resolved/dismissed)` / `전체`
- 정렬: `open` 우선, 이후 최신순 (RPC 내장)

**아코디언 행**:
- 닫힘: 닉네임(없으면 "(미입력)") · `user_short` · 작성일 · 메시지 첫 줄 · 상태 뱃지
- 열림: 메시지 전문 + 운영자 메모 textarea + 액션 버튼 3개:
  - `[처리 완료]` → `admin_resolve_inquiry(id, 'resolved', note)`
  - `[기각]` → `admin_resolve_inquiry(id, 'dismissed', note)` (스팸/무의미 케이스)
  - `[삭제]` → `admin_delete_inquiry(id)` (확인 다이얼로그 후)

**호출**:
```typescript
// lib/inquiries.ts
export async function listInquiries(statusFilter: 'open'|'resolved'|'dismissed'|null) {
  const { data, error } = await supabase.rpc('admin_list_inquiries', {
    p_status_filter: statusFilter,
    p_limit: 50,
    p_offset: 0,
  });
  if (error) throw error;
  return data;
}

export async function resolveInquiry(id: string, status: 'resolved'|'dismissed', note?: string) {
  const { data, error } = await supabase.rpc('admin_resolve_inquiry', {
    p_inquiry_id: id,
    p_status: status,
    p_admin_note: note ?? null,
  });
  if (error) throw error;
  return data;
}

export async function deleteInquiry(id: string) {
  const { data, error } = await supabase.rpc('admin_delete_inquiry', {
    p_inquiry_id: id,
  });
  if (error) throw error;
  return data;
}
```

**유의**:
- 사용자는 문의 제출 후 본인 이력도 못 봄 (단순 1방향 채널). 운영자가 처리 결과를 사용자에게 노출하지 않는 정책
- `user_short`(uuid 앞 4자리)와 닉네임만 노출. 전체 user_id는 운영 필요 시 SQL Editor 경유
- 메시지 길이 제약: 10~1000자 (DB CHECK + RPC 가드 + 클라이언트 폼 모두에서 검증)

---

### 6-6. DashboardPage

- 어제 발행된 `today` 4건 요약 (참여수 / 작성자 short)
- 신고 미처리 카운트 (`admin_list_reported_votes(true).length`) + 큐 진입 링크
- 비즈월렛 잔액 수동 입력 (선택, localStorage 저장)
- 최근 admin 액션 로그 (`admin_moderation_actions` 직접 select 불가 → 추후 RPC 추가 필요)

---

## 7. 시간/날짜 처리 (KST)

모든 날짜 키는 KST 기준 `YYYY-MM-DD`. 다음 헬퍼를 사용하세요.

```typescript
// lib/date.ts
export function kstToday(): string {
  const now = new Date();
  // toLocaleString 'sv-SE' = ISO 형태 → 앞 10자만
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
}

export function kstYesterday(): string {
  const now = new Date();
  const t = now.getTime() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}
```

CandidatesPage 발행은 `publish_date = kstToday()`, 후보 조회는 `p_date = kstYesterday()`.

---

## 8. Phase 2 — 자동 랭킹 + 수동 선정 + Fallback (로드맵)

### 8-1. 시간 정책 (KST)

| 시각 | 동작 |
|---|---|
| **00:00** | cron 1 — `auto-rank-today` Edge Function. 어제 후보 OpenAI 평가 → 카테고리별 top 5 → `today_rankings` UPSERT. **발행 안 함** |
| 00:00 ~ 06:59 | 운영자가 RankingsPage 접속 → 1건 수동 선택 → `promote_today_candidates` |
| **07:00** | cron 2 — `auto-select-fallback` Edge Function. 발행일 카테고리 중 `today` 없는 곳에 대해 `today_rankings` 1순위 자동 promote |
| 07:00 이후 | 운영자가 결과 검토 → 마음에 안 들면 RankingsPage에서 다른 순위 override |

### 8-2. 신규 테이블 (Phase 2 마이그레이션)

```sql
-- 자동 랭킹 캐시
create table public.today_rankings (
  id uuid primary key default gen_random_uuid(),
  publish_date date not null,
  category text not null,
  ranks jsonb not null,            -- [{rank, vote_id, score, reason}, ...] top 5
  candidates_summary jsonb,        -- 평가 대상 전체 후보 (감사용)
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (publish_date, category)
);
create index idx_today_rankings_date on public.today_rankings(publish_date desc);

-- 발행 결과 감사
create table public.auto_selections (
  id uuid primary key default gen_random_uuid(),
  publish_date date not null,
  category text not null,
  vote_id uuid references public.votes(id) on delete set null,
  source text not null,            -- 'admin_manual'|'auto_fallback'|'admin_override'
  rank_used int,
  ai_score numeric(4,2),
  ai_reason text,
  created_at timestamptz not null default now(),
  unique (publish_date, category)
);
create index idx_auto_selections_date on public.auto_selections(publish_date desc);

-- 프롬프트 편집
create table public.admin_prompts (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

insert into public.admin_prompts (key, value) values
  ('today_selection_system', '...초기 시드...'),
  ('today_selection_user', '카테고리: {category}\n후보:\n{candidates}\n흥미도 1~10 채점 후 1위 vote_id 반환');
```

### 8-3. cron 등록 (KST 기준 → UTC 변환)

```sql
-- 랭킹: KST 00:00 = UTC 15:00 (전날)
select cron.schedule(
  'auto-rank-today',
  '0 15 * * *',
  $$ select net.http_post(
       url := current_setting('app.auto_rank_today_url'),
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
         'Content-Type', 'application/json'
       ),
       body := '{}'::jsonb
     ) $$
);

-- Fallback: KST 07:00 = UTC 22:00 (전날)
select cron.schedule(
  'auto-select-fallback',
  '0 22 * * *',
  $$ select net.http_post(
       url := current_setting('app.auto_select_fallback_url'),
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
         'Content-Type', 'application/json'
       ),
       body := '{}'::jsonb
     ) $$
);
```

운영 GUC 사전 설정 (Supabase SQL Editor):
```sql
alter database postgres set app.auto_rank_today_url = 'https://oclmcgsjucfyyhjtaktt.supabase.co/functions/v1/auto-rank-today';
alter database postgres set app.auto_select_fallback_url = 'https://oclmcgsjucfyyhjtaktt.supabase.co/functions/v1/auto-select-fallback';
alter database postgres set app.service_role_key = '<service_role_key>';
```

### 8-4. Edge Function — `auto-rank-today`

흐름:
1. `kstYesterday()` 계산 → `admin_list_today_candidates(p_date)` 호출 (service_role)
2. 카테고리별 그룹핑
3. `admin_prompts` 에서 system/user 프롬프트 로드
4. OpenAI Chat API 호출 — 후보 5~10개를 ranking → top 5 추출
5. `today_rankings` UPSERT (`publish_date = kstToday()`, `category` 단위)
6. **발행은 안 함**

### 8-5. Edge Function — `auto-select-fallback`

흐름:
1. `publish_date = kstToday()` 기준 카테고리 중 `today` 발행 없는 곳 식별
2. `today_rankings.ranks[0].vote_id` 추출
3. 신규 RPC `auto_promote_from_rankings(p_publish_date date)` 호출 (service_role only — 호출자 검증 X, GUC로 service_role 강제)
4. `auto_selections` INSERT (`source='auto_fallback'`)

> RPC가 `auth.uid()`를 검증하면 service_role 호출 시 NULL이라 거부됨. 따라서 `auto_promote_from_rankings`는 별도 RPC로 만들고 `revoke from public/anon/authenticated` + service_role 환경에서만 호출.

### 8-6. RankingsPage UI

```
┌─────────────────────────────────────────────────┐
│ 자동 랭킹 (2026-05-04 발행)                     │
│ 산출: KST 00:00 / Fallback: KST 07:00           │
├─────────────────────────────────────────────────┤
│ [일상]                                          │
│  ① "..."  AI 8.4   [발행]                       │
│  ② "..."  AI 7.9                                │
│  ③ ④ ⑤ ...                                     │
├─────────────────────────────────────────────────┤
│ [연애] ① "..." 8.1   [발행]                     │
│ [직장] ⚠️ 후보 0건 — fallback 시 미발행         │
│ [게임] ① "..." 7.9   [발행됨 ✓]   [override]    │
└─────────────────────────────────────────────────┘
```

- 발행 완료 카테고리는 `auto_selections` 조회로 source 표시 (`수동 선정` / `자동 발행`)
- override 시 기존 today 강등 처리는 별도 RPC 필요 (Phase 2 후반 결정)

### 8-7. PromptsPage UI

- system / user 프롬프트 textarea 2개
- placeholder: `{category}`, `{candidates}` 등
- `[저장]` → `admin_prompts` UPSERT (`updated_by = auth.uid()`)
- `[테스트 실행]` → 어제 후보 풀로 mock 호출 → 결과 미리보기 (실제 promote X)

---

## 9. 배포 — GitHub Pages

### 9-1. `vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/verdict-admin/',
  build: { outDir: 'dist' },
});
```

### 9-2. `.github/workflows/deploy.yml`
```yaml
name: Deploy admin to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - uses: actions/deploy-pages@v4
```

### 9-3. SPA 라우팅
GitHub Pages는 SPA fallback 미지원이라 새로고침 시 404. 둘 중 하나:
- `HashRouter` 사용 (`/#/dashboard` 형식) — **권장 (간단)**
- `public/404.html` 에 `index.html` 동일 내용 복사

---

## 10. 보안 / 운영 체크리스트

| 항목 | 처리 |
|---|---|
| RLS | 모든 admin 작업은 RPC 경유. RLS 정책 직접 완화 금지 |
| anon key 노출 | client 정상 노출. 권한 있는 동작은 `is_admin` 가드된 RPC만 |
| service_role key | Edge Function 환경변수에만. GitHub secrets 절대 X |
| OpenAI API key | Phase 2 Edge Function 환경변수 (`OPENAI_API_KEY`) |
| 관리자 추가 | DB 직접 (`update users set is_admin = true`). UI 자가 부여 차단 |
| 감사 로그 | `admin_moderation_actions` (Phase 1) + `auto_selections.source` (Phase 2) |
| 신고자 개인정보 | `reporter_short` (uuid 앞 4자리)만 노출. 전체 user_id는 운영 필요 시 SQL Editor 직접 |
| 운영 GUC | `app.auto_rank_today_url`, `app.auto_select_fallback_url`, `app.service_role_key` 사전 설정 (Phase 2) |

---

## 11. Phase 별 체크리스트

### Phase 1 (지금 시작 가능)
- [ ] 본체 레포에서 `supabase/migrations/20260506000001_admin_phase1.sql` 적용
- [ ] 본체 레포에서 `supabase/migrations/20260507000001_inquiries.sql` 적용
- [ ] 본체 레포에서 `supabase/migrations/20260508000001_admin_unblock_user.sql` 적용
- [ ] verdict-admin 프로젝트 초기화 (Vite + React + TS + React Router)
- [ ] Supabase 클라이언트 + AuthGuard
- [ ] LoginPage (magic link)
- [ ] VotesPage — 카테고리/상태/검색 + 행 클릭 다이얼로그 + soft delete
- [ ] ReportsPage — 아코디언 + 신고 상세 + 반려/유지
- [ ] InquiriesPage — 사용자 문의 큐 + 처리/삭제
- [ ] UsersPage(또는 Dashboard 위젯) — 이메일/short hex 조회 + 등록 차단 해제
- [ ] CandidatesPage — 어제 후보 카테고리별 그룹 + 1건 선택 + 발행
- [ ] DashboardPage — 어제 발행 결과 + 신고 미처리 카운트 + 문의 미처리 카운트
- [ ] GitHub Pages 배포 워크플로
- [ ] 첫 운영자 `is_admin=true` + 동작 확인

### Phase 2 (Phase 1 베타 1~2주 후)
- [ ] 신규 마이그레이션 — `today_rankings`, `auto_selections`, `admin_prompts` 테이블 + `auto_promote_from_rankings` RPC
- [ ] Edge Function `auto-rank-today` (KST 00:00 cron)
- [ ] Edge Function `auto-select-fallback` (KST 07:00 cron)
- [ ] 운영 GUC 설정 (`app.auto_rank_today_url`, `app.auto_select_fallback_url`)
- [ ] RankingsPage — top 5 카드 + 발행 + override
- [ ] PromptsPage — 편집 + 미리보기 (mock)
- [ ] Fallback 발동 시 운영자 알림 (Slack/이메일)

### Phase 3 (참고)
- [ ] MetricsPage — 일/주/월 토스포인트 지급 / 광고 환급 / 반려율 통계
- [ ] 비즈월렛 잔액 자동 동기화 (토스 API)
- [ ] 어뷰저 `report_weight` 조정 도구

---

## 12. 알려진 미결 사항

| 항목 | 결정 필요 시점 |
|---|---|
| `admin_soft_delete_vote` 시 광고 환급/free pass 환급 트리거 동작 확인 | Phase 1 구현 직전 |
| 작성자에게 반려 사유 노출 여부 (`MyVotesSection`의 `blinded` 처리와 동일 정책 검토) | Phase 1 구현 직전 |
| `today_candidate_recommendations` 폐기 또는 자동 랭킹 입력 신호로 활용 | Phase 2 시작 시 |
| RankingsPage override 시 기존 today 강등 RPC 명세 | Phase 2 후반 |
| `admin_moderation_actions` 직접 SELECT용 RPC (DashboardPage 액션 로그) | Phase 1 후반 또는 Phase 3 |

---

*문서 버전: 1.0 (인수인계용) | 2026-05-05 작성*
*원본 설계서: `verdict/docs/operations/admin-page-design.md` v0.2*
