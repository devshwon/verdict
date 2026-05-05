# Navigation 패킷 — 다음 단계 백로그

> 브랜치 `feature/navigation`에서 라우팅 + BottomNav 연결 + 시니어 리뷰 1차 보완 완료 후 후속 작업.
> 현재 상태: 4개 라우트 매핑 / BottomNav 3탭 + 활성 표시 / SubmitBar BottomNav 회피 (`layout.bottomNavReserve`) / 토큰 하드코딩 정리 / 중복 클릭 방어 / 등록 성공 토스트.

---

## 처리 완료 (이번 라운드 리뷰 보완)

- B1 SubmitBar/BottomNav 충돌 — `layout.bottomNavReserve` 토큰 도입, SubmitBar `bottom` 상승, 화면별 `paddingBottom` 보강
- M1 토큰 하드코딩 — CategoryTabs/AdBanner/MyPage components/SubmitBar/ResultBar/DemographicGroup 일괄 정리, `layout` 그룹 신설
- M2 VoteOptions 중복 클릭 방어 — `disabled` prop 연결 + `handlePick` 가드
- M3 ShareRow 채널별 잠금 — 전역 ref → `pendingChannel` state로 채널 단위 disabled
- M4 console.log 제거 — `useRegisterForm` 클린업
- M5 등록 성공 피드백 — `onSuccess` 콜백 + Toast + 폼 reset
- M6 handleBack — `useLocation().key === "default"` 체크
- S2 Toast unmount — `toast === null`일 때 노드 자체 제거
- S5 CategoryTabs 가로 스크롤바 숨김 — `.hide-scrollbar` 유틸 + `WebkitOverflowScrolling: touch`

---

## N1. FeedCard 인라인 투표 UI 제거 (정합성)

**목표:** 기획서 §4-2와의 충돌 해소. 투표는 상세에서만 이뤄지도록 홈 카드의 인라인 투표(선택지 버튼 + 확정/취소)를 제거한다.

**배경**
- `feature/navigation` 결정: 홈 카드 클릭 시 미투표/기투표와 무관하게 상세로 이동, 투표는 상세에서.
- 현재 `FeedCard`는 카드 내부에 선택지 버튼과 `pendingId` 확정 흐름이 남아있어 동선이 이중화되어 있다.

**작업**
- `FeedCard`에서 `pendingId`/`voted` 로컬 state, 선택지 버튼, 확정/취소 UI 제거
- 카드 본문은 카테고리 태그 / 질문 / 참여자·남은시간 / 결과 바(투표 후)만 노출 — §4-1 명세대로
- "투표 후" 결과 바 노출 조건은 추후 전역 vote-state 연동 (N3)과 함께. 이 패킷에서는 `vote.showResultBar` 기준 유지

**DoD**
- [x] FeedCard 내 인라인 투표 버튼/확정 UI 제거
- [x] 카드 어느 영역을 탭해도 `/vote/:id`로 이동
- [x] 토큰 외 하드코딩 px 0, lint/타입 무결

---

## N2. 상세 → 홈 복귀 시 상태 복원

**목표:** 상세에서 뒤로가기 시 홈의 카테고리 탭 + 스크롤 위치를 복원해 피드 탐색 흐름을 끊지 않는다.

**작업**
- `HomeFeed`의 `active` 카테고리를 URL query (`?cat=daily`) 또는 sessionStorage로 보존
- 스크롤 위치는 `history` state 또는 `IntersectionObserver`로 마지막 카드 인덱스 보존
- 상세에서 뒤로가기 시 동일 카테고리 + 비슷한 위치로 복귀

**DoD**
- [x] 카테고리 변경 후 카드 → 상세 → 뒤로가기 시 카테고리 유지 (sessionStorage `home_feed_active`)
- [x] 스크롤 위치가 마지막 본 카드 근처로 복원 (sessionStorage `home_feed_scroll`, 첫 마운트 첫 ready 시 1회 복원)
- [x] 새로고침 케이스에서도 깨지지 않음 (try/catch로 storage 비활성 환경 fallback, VALID_CATEGORIES 화이트리스트 검증)

---

## N3. VoteDetail 투표 플로우 마감 (사용자 보류 항목)

**목표:** 상세 화면에서의 미투표 → 투표 → 결과 흐름을 정식 구현. (현재 phase 분기는 mock 기반)

**작업**
- 투표 결과/내 선택을 전역 (Context 또는 props chain) 또는 query state로 보관
- 홈 피드와 양방향 연동: 상세에서 투표 완료 → 홈 카드의 결과 바 자동 노출 (`showResultBar` true)
- "결과 집계 중…" 0.8초 연출 → 결과 노출 (이미 구현, polish 필요)
- 마감된 투표 vs 진행중 투표의 시각적 구분

**DoD**
- [x] 미투표 상세 → 옵션 선택 → 결과 노출까지 매끄럽게 연결 (castVote + minDelay + load 병렬 → 셋 다 끝난 후 result phase)
- [x] 상세에서 투표 후 홈 복귀 시 해당 카드가 결과 모드로 전환 (`src/lib/voteCache.ts` overlay)
- [x] 마감된 투표는 진입 시 즉시 결과 노출 (기존 phase 분기 + 결과 phase 상단 "최종 결과" 라벨로 시각 구분)

**의존:** N1 (FeedCard 정합성 정리 후 진행 권장)

---

## N4. BottomNav WebView 안전 영역 대응

**목표:** iOS/Android 토스 웹뷰의 하단 safe-area-inset과 키보드 올라옴 케이스에서 BottomNav가 가려지거나 입력을 가리지 않도록.

**작업**
- BottomNav `bottom`에 `env(safe-area-inset-bottom)` 가산
- `/register` 등 입력 화면에서 키보드 올라오면 BottomNav 자동 숨김 (visualViewport 리스너)
- 실기기 (iPhone / Android Toss in-app) 확인

**DoD**
- [x] iOS 노치/홈인디케이터 영역에서 BottomNav가 자연스럽게 위로 떠 있음 (`paddingBottom: calc(spacing.sm + env(safe-area-inset-bottom))` — 기존 `min(safe, md)` 캡 제거)
- [x] 등록 화면에서 키보드 올라올 때 BottomNav가 입력을 가리지 않음 (`useKeyboardOpen` hook으로 visualViewport delta > 150px 감지 → BottomNav 언마운트). SubmitBar는 safe-area-inset 자체 padding으로 home indicator 회피
- [x] safe-area 미지원 기기에서 레이아웃 깨짐 없음 (`env()` 미지원 시 0 → 최소 sm padding 유지)

---

## N5. 404 / NotFoundRoute

**목표:** 잘못된 경로 진입 시 홈으로 자연스럽게 안내.

**작업**
- `App.tsx`에 `<Route path="*" element={<NotFound />} />` 추가
- 간단한 안내 + 홈 버튼 (TDS Button)

**DoD**
- [ ] `/abc` 같은 잘못된 경로 진입 시 NotFound 노출
- [ ] 홈 버튼 탭 시 `/`로 replace 이동

---

## N6. 잔여 리뷰 항목 (이번 라운드에서 보류)

- **M7 mocks 번들 분리** — `import.meta.env.DEV` 가드 + dynamic import, 또는 API 연동 패킷에서 제거. 단독으로 손대면 Loading 상태 설계 필요해 데이터 패킷에 묶음.
- **S1 AIT SDK 우선 적용** — clipboard / share를 `@apps-in-toss/web-framework` SDK로 교체. SDK 문서 근거 확인 후 진행.
- **S3 Top 위계 일관성 점검** — VoteDetail은 자체 `DetailHeader` 사용, 다른 화면은 TDS `Top`. 의도된 분기지만 디자인 합의 필요.

---

## 우선순위 제안

1. **N1** — 기획서 정합성. 투표 동선 이중화는 다음 작업의 전제이므로 가장 먼저.
2. **N3** — 사용자가 "추후 진행"으로 보류한 상세 투표 플로우 마감. N1 직후.
3. **N2** — 탐색 UX 갭. 카테고리 + 스크롤 복원으로 회귀 방지.
4. N4, N5, N6 — 품질/엣지케이스 + SDK 정합성.

---

*작성: 2026-04-29 | 기준 패킷: feature/navigation (라우팅 + BottomNav 연결 완료)*
