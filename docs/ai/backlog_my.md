# MyPage — Backlog

> `feature/mypage` 패킷 이후 다음 단계 제안

## 다음 패킷 후보

### 1. 일치/불일치 색상 토큰화
- 현재: `ParticipatedSection.tsx`에 `MATCHED_STYLE`/`MISMATCHED_STYLE` 하드코딩 (`#EAF3DE`/`#27500A`, `#FAECE7`/`#712B13`)
- 색상값은 `feedTagStyles.new` / `feedTagStyles.popular`와 동일 — 중복 정의
- 다음: `tokens.ts`에 `matchStyles: { matched, mismatched }` 추가 후 `ParticipatedSection`에서 import
- DoD 후보:
  - `tokens.ts`에 `matchStyles` export
  - `ParticipatedSection`에서 하드코딩 제거
  - 색 외관 변화 0

### 2. 카드 → 상세 페이지 라우팅
- 현재: 마이페이지의 내 투표 / 참여한 투표 카드에 onClick 없음
- 다음: 각 카드를 `<Link to={`/vote/${id}`}>` 로 래핑, 상세 진입
- 의존: `/vote/:id` 라우트 (이미 존재)
- DoD 후보:
  - 카드 탭 시 상세 화면 이동
  - 상세 → 뒤로가기 시 마이페이지 스크롤 위치 유지(또는 명시적 미보장 결정)
  - 참여한 투표 진입 시 "내 선택" 사전 반영(P-03과 결합 가능)

### 3. HomeFeed 상단에 마이페이지 진입 추가
- 현재: 하단 BottomNav만으로 진입 가능 (임시 UI)
- 다음: `Top` 컴포넌트 우측 액션에 프로필 아이콘 추가 → `/mypage`
- BottomNav는 임시이므로 이 패킷에서 정식 네비게이션 결정 (Top 액션 vs 하단 탭바)
- DoD 후보:
  - 홈/상세에서 일관된 마이페이지 진입 동선
  - BottomNav 임시 UI 제거 또는 정식화 결정

### 4. 통계 실수치 연동 준비 (선행 작업)
- 현재: `mocks.ts`의 `myStats`는 정적 숫자
- 다음: `useMyStats()` 훅 시그니처만 먼저 정의, 내부는 mock 반환 — Supabase 연결 시 교체 지점 마련
- DoD 후보:
  - `features/mypage/hooks/useMyStats.ts` (mock 반환)
  - `MyPage.tsx`에서 mocks 직접 import 대신 훅 사용
  - 실연동은 별도 패킷

### 5. 빈 상태 / 신규 유저 케이스
- 현재: 빈 상태 메시지만 존재, "지금 투표 만들기" CTA 없음
- 다음: 올린 투표 0건 → "첫 투표 만들기" 버튼 → 등록 화면 라우트
- 참여 0건 → "홈으로 가서 투표하기" 버튼 → `/`
- DoD 후보:
  - 신규 유저(0/0/0)일 때도 화면이 비어 보이지 않음
  - 각 빈 상태에 1차 CTA 노출

### 6. 익명 닉네임 길이 가드 (후순위)
- 현재: `판정단 #A12F` 고정 포맷이라 길이 변동 적음
- 다음: 추후 사용자 지정 닉네임 도입 시 `text-overflow: ellipsis` 동작 확인
- 지금 당장은 작업 불필요, 닉네임 정책 변경 시 재검토

---

## 우선순위 제안

| 순서 | 패킷 | 이유 |
|------|------|------|
| 1 | 일치/불일치 색상 토큰화 | 디자인 시스템 일관성, 30분 이내 |
| 2 | 카드 → 상세 라우팅 | 사용자 동선 완결, 의존성 없음 |
| 3 | HomeFeed → 마이페이지 진입 | BottomNav 임시 UI 정식화 결정 동반 |
| 4 | 통계 훅 시그니처 분리 | Supabase 연동 패킷 직전에 진행 |
| 5 | 빈 상태 CTA | 등록 화면 패킷 완성 이후 |
| 6 | 닉네임 길이 가드 | 닉네임 정책 변경 시점에 |
