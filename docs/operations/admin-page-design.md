# Verdict 관리자 페이지 설계 문서

> 미니앱 본체와 분리된 React SPA. GitHub Pages 등 정적 호스팅으로 배포.
> 본 문서는 관리자 페이지 단독 레포 또는 모노레포 분리 모두 대응 가능한 설계.

---

## 1. 목적과 범위

### 1-1. 핵심 책임
- **오늘의 투표 선정** — `today_candidate` 풀에서 카테고리당 1건씩 골라 `today` 로 승격 + 작성자에게 `today_selection` 보상 적립
- **자동 선정 결과 검토** — cron이 자동으로 뽑은 결과를 사후 확인/수정
- **OpenAI 프롬프트 관리** — 자동 선정 시 사용하는 system/user 프롬프트 콘솔에서 수정
- **운영 메트릭** — 어제/오늘의 미션 보상 누적, 검열 반려율, 비즈월렛 잔액

### 1-2. 범위 밖
- 사용자/투표 직접 편집 (필요 시 Supabase Dashboard 사용)
- 토스 결제 콘솔 작업 (토스 웹콘솔에서 별도)
- 광고 SDK 운영

---

## 2. 단계별 로드맵

### Phase 1 — 수동 선정 (MVP)
1. 관리자 로그인 (Supabase Auth)
2. "오늘의 투표 후보" 페이지 — 어제 등록된 `today_candidate` 카테고리별 그룹핑
3. 각 카테고리에서 1건 선택 → "발행" 버튼 → `promote_today_candidates` RPC 호출
4. 발행 결과 토스트 + DB 반영 자동 확인

### Phase 2 — 자동 선정 + 검토
1. **cron job** (Supabase Edge Function + pg_cron, KST 매일 07:30) — 어제 후보 풀에 대해 OpenAI 흥미도 평가 → 카테고리별 최고 점수 1건 자동 promote
2. 관리자 페이지에 **"오늘의 선정 결과"** 페이지 — cron이 선정한 결과 + AI 점수 + 사유 노출
3. 운영자가 수동 override 가능 (자동 선정 취소 후 다른 후보 재선정)
4. **프롬프트 편집 페이지** — system / user prompt 텍스트 영역 + 저장 → DB의 `admin_prompts` 테이블 갱신 → cron이 매번 최신 프롬프트 사용

### Phase 3 — 미래 확장 (참고용)
- 검열 반려 사례 검토 + 수동 복구
- 사용자 신고 처리 페이지
- 100명 달성 보너스 / 광고 보호 환급 통계 대시보드
- 일별 토스포인트 지급 현황 (비즈월렛 잔액 모니터링)

---

## 3. 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | **Vite + React 18 + TypeScript** (Verdict 본체와 동일) |
| 라우팅 | React Router (단순 SPA) |
| UI | TDS Mobile은 모바일 전용 → 관리자 페이지는 데스크톱 우선이라 **간단한 자체 컴포넌트** 또는 shadcn/ui 같은 데스크톱 친화 라이브러리 |
| 데이터 | `@supabase/supabase-js` (anon key, 권한은 RLS + `is_admin` 가드) |
| 배포 | **GitHub Pages** (정적 호스팅, 무료) — `vite.config.ts`에 `base: '/verdict-admin/'` 설정 |
| 도메인 | `verdict-admin.github.io` 또는 커스텀 도메인 |
| 인증 | Supabase Auth + magic link (관리자 이메일만 등록) 또는 토스 OAuth + `is_admin` 가드 |

> Verdict 본체와 같은 Supabase 프로젝트 사용. 같은 anon key 공유 가능. 권한은 `is_admin` 컬럼 + RPC 내부 검증으로 강제.

---

## 4. 프로젝트 구조

```
verdict-admin/
├── package.json
├── tsconfig.json
├── vite.config.ts                 # base: '/verdict-admin/'
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx                    # 라우팅 + AuthGuard
│   ├── config/
│   │   ├── supabase.ts            # createClient (anon key, env에서 주입)
│   │   └── env.ts                 # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
│   ├── auth/
│   │   ├── LoginPage.tsx          # magic link 발송
│   │   ├── AuthCallback.tsx       # /auth/callback 처리
│   │   └── AuthGuard.tsx          # 비관리자 차단
│   ├── lib/
│   │   ├── candidates.ts          # 후보 조회 / 발행 RPC 래퍼
│   │   ├── prompts.ts             # 프롬프트 CRUD
│   │   ├── selections.ts          # 자동 선정 결과 조회
│   │   └── metrics.ts             # 운영 메트릭 (Phase 3)
│   ├── pages/
│   │   ├── DashboardPage.tsx      # 홈 — 오늘의 상태 요약
│   │   ├── CandidatesPage.tsx     # Phase 1 핵심 — 카테고리별 후보 + 발행
│   │   ├── SelectionsPage.tsx     # Phase 2 — cron 자동 선정 결과
│   │   ├── PromptsPage.tsx        # Phase 2 — system/user prompt 편집
│   │   └── ModerationPage.tsx     # Phase 3 — 반려 사례
│   └── components/
│       ├── Sidebar.tsx
│       ├── CandidateCard.tsx
│       └── DiffView.tsx           # 프롬프트 변경 diff 미리보기
├── public/
└── .github/
    └── workflows/
        └── deploy.yml             # GitHub Pages 자동 배포
```

---

## 5. 인증 / 권한

### 5-1. 로그인 흐름
- 관리자 이메일로 Supabase Auth magic link 수신 → 클릭 → `/auth/callback` 라우트가 세션 확립
- 세션 확립 후 `users.is_admin` 조회. `false` → 즉시 logout + "권한 없음" 에러 노출

### 5-2. AuthGuard 의사코드
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

### 5-3. 관리자 등록 (DB 직접)
Supabase SQL Editor에서:
```sql
update public.users set is_admin = true
where id = '<admin-user-uuid>';
```

> 기존 토스 인증으로 가입한 사용자에게 부여. 별도 admin 전용 계정 생성도 가능 (Auth dashboard에서 invite).

---

## 6. Phase 1 — CandidatesPage 상세

### 6-1. 화면 구성
```
┌─────────────────────────────────────────────────┐
│ 발행 대상일: 2026-05-04                         │
│ (어제 등록 후보 — KST 00:00~23:59 기준)         │
├─────────────────────────────────────────────────┤
│ [일상] 후보 12건                                │
│   ○ "카톡 읽씹, 화가 나?"     by user_abc       │
│     선택지: 화남 / 신경 안 씀                   │
│     등록: 2026-05-03 14:23  검열: ✅ active     │
│   ● "월요일이 제일 싫지?"     by user_xyz       │
│     ...                                          │
│ [발행] 버튼                                      │
├─────────────────────────────────────────────────┤
│ [연애] 후보 5건                                 │
│ [직장] 후보 8건                                 │
│ [게임] 후보 3건                                 │
└─────────────────────────────────────────────────┘
[모든 카테고리 일괄 발행]
```

### 6-2. 데이터 조회
어제 등록된 `today_candidate` 중 검열 통과(`status='active'` or `pending_review`):

```typescript
async function listYesterdayCandidates() {
  const yesterday = kstYesterday(); // YYYY-MM-DD
  const { data } = await supabase
    .from('votes')
    .select(`
      id, question, category, status, ai_score, created_at,
      author_id,
      vote_options (option_text, display_order)
    `)
    .eq('type', 'today_candidate')
    .gte('created_at', `${yesterday}T00:00:00+09:00`)
    .lt('created_at', `${kstToday()}T00:00:00+09:00`)
    .in('status', ['active', 'pending_review'])
    .order('ai_score', { ascending: false, nullsFirst: false });
  return data;
}
```

### 6-3. 발행 (Phase 1 수동)
이미 존재하는 RPC 호출:
```typescript
async function publish(selections: Record<string, string>) {
  // selections: { daily: 'vote-uuid', relationship: '...', work: '...', game: '...' }
  const { data, error } = await supabase.rpc('promote_today_candidates', {
    p_selections: selections,
    p_publish_date: kstToday(),
  });
  if (error) throw error;
  return data;
}
```

→ RPC가 자동으로:
- `votes.type` `today_candidate` → `today`
- `today_selection` 20P 보상 `points_log` INSERT (`status='unclaimed'`)
- 작성자가 마이페이지에서 "받기" 버튼으로 수령

### 6-4. RLS 고려사항
관리자도 일반 사용자라 `votes_public_select` 정책으로 `pending_review` 후보를 보려면 본인 author여야 함. 우회를 위해 추가 RLS 또는 service_role 필요.

**권장 — 신규 RPC `admin_list_today_candidates(p_date date)`** 추가:
```sql
create or replace function public.admin_list_today_candidates(p_date date)
returns setof votes
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users
    where id = auth.uid() and is_admin
  ) then
    raise exception 'admin only' using errcode = 'P0008';
  end if;

  return query
    select * from public.votes
    where type = 'today_candidate'
      and created_at >= (p_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Seoul'
      and created_at < ((p_date + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Seoul'
      and status in ('active', 'pending_review')
    order by category, ai_score desc nulls last;
end;
$$;
grant execute on function public.admin_list_today_candidates(date) to authenticated;
```

→ Phase 1 진행 시 별도 마이그레이션으로 추가 필요.

---

## 7. Phase 2 — 자동 선정 + 프롬프트 관리

### 7-1. cron job 설계

**Edge Function 신규**: `supabase/functions/auto-select-today/index.ts`

흐름:
1. `admin_list_today_candidates(yesterday)` 로 후보 풀 조회
2. 카테고리별로 묶음 (`daily / relationship / work / game`)
3. 각 카테고리에 대해 OpenAI 호출 — 후보 5~10개를 흥미도로 ranking
4. 1위를 자동 선택 → `promote_today_candidates` 호출
5. 결과를 신규 테이블 `auto_selections` 에 기록 (관리자 페이지 노출용)

**pg_cron 등록** (KST 07:30):
```sql
select cron.schedule(
  'auto-select-today',
  '30 22 * * *',  -- UTC 22:30 = KST 07:30
  $$
    select net.http_post(
      url := 'https://<project>.supabase.co/functions/v1/auto-select-today',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

### 7-2. 신규 테이블 — admin_prompts

```sql
create table public.admin_prompts (
  key text primary key,           -- 예: 'today_selection_system'
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

-- 초기 시드
insert into public.admin_prompts (key, value) values
  ('today_selection_system', '당신은 한국어 소셜 투표 앱 Verdict의 콘텐츠 큐레이터입니다. ...'),
  ('today_selection_user', '카테고리: {category}\n후보 리스트:\n{candidates}\n\n흥미도 1~10으로 채점하고 1위 vote_id 반환.');
```

`auto-select-today` Edge Function 시작 시:
```typescript
const { data: prompts } = await admin.from('admin_prompts').select('key, value');
const systemPrompt = prompts.find(p => p.key === 'today_selection_system').value;
const userTemplate = prompts.find(p => p.key === 'today_selection_user').value;
// {category} {candidates} 같은 placeholder 치환 후 OpenAI 호출
```

### 7-3. 신규 테이블 — auto_selections

```sql
create table public.auto_selections (
  id uuid primary key default gen_random_uuid(),
  publish_date date not null,
  category text not null,
  vote_id uuid references public.votes(id) on delete set null,
  ai_score numeric(4,2),
  ai_reason text,
  candidates_summary jsonb,        -- 후보들의 vote_id + score 목록 (감사용)
  status text not null default 'auto_selected',  -- 'auto_selected' / 'admin_overridden' / 'failed'
  created_at timestamptz not null default now(),
  unique (publish_date, category)
);

create index idx_auto_selections_date on public.auto_selections(publish_date desc);
```

### 7-4. 관리자 페이지 — SelectionsPage

```
┌─────────────────────────────────────────────────┐
│ 자동 선정 결과 (2026-05-04)                     │
├─────────────────────────────────────────────────┤
│ [일상] ✅ "카톡 읽씹, 화가 나?"  AI 8.4점       │
│   사유: 의견이 갈리는 보편 주제, 응답 풍부 예상  │
│   다른 후보 12건 (펼쳐보기)                      │
│   [수동 변경] 버튼                               │
├─────────────────────────────────────────────────┤
│ [연애] ✅ "..."   8.1점                         │
│ [직장] ⚠️ 후보 0건 — 미발행                     │
│ [게임] ✅ "..."   7.9점                         │
└─────────────────────────────────────────────────┘
```

- "수동 변경" 클릭 → 같은 페이지에서 후보 리스트 펼침 → 다른 vote 선택 → `promote_today_candidates` 재호출 (idempotent — `today_selection` 중복 INSERT는 idempotency_key로 차단)

### 7-5. 관리자 페이지 — PromptsPage

```
┌─────────────────────────────────────────────────┐
│ OpenAI 프롬프트 편집                            │
├─────────────────────────────────────────────────┤
│ [system prompt]                                 │
│ ┌────────────────────────────────────┐         │
│ │ 당신은 한국어 소셜 투표 앱...       │         │
│ │ ...                                 │         │
│ └────────────────────────────────────┘         │
│                                                 │
│ [user prompt 템플릿]  (placeholder: {category}, {candidates}) │
│ ┌────────────────────────────────────┐         │
│ │ ...                                 │         │
│ └────────────────────────────────────┘         │
│                                                 │
│ 마지막 수정: 2026-05-03 by admin@verdict        │
│ [저장] [되돌리기] [테스트 실행]                 │
└─────────────────────────────────────────────────┘
```

- 저장 시 `admin_prompts` UPSERT
- 테스트 실행: 어제 후보 풀로 mock 호출 → 결과 미리보기 (실제 promote는 안 함)

### 7-6. 관리자 페이지 띄워두지 않아도 자동 동작
**핵심**: 관리자 페이지는 단지 **결과 조회 + 수동 override + 프롬프트 편집** UI일 뿐. 실제 자동 선정은 **Supabase 서버 측 pg_cron + Edge Function** 가 담당하므로 관리자가 접속 안 해도 매일 동작.

→ 관리자가 출장가도 OK. 결과 마음에 안 들면 다음날 페이지 접속해서 수동 override.

---

## 8. 환경변수

`verdict-admin/.env.local`:
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_ADMIN_PAGE_VERSION=1.0.0
```

GitHub Actions 배포 시 Repository Secrets로 주입.

---

## 9. 배포 — GitHub Pages

### 9-1. vite.config.ts
```typescript
export default defineConfig({
  plugins: [react()],
  base: '/verdict-admin/',  // GitHub Pages 경로
  build: { outDir: 'dist' }
})
```

### 9-2. .github/workflows/deploy.yml
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
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
```

### 9-3. SPA 라우팅 보정
GitHub Pages는 SPA fallback 미지원이라 새로고침 시 404. 해결:
- `public/404.html` 에 `index.html`과 동일 내용 복사 (정적 fallback)
- 또는 `HashRouter` 사용 (`/#/dashboard` 형식)

---

## 10. Phase별 구현 체크리스트

### Phase 1
- [ ] 신규 마이그레이션 — `admin_list_today_candidates` RPC 추가
- [ ] verdict-admin 프로젝트 초기화 (Vite + React + TS)
- [ ] Supabase 클라이언트 + AuthGuard
- [ ] LoginPage (magic link)
- [ ] CandidatesPage — 카테고리별 후보 그룹핑 + 단일 선택 + 일괄 발행
- [ ] DashboardPage — 어제 발행 결과 요약 + 비즈월렛 잔액 (수동 입력)
- [ ] GitHub Pages 배포 워크플로
- [ ] 첫 관리자 계정 `is_admin=true` 부여 + 동작 확인

### Phase 2
- [ ] 신규 마이그레이션 — `admin_prompts`, `auto_selections` 테이블
- [ ] Edge Function `auto-select-today` — 후보 풀 평가 + OpenAI 호출 + promote
- [ ] pg_cron 등록 (KST 07:30)
- [ ] SelectionsPage — auto_selections 조회 + 수동 override
- [ ] PromptsPage — system/user prompt 편집 + 미리보기
- [ ] 모니터링 — 어제 자동 선정 누락 시 운영자 알림

### Phase 3 (참고)
- [ ] ModerationPage — 검열 반려 / 신고 처리
- [ ] MetricsPage — 일/주/월 토스포인트 지급 / 광고 환급 / 반려율 통계
- [ ] 비즈월렛 잔액 자동 동기화 (토스 API)

---

## 11. 보안 / 운영 주의

| 항목 | 처리 |
|---|---|
| RLS | 관리자 RPC는 모두 `auth.uid() = is_admin` 검증 (`P0008` raise) |
| anon key 노출 | GitHub Pages 정적 배포라 client-side 노출 정상. 권한 있는 동작은 `is_admin` 가드된 RPC만 |
| service_role key | **절대 노출 금지**. cron 호출 시 Supabase Edge Function 환경변수에만 보관 |
| OpenAI API key | Edge Function 환경변수 (`OPENAI_API_KEY`). 관리자 페이지 client에 노출 X |
| 관리자 추가 | DB 직접 (`update users set is_admin = true`). UI로 자가 부여 차단 |
| 감사 로그 | `auto_selections.candidates_summary` + `admin_prompts.updated_by` 로 누가 언제 무엇을 변경했는지 추적 |
| RLS 우회 | `admin_list_today_candidates` 외에 운영 작업이 늘어나면 RPC 추가. 직접 RLS 정책 완화는 금지 |

---

## 12. 의존성 / 사전 작업

| 사전 조건 | 상태 |
|---|---|
| Supabase 프로젝트 (Verdict 본체와 동일) | ✅ |
| `users.is_admin` 컬럼 | ✅ (마이그레이션 `20260430000011`) |
| `promote_today_candidates` RPC | ✅ |
| `today_selection` 보상 적립 (20P unclaimed) | ✅ (마이그레이션 `20260504000008`) |
| `OPENAI_API_KEY` (검열용 — 자동 선정 재사용) | ✅ |
| GitHub 레포 + Pages 활성화 | ⏳ 운영자 작업 |

---

## 13. 다음 단계

1. 검수 대기 동안 **Phase 1 구현 시작**
2. **`admin_list_today_candidates` RPC 마이그레이션** 우선 추가 (`20260504000010`)
3. verdict-admin 레포 초기화 + 기본 라우팅 + AuthGuard
4. CandidatesPage 핵심 흐름 구현 (조회 → 선택 → 발행)
5. 검수 통과 + 토스 매핑 INSERT 시점에 베타 시작
6. 베타 1주차 데이터 보고 Phase 2 (자동 선정) 착수 여부 결정

---

*문서 버전: v0.1 (초안) | 작성: 2026-05-04*
