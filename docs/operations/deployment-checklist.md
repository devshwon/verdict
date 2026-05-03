# 배포 체크리스트 (출시 전 1회 실행)

> 코드 작업과 무관하게 **운영자 환경에서 수동 실행**해야 동작하는 항목 모음.
> 항목별 체크박스로 진행 상황 추적. 모두 끝나면 §8 스모크 테스트로 검증.

---

## 🚨 실서비스 출시 전 반드시 처리

테스트/베타 단계에서는 생략 가능하지만, **실 트래픽 + 실 토스포인트 지급 시작 전에 반드시** 처리해야 하는 항목.

- [ ] **`TOSS_BIZWALLET_API_KEY` + `TOSS_BIZWALLET_BASE_URL` 시크릿 설정** — 미설정 시 `payout-points`가 자동으로 시뮬레이션 모드(가짜 transaction_id 반환)로 동작해 실제 토스포인트는 지급되지 않음. 베타 테스트 중에는 이 모드로 진행 가능. 출시 직전 토스 비즈월렛 키 발급받아 §2에서 설정 필수.
- [ ] **토스 비즈월렛 약관 + 광고 SDK 약관 교차 확인** — "광고 시청 → 토스포인트 직지급" 흐름 허용 여부 (§7과 동일 사전 점검)
- [ ] **광고 키 — `live` 키 정상 작동 확인** — 현재 `ait.v2.live.*` 적용. 토스 콘솔에서 라이브 트래픽 노출 승인 상태인지 점검 (§7)

---

## 1. 새 마이그레이션 적용

세션에서 추가된 신규 마이그레이션 2건. 기존 dev 데이터에 6시간/24시간 duration 데이터가 있으면 §1-2가 실패하니 dev DB로 한정.

```bash
supabase db push
```

- [ ] `20260504000001_unlock_with_free_pass.sql` 적용 — `unlock_vote_results(uuid, text, boolean)` 신규 시그니처
- [ ] `20260504000002_duration_options.sql` 적용 — `duration_minutes` CHECK + `register_vote` 검증 (5/10/30/60)
- [ ] 검증: `\df unlock_vote_results` / `\d+ votes` 결과 확인

---

## 2. Supabase Secrets 설정

```bash
supabase secrets set OPENAI_API_KEY=sk-...
# ↓ 출시 직전(실 트래픽 + 실 지급 시작 전)에만 설정. 베타 단계는 미설정 → 시뮬레이션 모드 자동 동작
# supabase secrets set TOSS_BIZWALLET_API_KEY=...
# supabase secrets set TOSS_BIZWALLET_BASE_URL=https://...
```

- [ ] `OPENAI_API_KEY` 설정 (LLM 검열용 — `gpt-4o-mini`) — **베타에서도 필수** (안 넣으면 검열 실패)
- [ ] **(출시 전 필수)** `TOSS_BIZWALLET_API_KEY` + `TOSS_BIZWALLET_BASE_URL` 설정 — 베타 중에는 생략. `payout-points/index.ts:52`의 안전 가드가 시뮬레이션으로 동작 (transaction_id `simulated-...`, 실 지급 X). **§🚨 출시 전 반드시 처리** 참고.

---

## 3. Edge Functions 배포

```bash
supabase functions deploy moderate-vote
supabase functions deploy register-ad-watch
supabase functions deploy payout-points
# (이미 배포됨이면 skip)
supabase functions deploy toss-auth
supabase functions deploy toss-disconnect
```

- [ ] `moderate-vote` 배포 — LLM 검열 (S1)
- [ ] `register-ad-watch` 배포 — 광고 토큰 발급 + 일일 캡 (S2)
- [ ] `payout-points` 배포 — 토스포인트 지급 워커 (S3)

---

## 4. Database GUC 설정 (검열 fallback cron용)

Supabase SQL Editor에서:

```sql
ALTER DATABASE postgres SET app.moderate_vote_url
  = 'https://<project>.supabase.co/functions/v1/moderate-vote';
ALTER DATABASE postgres SET app.service_role_key
  = '<SERVICE_ROLE_KEY>';
```

- [ ] `app.moderate_vote_url` 설정 (프로젝트 URL 치환)
- [ ] `app.service_role_key` 설정 (Settings → API → service_role)
- [ ] 검증: `select current_setting('app.moderate_vote_url', true);`

> 미설정 시 `fn_moderate_pending_fallback`은 warning만 남기고 동작 X (이미 안전 가드 있음).

---

## 5. pg_cron 잡 활성화 (`payout-points-worker`)

`20260430000010_payout_infrastructure.sql` §6에 주석 처리된 SQL을 SQL Editor에서 치환·실행:

```sql
select cron.schedule(
  'payout-points-worker',
  '*/5 * * * *',  -- 매 5분
  $$
    select net.http_post(
      url := 'https://<project>.supabase.co/functions/v1/payout-points',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
        'Content-Type', 'application/json'
      )
    ) as request_id;
  $$
);
```

- [ ] `<project>` / `<SERVICE_ROLE_KEY>` 치환 후 실행
- [ ] 검증: `select * from cron.job where jobname = 'payout-points-worker';`
- [ ] 5분 후 동작 확인: `select * from cron.job_run_details where jobname = 'payout-points-worker' order by start_time desc limit 5;`

> 다른 cron 잡 (`vote-cleanup`, `cleanup-today-candidates-7d`, `moderate-vote-fallback`)은 마이그레이션이 자동 등록.

---

## 6. 운영자 계정 admin 권한 부여

```sql
update public.users
set is_admin = true
where id = '<운영자 user_id>';
```

- [ ] 운영자 user_id 확보 (토스 로그인 1회 후 `select id, email from public.users` 조회)
- [ ] `is_admin = true` UPDATE 실행
- [ ] 검증: `promote_today_candidates` 호출 시 권한 통과 (today-vote-promotion.md §2-2 참고)

---

## 7. 토스 디벨로퍼 센터 — 광고 키 / 약관

- [x] `BANNER_AD_GROUP_ID` 발급 — `ait.v2.live.cce936748f574538` (반영 완료)
- [x] `REWARD_AD_GROUP_ID` 발급 — `ait.v2.live.961fe0d042cf409e` (반영 완료)
- [ ] 토스 콘솔에 **테스트 모드 디바이스 등록** (실 디바이스 스모크 테스트 §A2 전제)
- [ ] **약관 교차 확인** — "광고 시청 → 토스포인트 직지급" 흐름이 비즈월렛 약관 + 광고 SDK 약관에서 모두 허용되는지

---

## 8. 검증 (배포 직후 스모크 테스트)

배포 후 다음 케이스로 회귀 검증:

### 8-1. LLM 검열 (S1)
- [ ] **정상 질문** 등록 → `votes.status = 'active'` + `ai_score` 기록
- [ ] **혐오/비하 질문** → `votes.status = 'blinded'` + `rejection_reason` 한국어
- [ ] **중복 질문** (최근 30일 내 유사 질문 등록 후) → 반려
- [ ] **검열 실패 fallback** — `pending_review`에서 5분 경과 시 자동 재처리 (cron 동작)

### 8-2. 광고 토큰 검증 (S2)
- [ ] 광고 시청 없이 등록 시도 → `P0007` 거부
- [ ] 광고 시청 후 등록 → 정상
- [ ] 같은 토큰 재사용 → 거부 (single-use)
- [ ] 5분 경과 토큰 → 거부

### 8-3. 토스포인트 지급 (S3)
- [ ] 등록 후 `points_log.status = 'pending'` 적립 확인
- [ ] cron 5분 후 `status = 'completed'` + `toss_transaction_id` 기록
- [ ] 일일 합산 한도 초과 시 `status = 'blocked'`
- [ ] 신규 가입자 24h 지연 — `created_at < now() - 24h` 행만 처리되는지

### 8-4. 자동 정리 (S4, S5)
- [ ] 마감 30일 경과 일반 투표 → 자동 삭제 (cascade로 vote_options/casts/unlocks 함께)
- [ ] 마감 180일 경과 오늘의 투표 → 자동 삭제
- [ ] 등록 7일 경과 미선정 today_candidate → 자동 삭제
- [ ] `points_log.related_vote_id` → `set null` 동작 확인

### 8-5. 검열 반려 보상 회수 (S8)
- [ ] 반려 케이스로 등록 → `points_log` 본 vote의 `normal_vote_register` 행이 `status = 'blocked'`
- [ ] 이미 `completed`된 행은 그대로 (회수 불가 정책)

---

## 9. 운영 모니터링 알람 등록

`docs/operations/monitoring.md` §8 권장 임계값으로 외부 모니터링(Datadog / Slack webhook 등) 설정:

- [ ] `points_log.status = 'pending'` 5분 이상 적체 (워커 stuck)
- [ ] `votes.status = 'pending_review'` 5분 이상 (검열 큐 stuck)
- [ ] `ad_watches` 일일 캡 도달 유저 수 추적 (어뷰저 시그널)
- [ ] cron 잡 실패율 (`cron.job_run_details where status = 'failed'`)

---

*작성: 2026-05-04 | 기반 백로그: backlog_supabase.md S1~S8 + 본 세션 신규 마이그레이션 2건*
