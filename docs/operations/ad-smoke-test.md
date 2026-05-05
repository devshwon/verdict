# 광고 SDK 스모크 테스트 가이드

> 토스 광고 키 발급 + 테스트 모드 디바이스 등록 후 실 디바이스(iOS/Android 토스 인앱)에서 실행.
> 코드 측 자리는 모두 연결돼 있고, 이 문서는 **운영자 측 검증 시나리오**.

---

## 0. 사전 조건

- [ ] 광고 키 적용 확인 — `src/config/ads.ts`
  - banner: `ait.v2.live.cce936748f574538`
  - reward: `ait.v2.live.961fe0d042cf409e`
- [ ] 토스 디벨로퍼 센터에서 **테스트 모드 디바이스 등록** (실 디바이스의 토스 user_key 또는 device_id)
- [ ] AIT dev 빌드 또는 staging 빌드를 토스 인앱 환경에서 실행 가능
- [ ] 같은 계정으로 로그인 + Supabase staging DB 연결
- [ ] DB에 최소 검증 데이터 준비:
  - 일반 투표 10장 이상 (인라인 배너 트리거 확인용)
  - 마감 후 24시간 이내 + 미참여 투표 1건 (마감 투표 언락 게이트용)
  - "지난 오늘의 투표" 1건 이상 (다시보기 언락용)
  - 본인 일반 투표 등록 카운트가 2건 도달 (3건째+ 광고 게이트 트리거용)

---

## 1. 배너 광고 (TossAds)

### 1-1. 홈 피드 인라인 배너 (5장마다)
- [ ] 홈 진입 시 SDK init 콘솔 로그 확인 (`[ads] TossAds not supported...` 경고가 없어야 함)
- [ ] 피드 5번째 카드 직후에 배너 슬롯 노출
- [ ] 스크롤하면서 10·15·20번째 카드 직후에도 배너 노출 (각각 다른 slotId)
- [ ] 피드가 5장 미만이면 광고 미삽입 확인
- [ ] 카테고리 변경 후에도 정상 노출 (각 카테고리별 독립 fetch이지만 SDK init은 1회)
- [ ] 백그라운드 → 포그라운드 복귀 시 슬롯이 깨지지 않음

### 1-2. 투표 상세 결과 화면 하단 배너 (`AdSlot`)
- [ ] 투표 후 결과 phase에서 광고 영역 노출
- [ ] OverallResult / 성별·연령대 통계 → 배너 → ShareRow 순서 확인
- [ ] 결과 phase 진입 시점의 0.8초 연출 후 배너가 자연스럽게 나타나는지

### 1-3. 배너 공통 — fail 케이스
- [ ] 비행기 모드에서 진입 시 배너 영역이 비정상적으로 보이지 않음 (no-fill 시 height 0 또는 collapse)
- [ ] 토스 콘솔 로그에 `onNoFill` / `onAdFailedToRender` 정상 수신 (콘솔 확인은 콘솔 측 모니터링)

---

## 2. 리워드 광고 (GoogleAdMob.loadAppsInTossAdMob / showAppsInTossAdMob)

### 2-1. 마감 투표 결과 언락 (`VoteDetail` → `unlockWithAd`)
- [ ] 마감 후 24시간 이내 + 미참여 투표에 진입 → AdGate 노출
- [ ] 무료이용권 0개일 때 "광고 보고 결과 확인하기" 클릭 → 광고 로드 → 시청 → `userEarnedReward` → 토큰 발급 → `unlock_vote_results` 성공 → 결과 phase 자동 전환
- [ ] 시청 중 사용자가 광고 닫기 → "광고 시청이 완료되지 않았어요" 토스트 + AdGate 복귀
- [ ] 토큰 발급 실패 (`P0007`, 5분 만료) → "광고 시청이 만료됐어요" 토스트
- [ ] 무료이용권 1개 이상일 때 클릭 → `UnlockConfirmDialog` 노출
  - "이용권 사용" → 광고 미시청 + 즉시 언락
  - "광고 보고 열기" → 광고 시청 경로

### 2-2. 다시보기 언락 (`PastVoteCard` → `UnlockProvider.unlock`)
- [ ] 홈 하단 "지난 오늘의 투표" 카드의 잠금 해제 버튼 클릭
- [ ] 무료이용권 0개: 광고 시청 → 보상 → 즉시 카드가 결과 모드 (다음 진입 시 영구 언락 유지)
- [ ] 무료이용권 1개+: `UnlockConfirmDialog` 두 갈래 분기 모두 동작
- [ ] 광고 로드 15초 타임아웃: AbortController로 중단 → "광고 로드 시간이 초과됐어요" lastError
- [ ] 카드 새로고침/HomeFeed 재진입 시 언락 상태 유지 (server `vote_unlocks` hydrate 확인)

### 2-3. 등록 3건째+ 광고 게이트 (`useRegisterForm.submit`)
- [ ] 본인이 같은 KST일에 일반 투표 2건 등록한 상태로 등록 화면 재진입
- [ ] 무료이용권 0개: 제출 버튼 라벨 "광고 보고 등록하기" → 광고 시청 → `registerAdWatch` 토큰 → `register_vote(adUsed=true, adToken=...)` 성공
- [ ] 무료이용권 1개+: 제출 버튼 "무료이용권으로 등록하기" + 우상단 "광고 시청으로 등록하기" 토글로 전환 가능
- [ ] 광고 시청 실패 / 토큰 발급 실패 시 토스트 + 폼 유지

### 2-4. 마이페이지 무료이용권 1일 1회 (`FreePassCard.handleClaim`)
- [ ] 오늘 미수령 상태 → "광고 보고 1개 받기" 활성화
- [ ] 광고 시청 → `register-ad-watch(mypage_free_pass)` 토큰 → `claim_daily_ad_free_pass` → 잔량 +1
- [ ] 같은 KST일에 재시도 → "오늘은 이미 받았어요" 비활성화 (RPC `P0005`)
- [ ] 광고 시청 도중 닫음 → 토스트 + 잔량 변화 없음

---

## 3. 광고 토큰 검증 (서버 측)

광고 시청 후 `register-ad-watch` Edge Function이 토큰을 발급. 다음 어뷰징 케이스 검증:

- [ ] 광고 시청 없이 직접 RPC 호출 (개발자 도구) → `P0007` ad token invalid
- [ ] 같은 토큰을 두 번째 RPC에 재사용 → `P0007` (single-use)
- [ ] 토큰 발급 후 5분 경과한 뒤 RPC 호출 → `P0007` (만료)
- [ ] 일일 광고 시청 캡 (`ad_unit별 + 합계 100건/일`) 도달 → `register-ad-watch`가 `cap_reached` 반환
- [ ] `ad_watches` 테이블에 row 적재 확인 (Supabase Studio에서 `select * from public.ad_watches order by watched_at desc limit 20`)

---

## 4. 멀티 슬롯 / 정합성

- [ ] 홈에서 인라인 배너 여러 개 동시 노출 시 각 slotId 다름 (`onAdRendered` payload 확인)
- [ ] 페이지 이동(홈 → 상세) 시 이전 페이지의 BannerAd 모두 `destroy()` 호출 — 메모리 누수 없음
- [ ] 리워드 광고는 `loadAppsInTossAdMob` → 1회 `showAppsInTossAdMob` → 다음 시청 전 다시 load 필요. 동일 페이지에서 연속 2회 시청 시도 시 두 번째도 정상 (재로드 동작)
- [ ] 광고 진행 중 화면 언마운트 (예: 등록 화면에서 광고 시청 중 뒤로가기) → AbortSignal/cleanup 정상

---

## 5. 회귀 — 미션·무료이용권 잔량 정합

리워드 광고 시청은 여러 카운터에 영향. 한 시나리오로 통합 회귀:

1. [ ] 마이페이지 무료이용권 광고 1회 → 잔량 +1
2. [ ] 등록 화면에서 일반 투표 3건째 등록 시 자동으로 무료이용권 사용 (광고 X)
3. [ ] 잔량 0 상태로 다시 등록 시 광고 게이트 동작
4. [ ] 동일 KST일에 마이페이지에서 광고 재시도 → 1일 1회 캡 차단 확인
5. [ ] KST 자정 통과 후 (또는 백그라운드 → 포그라운드) → 미션 카운터 자동 갱신 확인 (HomeFeed의 visibility/interval refresh)

---

## 6. 일일 미션 자정 갱신 (이번 세션 수정 사항)

- [ ] 앱을 KST 23:55에 열고 자정 통과까지 켜놓기 → 60초 안에 미션 카운터 자동 0/3 리셋
- [ ] 앱 백그라운드 → 다음날 포그라운드 복귀 → 즉시 미션 갱신
- [ ] 동시에 무료이용권 잔량도 정확히 노출

---

## 7. 발견 시 조치

- 광고 노출 0% (no-fill) 지속: 토스 콘솔에서 `adGroupId` 활성 상태 / 트래픽 매칭 확인
- 클라이언트 콘솔에 `[ads] TossAds not supported`: 빌드 환경이 토스 인앱이 아니라 일반 웹 브라우저 (정상 동작 — 토스 인앱에서 검증)
- 토큰 발급 실패가 빈번: `register-ad-watch` Edge Function 로그(`supabase functions logs register-ad-watch`)에서 `verifySdkPayload` 실패 사유 확인
- 리워드 시청 후 보상 안 받음: `userEarnedReward` 이벤트 수신 여부 콘솔 확인. 받았는데도 안 들어오면 `register-ad-watch` 호출 또는 RPC 단계에서 실패한 것 — 다음 토큰 검증 단계 로그 확인

---

*작성: 2026-05-04 | 기반: 본 세션 광고 SDK 통합 + 인라인 배너 전환*
