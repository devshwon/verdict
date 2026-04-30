# Supabase 연동 패킷 — 후속 백로그

> 1·2·3 화면(HomeFeed / VoteDetail / RegisterScreen) Supabase 연동 + 결과 게이트 + 등록 RPC 작업 후 미루어진 항목들.
> 본 문서는 **추적용 체크리스트**. 항목별 DoD에 `- [ ]` / `- [x]`로 표시. 모두 완료되면 파일 삭제(또는 `done/` 이동) — §운영 룰 참고.

---

## 진행 상태 요약

- [x] 1·2번 화면(HomeFeed / VoteDetail) DB 연동 + 광고 게이트(A안) 적용
- [x] 3번 화면(RegisterScreen) DB 연동 + 일일 캡 + 광고 게이트
- [x] 4번 화면(MyPage) DB 연동 — 미션·무료이용권·인구통계 토글·심사/반려 노출
- [x] 5번 화면(TodayArchive) DB 연동 + UnlockProvider 서버 영구화
- [x] 무료이용권 모델 + 일일 미션 RPC + 홈 미니 위젯
- [x] 오늘의 투표 승격 운영 가이드 (`docs/operations/today-vote-promotion.md`)
- [x] v2 기능 문서 (`docs/future/v2-features.md` — 친구 초대 / 인앱 결제)
- [x] **S1 LLM 검열** — moderate-vote Edge Function (OpenAI gpt-4o-mini, JSON 모드) + register_vote가 pending_review로 INSERT
- [x] **S2 광고 시청 콜백 검증** — ad_watches 테이블 + register-ad-watch EF + 모든 RPC가 ad_token 검증
- [x] **S3 토스포인트 지급 워커** — payout-points EF + fn_get_pending_payouts + 일일 한도 + 신규 24h 지연
- [x] **S1-FALLBACK** — fn_moderate_pending_fallback + 5분마다 cron 자동 재시도
- [x] **S4 자동 삭제 + 운영 모니터링** — `docs/operations/monitoring.md` (cron 잡 / 큐 / 어뷰징 / 알람 임계값)
- [x] **S5 today_candidate 7일 만료** — cleanup-today-candidates-7d cron
- [x] **S6 duration 제약 완화** — `between 1 and 1440`으로 변경, 운영자 임의 분 단위 발행 가능
- [x] **S7 admin 권한 + promote_today_candidates RPC** — RPC 완료, 프론트 운영자 대시보드는 별도
- [x] **S8 검열 반려 보상 회수** — moderate-vote가 reject 시 points_log status='blocked'로 마킹

---

## S1. LLM 검열 도입 (질문 등록 시 자동 모더레이션)

**기획서 근거**: §6 2단계 — 혐오/비하/정치적 편향 감지 + 중복 유사도 + 품질 점수
**현재 상태**: `register_vote` RPC가 즉시 `status='active'`로 INSERT. 검열 단계 없음.

**작업**
- `supabase/migrations/.../votes_default_pending_review.sql` — `votes.status` 기본값 `'active'` → `'pending_review'` 변경 (이미 enum에는 추가됨 — 마이그레이션 #20260430000000)
- `supabase/functions/moderate-vote/index.ts` — OpenAI Chat Completions 호출:
  - 입력: `vote_id`
  - `gpt-4o-mini` + `response_format: { type: "json_object" }` (JSON 강제)
  - 질문/옵션/카테고리 + 최근 30일 같은 카테고리 sample(10개)로 유사도 평가
  - 통과 → `votes.status = 'active'`, `votes.ai_score = <0~10>`
  - 반려 → `votes.status = 'blinded'` + `rejection_reason` 기록
  - 비용: 1건당 약 ₩0.24 (sample 10개 기준)
- `register_vote` RPC 변경: `status='pending_review'`로 INSERT 후 Edge Function 호출 (또는 `pg_net`으로 비동기 트리거)
- 클라이언트 RegisterScreen: 등록 직후 응답에 검열 진행중 안내 추가 ("심사 중이에요 — 결과는 마이페이지에서 확인하세요")

**DoD**
- [x] `votes.status` 기본값을 `pending_review`로 마이그레이션 (`20260430000008_moderation.sql`)
- [x] `moderate-vote` Edge Function 작성 — OpenAI `gpt-4o-mini` + JSON 모드 + sample 10개 유사도 비교
- [x] 등록 → 검열 → active/blinded 자동 전환 (RegisterScreen이 등록 직후 호출)
- [x] 반려 사유를 마이페이지에서 작성자만 조회 (`votes.rejection_reason` + 기존 RLS로 본인만)
- [ ] 검열 실패 시 fallback 정책 (Edge 타임아웃 → 운영자 큐) — **별도 후속 §S1-FALLBACK**
- [ ] **운영자 적용 작업**: `OPENAI_API_KEY` Supabase secret 설정 + `supabase functions deploy moderate-vote`
- [ ] **검증**: 정상 / 혐오 / 중복 / 도배 4종 케이스로 등록해 결과 확인

**우선순위**: 높음 — 코드는 완료, 배포 + 검증 필요

---

## S2. 일일 광고 시청 빈도 캡 + 콜백 검증 (어뷰징 방지)

**기획서 근거**: §13-3 frequency cap 저장소 — 클라이언트 + 서버 이중 기록
**현재 상태**: 등록 화면에서 `setTimeout(1500ms)`로 시뮬레이션, `ad_used=true`만 클라이언트가 자유롭게 보낼 수 있음 → 광고 시청 없이도 등록 우회 가능.

**작업**
- `vote_unlocks` / 등록 광고 게이트에 모두 적용
- 클라이언트 `ad_used` 플래그 신뢰 제거 → 토스 리워드 광고 SDK 시청 콜백 토큰을 서버로 전달
- `ad_watches(user_id, occurred_at, ad_unit_id, callback_token, verified bool)` 테이블 신규
- `register_vote` / `unlock_vote_results` RPC가 `p_ad_token` 받아서 검증 (토큰 unique + verified=true + 최근 5분 이내)
- 일일 광고 시청 횟수 캡 (예: 일일 50회) — 캡 초과 시 거부

**DoD**
- [x] `ad_watches` 테이블 + RLS (`20260430000009_ad_watches.sql`)
- [x] `register-ad-watch` Edge Function — 토큰 발급 + 일일 캡 (ad_unit별 + 합계 100/일)
- [x] `register_vote` / `unlock_vote_results` / `claim_daily_ad_free_pass` 모두 `p_ad_token` 검증 (`fn_consume_ad_token` 헬퍼)
- [x] 클라이언트 4곳(VoteDetail / RegisterScreen / FreePassCard / UnlockProvider) 모두 시뮬레이션 광고 → `registerAdWatch` → 토큰 받아 RPC 전달
- [x] 캡 초과 시 P0007 / 429 응답 + 사용자 토스트 안내
- [ ] **클라이언트 `setTimeout` 시뮬레이션 제거** — 실 토스 SDK 통합 시점에 (`SIMULATED_AD_MS`, watchAd 함수 교체)
- [ ] **`verifySdkPayload` 실제 검증** — 토스 SDK 콜백 서명/타임스탬프 체크 로직
- [ ] **운영자 적용 작업**: `supabase functions deploy register-ad-watch`
- [ ] 어뷰저 디바이스 핑거프린트 기록 — 별도 후속 (토스 SDK 제공 시점)

**우선순위**: 중 — 인프라 완료, SDK 통합만 남음

---

## S3. 토스포인트 지급 워커 (`points_log.status='pending' → 'completed'`)

**기획서 근거**: §7-1 토스 비즈월렛 리워드 API로 즉시 지급
**현재 상태**: `points_log`는 `pending` 상태로만 적립됨. 실제 토스 포인트 지급 채널 미연결.

**작업**
- `supabase/functions/payout-points/index.ts` 신규 — 주기적 워커 (pg_cron 또는 외부 트리거):
  - `points_log where status='pending'` 조회 (배치)
  - 토스 비즈월렛 리워드 API 호출 (mTLS, 사용자별)
  - 성공 → `status='completed'`, `toss_transaction_id` 기록
  - 실패 → `status='failed'`, 사유 별도 컬럼
- 카테고리 1 / 카테고리 2 일일 합산 한도 검증 (§7-2 — 30P / 130P)
- 디바이스 1:1 매핑 + 신규 가입자 24h 지연 + 단일 클릭 패턴 탐지 (별도 검증 단계)
- 분쟁 대비: 사용자/시각/금액/트리거 ID 전수 로그 (이미 `points_log`에 있음 — 보존 정책 명시)

**DoD**
- [x] `payout-points` Edge Function 작성 — `fn_get_pending_payouts` 호출 + 토스 API 호출 + 결과 RPC 갱신
- [x] 일일 합산 한도 강제 — `fn_check_daily_payout_limit` + `point_status='blocked'` enum 추가
- [x] 신규 가입자 24h 지연 — `fn_get_pending_payouts`가 자동 필터
- [x] 카테고리 분류 헬퍼 (`fn_points_category` — `normal_*`/`streak_*` → 1, `today_selection`/`100_participants` → 2)
- [ ] **운영자 적용 작업**:
  - `supabase functions deploy payout-points`
  - `TOSS_BIZWALLET_API_KEY` (+선택 `TOSS_BIZWALLET_BASE_URL`, mTLS 인증서) Supabase secret 설정
  - 마이그레이션 §6의 pg_cron 잡 등록 SQL 실행 (URL/SERVICE_ROLE_KEY 치환)
- [ ] 토스 비즈월렛 약관 + 광고 SDK 약관 교차 확인
- [ ] 실패 재시도 정책 — 현재는 `failed`로 마킹만 (재시도 안 함). 운영자 수동 검토 후 SQL로 `pending` 복원
- [ ] 정산 리포트 SQL 템플릿 (월별 트랙별)

**우선순위**: 중 — 코드/인프라 완료, 토스 API 통합 + cron 설정만 남음

---

## S4. 일반 투표 30일 / 오늘의 투표 180일 자동 삭제 검증

**현재 상태**: pg_cron 잡 등록(`20260430000003_pg_cron_vote_cleanup.sql`)은 됐으나 실제 삭제 동작 검증 미완료.

**작업**
- 테스트 데이터로 마감일 30일 경과한 일반 투표 / 180일 경과한 오늘의 투표 1건씩 강제 생성
- pg_cron 잡 트리거 시 정상 DELETE 확인
- ON DELETE CASCADE로 `vote_options`, `vote_casts`, `vote_unlocks`, `today_candidate_recommendations` 함께 정리되는지 확인
- `points_log.related_vote_id`는 `set null`로 anonymize 확인 (이미 마이그레이션 적용됨)

**DoD**
- [x] 운영 모니터링 SQL 정리 (`docs/operations/monitoring.md` §1, §2)
- [x] 알람 임계값 권장치 문서화 (`docs/operations/monitoring.md` §8)
- [ ] **운영자 적용 작업**: 30/180일 경과 시점 도래 후 실제 삭제 동작 검증
- [ ] 종속 테이블 cascade 검증 (테스트 데이터로)
- [ ] points_log anonymize 확인 (`user_id is null` row 조회)

**우선순위**: 낮음 — 모니터링 SQL은 준비, 실제 검증은 데이터 누적 후

---

## S5. today_candidate 미선정 자동 만료 정책

**기획서 근거**: §12에 today_candidate 정리 정책 미명시
**현재 상태**: 선정 안 된 후보는 `type='today_candidate'`로 영구 잔존 → DB 누적

**결정 필요**
- 미선정 후보를 며칠 후 자동 삭제할지
- 또는 별도 상태(`expired`)로 마킹하고 마이페이지에서 "후보 신청 — 미선정"으로 노출할지

**제안**
- 등록일 +7일 경과 시 자동 삭제 (가장 단순, DB 가벼움)
- 또는 등록일 +7일에 작성자에게 "선정되지 않았어요" 푸시 + 삭제

**DoD**
- [x] 정책 결정: 등록일 +7일 자동 삭제
- [x] cleanup-today-candidates-7d cron 잡 (`20260430000011_admin_and_fallback.sql`)
- [ ] `docs/pickit_plan.md` §12에 today_candidate 정책 추가 — 별도 §S5-DOCS
- [ ] 작성자 알림 (선정/미선정) — 푸시 인프라 도입 시점

**우선순위**: 낮음 — cron 등록 완료, 데이터 누적 후 동작 확인

---

## S6. today 발행 시 duration 제약 완화

**현재 상태**: `votes.duration_minutes` CHECK 제약이 `(10, 30, 60, 360, 1440)`만 허용. 오늘의 투표를 KST 08:00 ~ 23:59 (16시간 = 960분)로 운영하려면 제약 위반.

**현재 우회**: 발행 시각을 KST 00:00로 두고 1440분(=24시간) 사용 → 다음날 00:00 KST 마감. 기획서 §5의 "오전 8시 발행" 의도와 미세 차이.

**작업**
- 옵션 A: type='today'에는 duration 제약 풀기 (CHECK constraint를 type별 분기)
- 옵션 B: 모든 type에서 duration enum 풀고 `1 ~ 1440` 범위만 검사 (단순)
- 옵션 C: 현재 우회 그대로 유지 — 운영 시각만 KST 00:00로 합의

**DoD**
- [x] 정책 결정: 옵션 B (모든 type 1~1440 범위)
- [x] 마이그레이션 (`20260430000011_admin_and_fallback.sql` §S6)
- [x] `today-vote-promotion.md` §2-2 RPC 사용으로 갱신

**우선순위**: 완료

---

## S7. 운영자 대시보드 + admin 권한 모델

**현재 상태**: today_candidate 승격을 SQL Editor에서 직접 실행. 운영 자동화 미구현.

**작업**
- `users.is_admin boolean default false` 컬럼 또는 별도 `admins` 테이블
- `promote_today_candidates(uuid[])` RPC (security definer, admin 검증)
- 별도 라우트 `/admin/today-candidates` + 라우트 가드
- AI 점수 + 추천수 + 작성자 활동 통계 한 화면에 표시
- 카테고리별 라디오 선택 + "오늘의 투표로 승격" 버튼

**DoD**
- [x] admin 권한 컬럼 (`users.is_admin`) — `20260430000011_admin_and_fallback.sql`
- [x] `promote_today_candidates(jsonb, date)` RPC — admin 검증 + 카테고리별 일괄 승격 + today_selection 30P 보상
- [x] `today-vote-promotion.md` §2-2 절차를 RPC 호출로 갱신
- [ ] **운영자 적용 작업**: 운영자 계정에 `update public.users set is_admin = true where id = '<운영자 id>'` 실행
- [ ] 관리자 대시보드 화면 (별도 React 라우트) — **별도 패킷 §S7-UI**
  - `/admin/today-candidates` 라우트 + admin 가드
  - 어제 후보 카드 그리드 + AI 점수 / 추천수 / 작성자 통계
  - 카테고리별 라디오 + "오늘의 투표로 승격" 버튼 → RPC 호출

**우선순위**: 중 — RPC + 운영 가이드 완료. UI는 출시 후 트래픽 봐서 추가 결정

---

## S1-FALLBACK. 검열 큐 fallback (S1 후속)

**현재 상태**: 클라이언트가 `moderate-vote`를 호출하지 않고 도주해도 5분 후 cron이 자동 재시도.

**DoD**
- [x] 정책 결정: 옵션 A (자동 moderate-vote 호출)
- [x] `fn_moderate_pending_fallback` 함수 — 5분 이상 pending_review 행에 대해 pg_net으로 EF 호출 (`20260430000011`)
- [x] `moderate-vote-fallback` cron 잡 — 5분마다 호출
- [ ] **운영자 적용 작업**: GUC 설정 — `ALTER DATABASE postgres SET app.moderate_vote_url = '...'` + `app.service_role_key = '...'`
- [ ] 모니터링: `docs/operations/monitoring.md` §3-1로 stuck 감지

---

## S8. 검열 반려 vote 보상 회수

**현재 상태**: 반려 시 등록 보상이 자동 회수됨.

**DoD**
- [x] 정책 결정: 회수 모델 (등록 시점 적립 + 반려 시 status='blocked')
- [x] moderate-vote가 reject 시 `points_log` 본 vote의 `normal_vote_register` / `today_candidate_register` `pending` row를 `blocked`로 일괄 UPDATE
- [x] 이미 토스 지급 완료(completed)된 row는 건드리지 않음 — 정책상 회수 불가
- [ ] 회귀 테스트 — 반려 케이스로 등록해 points_log 차단 확인 (운영자 적용 후 검증)

---

## 운영 룰 — 백로그 체크 워크플로우

이 백로그 파일은 **사용자가 명시적으로 요청해야** 검토함. 작업 흐름:

### 사용자가 작업 완료를 명시한 경우
> "S1 끝났어 체크해줘" → 해당 항목 DoD 박스를 `[x]`로 갱신

### 작업 후 자체 검토 요청
> "방금 한 작업이 백로그에 영향 있는지 확인해줘"
→ 최근 변경 파일 + 백로그 항목 매핑 후 완료된 DoD에 `[x]` 갱신, 변경 사항 요약 보고

### 모든 항목이 완료된 경우
> "백로그 모두 끝났는지 확인하고 정리해줘"
→ 모든 DoD가 `[x]`인지 검사, 미완료 항목 있으면 보고. 모두 완료면 사용자 확인 후 파일 삭제 또는 `docs/ai/done/backlog_supabase.md`로 이동.

### 새로운 백로그 항목 추가
> "이거 백로그에 추가해줘 — ..."
→ 다음 빈 번호(S8, S9, ...)로 항목 신설

### 자동 검사는 안 함
- 새 세션에서 임의로 백로그 검토 X
- 사용자 명시적 요청 시에만 동작

---

*작성: 2026-04-30 | 기반 패킷: 1·2·3번 화면 Supabase 연동 + 결과 게이트(A안) + 등록 RPC*
