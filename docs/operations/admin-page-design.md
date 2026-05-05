# Verdict 관리자 페이지 설계 문서

> 미니앱 본체와 분리된 React SPA. GitHub Pages 등 정적 호스팅으로 배포.
> 본 문서는 관리자 페이지 단독 레포 또는 모노레포 분리 모두 대응 가능한 설계.

---

## 1. 목적과 범위

### 1-1. 핵심 책임
- **카테고리별 일반투표 관리** — 일반투표 목록 조회·검색·필터, 부적절 판단 시 사유와 함께 soft delete (반려 처리)
- **신고된 투표 처리** — 신고 1건 이상 누적된 투표를 별도 큐에서 검토, 신고 내용 펼쳐보기, 운영자 판단으로 반려/유지
- **오늘의 투표 선정** — `today_candidate` 풀에서 카테고리당 1건씩 골라 `today` 로 승격 + 작성자에게 `today_selection` 보상 적립
- **자동 랭킹 결과 검토** — KST 00:00 cron이 카테고리별 5개 랭킹 산출 → 운영자가 KST 07:00 전에 1건 수동 선택 → 미선택 시 KST 07:00 fallback cron 이 1순위 자동 발행
- **OpenAI 프롬프트 관리** — 자동 랭킹 시 사용하는 system/user 프롬프트 콘솔에서 수정
- **운영 메트릭** — 어제/오늘의 미션 보상 누적, 검열 반려율, 비즈월렛 잔액

### 1-2. 범위 밖
- 사용자 직접 편집 (필요 시 Supabase Dashboard 사용)
- 토스 결제 콘솔 작업 (토스 웹콘솔에서 별도)
- 광고 SDK 운영

---

## 2. 단계별 로드맵

### Phase 1 — 수동 운영 (MVP)
1. 관리자 로그인 (Supabase Auth, 또는 토스 OAuth + `is_admin` 가드)
2. **VotesPage** — 카테고리별 일반투표 목록 + 검색/필터 + 행 클릭 시 상세 다이얼로그 → 사유 입력 후 soft delete
3. **ReportsPage** — `vote_reports` 1건 이상 누적된 투표 큐. 행 클릭 시 펼침으로 신고 사유/사용자/시각 표시. "반려 처리" 버튼으로 status→`blinded`(또는 `deleted`) 전환 + 사유 기록
4. **CandidatesPage** — 어제 등록된 `today_candidate` 카테고리별 그룹핑 → 1건 선택 → `promote_today_candidates` RPC 호출

### Phase 2 — 자동 랭킹 + 프롬프트 관리
1. **cron job — 자동 랭킹** (Supabase Edge Function + pg_cron, **KST 매일 00:00**)
   - 어제 후보 풀에 대해 OpenAI 흥미도 평가
   - 카테고리별 **상위 5개 랭킹** 산출 → `today_rankings` 테이블에 캐시
   - 이 단계에서는 **자동 발행 안 함** (운영자 검토 시간 확보)
2. **RankingsPage** — `today_rankings` 카테고리별 상위 5개 카드 + AI 점수/사유 + "이걸로 발행" 버튼 → `promote_today_candidates`
3. **cron job — fallback 발행** (**KST 매일 07:00**)
   - 발행일 기준 카테고리 중 아직 `today` 발행 없는 곳에 대해 `today_rankings` 1순위로 자동 promote
   - 운영자가 출장/휴무여도 컨텐츠 공백 방지
4. **PromptsPage** — system / user prompt 텍스트 영역 + 저장 → `admin_prompts` 테이블 갱신 → cron 이 매번 최신 프롬프트 사용

### Phase 3 — 미래 확장 (참고용)
- 100명 달성 보너스 / 광고 보호 환급 통계 대시보드
- 일별 토스포인트 지급 현황 (비즈월렛 잔액 모니터링)
- `report_weight` 어뷰저 down 도구 (악성 신고자 가중치 조정)

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
│   │   ├── DashboardPage.tsx      # 홈 — 오늘의 상태 요약 + 신고 큐 카운트
│   │   ├── VotesPage.tsx          # Phase 1 — 카테고리별 일반투표 관리 + soft delete
│   │   ├── ReportsPage.tsx        # Phase 1 — 신고 1건+ 큐 검토 + 반려 처리
│   │   ├── CandidatesPage.tsx     # Phase 1 — 어제 후보 카테고리별 그룹 + 발행
│   │   ├── RankingsPage.tsx       # Phase 2 — 자동 랭킹 top 5 + 발행
│   │   └── PromptsPage.tsx        # Phase 2 — system/user prompt 편집
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

## 6-A. Phase 1 — VotesPage (일반투표 관리)

### 6-A-1. 화면 구성
```
┌──────────────────────────────────────────────────────────┐
│ 일반투표 관리                                             │
│ 카테고리: [전체 ▾] 상태: [active ▾] 검색: [_________]    │
├──────────────────────────────────────────────────────────┤
│ 카테고리 │ 질문                       │ 참여 │ 신고 │ 등록일 │
│ 일상     │ 카톡 읽씹, 화가 나?       │  82  │  0  │ 05-04 │
│ 직장     │ ...                        │  12  │  3  │ 05-04 │
│ ...                                                       │
├──────────────────────────────────────────────────────────┤
│ ◀ 1 2 3 ▶                                                │
└──────────────────────────────────────────────────────────┘

[행 클릭 → 다이얼로그]
┌──────────────────────────────────────┐
│ "카톡 읽씹, 화가 나?"                │
│ 카테고리: 일상  상태: active          │
│ 작성: 2026-05-04 14:23 by user_abc   │
│ 선택지: 화남 / 신경 안 씀             │
│ 참여: 82명, 신고: 0건                │
│ ────────────────────────────────────│
│ 반려 사유 (필수):                    │
│ ┌──────────────────────────────┐    │
│ │ 동일 주제 중복 등록           │    │
│ └──────────────────────────────┘    │
│ [반려 처리]    [닫기]                │
└──────────────────────────────────────┘
```

### 6-A-2. 데이터/RPC
- 신규 RPC `admin_list_votes(p_category text, p_status text[], p_search text, p_limit int, p_offset int)` — `is_admin` 가드, RLS 우회 (security definer)
- 신규 RPC `admin_soft_delete_vote(p_vote_id uuid, p_reason text)` — `votes.status='deleted'` + `rejection_reason=p_reason`로 갱신, 감사 로그 INSERT
- 신규 테이블 `admin_moderation_actions(id, vote_id, admin_id, action, reason, created_at)` — 감사 로그

### 6-A-3. 부수 효과 (반려 처리 시)
- `votes.status='deleted'` → 클라이언트 피드/상세에서 자동 제외 (기존 RLS/필터에서 `deleted` 제외 됨)
- 작성자에게는 사유 노출 안 함 (마이페이지 `blinded` 표시와 동일 정책 적용 가능 — 추후 결정)
- 광고 환급/free pass 환급은 기존 트리거 재사용 여부 확정 필요 (Phase 1 시점에 결정)

---

## 6-B. Phase 1 — ReportsPage (신고 처리)

### 6-B-1. 화면 구성
```
┌──────────────────────────────────────────────────────────┐
│ 신고된 투표 (총 X건, 미처리 Y건)                         │
│ 정렬: [신고수 많은 순 ▾]  필터: [미처리만 ☑]             │
├──────────────────────────────────────────────────────────┤
│ ▼ "..."  카테고리:일상  신고 5건  status:active          │
│   └ 펼침 ─────────────────────────────────────────────  │
│     • 2026-05-04 14:23  user_abc  사유: hate            │
│     • 2026-05-04 15:01  user_xyz  사유: spam            │
│     • 2026-05-04 16:11  user_def  사유: hate            │
│     [반려 처리 (사유 입력)]   [유지 (false positive)]   │
│ ▶ "..."  카테고리:직장  신고 3건  status:blinded_by_reports
│ ▶ "..."  카테고리:게임  신고 1건  status:active          │
└──────────────────────────────────────────────────────────┘
```

- 행 클릭 시 펼침(아코디언)으로 `vote_reports` 상세 노출
- "반려 처리" → 운영자가 검토 후 강제 처리 (이미 임계 도달로 `blinded_by_reports`인 경우도 영구 `blinded`로 승격 가능)
- "유지" → status 복원 (`blinded_by_reports → active`), false positive 케이스

### 6-B-2. 데이터/RPC
- 신규 RPC `admin_list_reported_votes(p_status_filter text, p_only_pending boolean, p_limit int, p_offset int)` — 신고 ≥1건 vote 목록, 신고수/최근 신고 시각/현재 status 포함
- 신규 RPC `admin_get_vote_reports(p_vote_id uuid)` — 특정 vote의 모든 `vote_reports` 행 + 신고자 닉네임/시각/사유 반환
- 반려 처리 → 위 §6-A-2 의 `admin_soft_delete_vote` 재사용 (action='soft_delete' 기록)
- 유지 처리 → 신규 RPC `admin_restore_vote(p_vote_id uuid, p_reason text)` (action='restore' 기록, status를 'active'로 복원)

### 6-B-3. 정책 노트
- 사용자 신고가 임계 미달이어도 1건 누적되면 admin 큐에 노출 → 잠재 어뷰즈 조기 발견
- `report_weight` 어뷰저 down 은 Phase 3 도구. Phase 1에서는 신고 사유 분포로 운영자가 수동 판단
- `vote_reports` 의 reporter는 운영자 화면에서 user_id 끝 4자리만 표시 (개인정보 최소화)

---

## 7. Phase 2 — 자동 랭킹 + 수동 선정 + fallback

### 7-1. 시간 정책

| 시각 (KST) | 동작 |
|---|---|
| **00:00** | cron 1 — 어제 후보 풀 OpenAI 평가 → 카테고리별 top 5 `today_rankings` 캐시. **발행 안 함** |
| 00:00 ~ 06:59 | 운영자가 RankingsPage 접속 → 카테고리별 1건 수동 선택 → `promote_today_candidates` |
| **07:00** | cron 2 — 발행일 카테고리 중 아직 `today` 없는 곳에 대해 `today_rankings` 1순위로 자동 promote (fallback) |
| 07:00 이후 | 운영자가 결과 검토. 마음에 안 들면 RankingsPage에서 다른 후보로 수동 override (idempotent) |

### 7-2. cron 설계

**Edge Function 신규 (cron 1)**: `supabase/functions/auto-rank-today/index.ts`

흐름:
1. `admin_list_today_candidates(yesterday)` 로 후보 풀 조회
2. 카테고리별로 묶음 (`daily / relationship / work / game`)
3. 각 카테고리에 대해 OpenAI 호출 — 후보 5~10개를 흥미도로 ranking
4. 카테고리별 top 5 → `today_rankings` UPSERT (`publish_date + category`)
5. 발행은 안 함 (운영자 시간 확보)

**Edge Function 신규 (cron 2)**: `supabase/functions/auto-select-fallback/index.ts`

흐름:
1. 오늘 발행일에 `today` 가 아직 없는 카테고리 조회
2. 해당 카테고리의 `today_rankings.ranks[0]` (1순위) vote_id 추출
3. 운영자 명의로 promote 안 됨 → `promote_today_candidates` 는 `auth.uid()` 검증하므로 admin RPC 변형 필요. 신규 RPC `auto_promote_from_rankings(p_publish_date date)` (security definer, 호출자 검증 X, service_role only)
4. 결과를 `auto_selections.status='auto_fallback'` 으로 기록

**pg_cron 등록**:
```sql
-- cron 1 — KST 00:00 (UTC 15:00 전날)
select cron.schedule(
  'auto-rank-today',
  '0 15 * * *',
  $$
    select net.http_post(
      url := current_setting('app.auto_rank_today_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- cron 2 — KST 07:00 (UTC 22:00 전날)
select cron.schedule(
  'auto-select-fallback',
  '0 22 * * *',
  $$
    select net.http_post(
      url := current_setting('app.auto_select_fallback_url'),
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

### 7-3. 신규 테이블 — today_rankings

```sql
create table public.today_rankings (
  id uuid primary key default gen_random_uuid(),
  publish_date date not null,
  category text not null,
  ranks jsonb not null,            -- [{rank:1, vote_id, score, reason}, ...] top 5
  candidates_summary jsonb,        -- 평가 대상 전체 후보 vote_id + score (감사용)
  prompt_version text,             -- admin_prompts 시점의 해시/버전 (재현성)
  created_at timestamptz not null default now(),
  unique (publish_date, category)
);

create index idx_today_rankings_date on public.today_rankings(publish_date desc);
```

### 7-3-A. 신규 테이블 — auto_selections (감사용)

```sql
create table public.auto_selections (
  id uuid primary key default gen_random_uuid(),
  publish_date date not null,
  category text not null,
  vote_id uuid references public.votes(id) on delete set null,
  source text not null,            -- 'admin_manual' | 'auto_fallback' | 'admin_override'
  rank_used int,                   -- fallback 시 1, override 시 선택된 순위
  ai_score numeric(4,2),
  ai_reason text,
  created_at timestamptz not null default now(),
  unique (publish_date, category)
);

create index idx_auto_selections_date on public.auto_selections(publish_date desc);
```

### 7-4. 관리자 페이지 — RankingsPage

```
┌─────────────────────────────────────────────────┐
│ 자동 랭킹 (2026-05-04 발행 대상)                │
│ 산출 시각: KST 00:00 / 자동 발행 예정: KST 07:00│
├─────────────────────────────────────────────────┤
│ [일상]                                          │
│  ① "카톡 읽씹, 화가 나?"  AI 8.4   [발행]      │
│  ② "월요일이 제일 싫지?"  AI 7.9              │
│  ③ "..."                  AI 7.3              │
│  ④ "..."                  AI 6.8              │
│  ⑤ "..."                  AI 6.1              │
├─────────────────────────────────────────────────┤
│ [연애] ① "..." 8.1점  [발행]  ② ③ ④ ⑤        │
│ [직장] ⚠️ 후보 0건 — fallback 시에도 미발행   │
│ [게임] ① "..." 7.9점  [발행]  ② ③ ④ ⑤        │
└─────────────────────────────────────────────────┘
```

- 카테고리별 top 5 카드 표시 (1위 강조)
- "발행" 클릭 → `promote_today_candidates` 호출 (idempotent — `today_selection` 보상 중복 INSERT는 idempotency_key로 차단)
- 이미 발행된 카테고리는 "발행됨" 뱃지 + override 버튼 (다른 순위로 변경 시 기존 today 강등 후 재발행 RPC 필요 — Phase 2 후반 결정)
- KST 07:00 이후 진입 시 fallback 결과(`auto_selections.source='auto_fallback'`) 시각적으로 구분

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
**핵심**: 관리자 페이지는 **랭킹 검토 + 수동 선정 + override + 프롬프트 편집** UI. 실제 자동 랭킹/fallback 은 **Supabase pg_cron + Edge Function** 이 담당.

- 운영자 출근 전 (KST 00:00 ~ 07:00) 랭킹 산출 완료 → 운영자가 검토 후 1건 선택
- 미접속/휴무 시 KST 07:00 fallback 이 1순위 자동 발행 → 컨텐츠 공백 방지
- 결과 마음에 안 들면 당일 RankingsPage에서 다른 순위로 수동 override

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
- [ ] 신규 마이그레이션 — `admin_moderation_actions` 테이블 + RPC 4종 (`admin_list_today_candidates`, `admin_list_votes`, `admin_soft_delete_vote`, `admin_list_reported_votes`, `admin_get_vote_reports`, `admin_restore_vote`)
- [ ] verdict-admin 프로젝트 초기화 (Vite + React + TS)
- [ ] Supabase 클라이언트 + AuthGuard
- [ ] LoginPage (magic link)
- [ ] VotesPage — 카테고리별 일반투표 검색/필터/soft delete
- [ ] ReportsPage — 신고 큐(아코디언) + 반려/유지 처리
- [ ] CandidatesPage — 카테고리별 후보 그룹핑 + 단일 선택 + 발행
- [ ] DashboardPage — 어제 발행 결과 요약 + 신고 미처리 카운트 + 비즈월렛 잔액 (수동 입력)
- [ ] GitHub Pages 배포 워크플로
- [ ] 첫 관리자 계정 `is_admin=true` 부여 + 동작 확인

### Phase 2
- [ ] 신규 마이그레이션 — `admin_prompts`, `today_rankings`, `auto_selections` 테이블 + `auto_promote_from_rankings` RPC
- [ ] Edge Function `auto-rank-today` — 후보 풀 OpenAI 평가 + top 5 캐시
- [ ] Edge Function `auto-select-fallback` — `today_rankings` 1순위 자동 promote
- [ ] pg_cron 등록 — KST 00:00 (랭킹) + KST 07:00 (fallback)
- [ ] RankingsPage — top 5 카드 + 발행 + override
- [ ] PromptsPage — system/user prompt 편집 + 미리보기 (mock 실행)
- [ ] 모니터링 — fallback 발동 시 운영자 알림 (Slack/이메일)

### Phase 3 (참고)
- [ ] MetricsPage — 일/주/월 토스포인트 지급 / 광고 환급 / 반려율 통계
- [ ] 비즈월렛 잔액 자동 동기화 (토스 API)
- [ ] 어뷰저 `report_weight` 조정 도구

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

1. **Phase 1 마이그레이션 작성** — `20260506000001_admin_phase1.sql` (테이블 + RPC 6종)
2. verdict-admin 레포 초기화 + 기본 라우팅 + AuthGuard
3. VotesPage / ReportsPage / CandidatesPage 핵심 흐름 구현
4. 검수 통과 + 토스 매핑 INSERT 시점에 베타 시작
5. 베타 1주차 데이터 보고 Phase 2 (자동 랭킹) 착수 여부 결정

---

*문서 버전: v0.2 | 작성: 2026-05-04 / 갱신: 2026-05-05*
*v0.2 변경: VotesPage/ReportsPage 추가, 자동 선정을 자동 랭킹+수동 선정+KST 07:00 fallback 모델로 전환, 신규 RPC/테이블 명세 갱신*
