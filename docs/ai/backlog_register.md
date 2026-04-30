# Register 화면 — 다음 단계 백로그

> 브랜치 `feature/register`에서 P1~P5 (화면 구성 + 더미 제출) 완료 후 후속 작업 정리.
> 현재 상태: TDS 컴포넌트 기반 폼 UI 완성, App.tsx 미수정 (라우터 브랜치 머지 대기).

---

## P6. 검증 실패 인라인 메시지

**목표:** 등록 버튼이 왜 비활성인지 사용자가 즉시 알 수 있게 하기.

**작업**
- `useRegisterForm`에 필드별 `errors` 도출 추가 (질문 비어있음 / 선택지 < 2개 / 카테고리 미선택)
- `QuestionInput`, `ChoiceList`, `CategoryPicker`에 `hasError` + 보조 텍스트 노출
- 최초 진입 시에는 표시하지 않고, 제출 시도 또는 blur 이후에만 노출 (touch 패턴)

**DoD**
- [ ] 빈 폼에서 등록 버튼 탭 시 모든 필수 필드에 에러 메시지 표시
- [ ] 입력이 채워지면 해당 필드 에러 즉시 사라짐
- [ ] TDS `TextField`의 `hasError` + `help` prop 활용

---

## P7. 홈 → 등록 진입 동선

**목표:** 라우터 브랜치 머지 후 홈에서 등록 화면으로 이동.

**작업**
- 홈 `Top` 우상단 액세서리에 `+` 아이콘 버튼 추가
- 라우터 인터페이스에 맞춰 `/register` 이동 핸들러 연결
- 등록 완료 후 홈으로 복귀 + 토스트/스낵바 노출 (선택)

**DoD**
- [ ] 홈에서 + 버튼 탭 → 등록 화면 진입
- [ ] 등록 화면 좌상단 뒤로가기 → 홈 복귀
- [ ] 더미 제출 성공 후 홈으로 자동 복귀

**의존:** `react-router-dom` 도입 브랜치 머지

---

## P8. 디자인 토큰 정리

**목표:** 인라인 스타일에 흩어진 폰트/굵기 값을 토큰화.

**작업**
- `src/design/tokens.ts`에 `fontWeight`, `borderWidth` 토큰 추가
- 각 register 컴포넌트의 인라인 숫자값 (15, 14, 12, 600, 500 등) 토큰 참조로 교체
- 섹션 라벨 스타일을 공용 `<SectionLabel />`로 추출 검토 (3곳 중복: ChoiceList, CategoryPicker, DurationPicker)

**DoD**
- [ ] register 폴더 내 인라인 px/font-weight 하드코딩 0건
- [ ] 토큰 변경 시 폼 전체 일관 반영

---

## P9. WebView 키보드 대응

**목표:** iOS/Android 토스 웹뷰에서 입력 시 sticky SubmitBar가 가리지 않도록.

**작업**
- 입력 포커스 시 `scrollIntoView({block: 'center'})` 또는 `visualViewport` 리스너로 SubmitBar 위치 조정
- iOS Safari `env(safe-area-inset-bottom)` 적용
- 실기기 (iPhone / Android Toss in-app) 확인

**DoD**
- [ ] 키보드 올라온 상태에서 모든 입력 필드가 시야에 보임
- [ ] SubmitBar가 키보드에 가려지지 않거나, 키보드 위로 자연스럽게 올라옴
- [ ] safe-area 미지원 기기에서 레이아웃 깨짐 없음

---

## P10. Claude API 검열 연동 자리 만들기

**목표:** 실제 등록 플로우의 자동 검열 단계를 더미로 끼워두기 (실 API 연동은 별도 패킷).

**작업**
- 제출 직후 `submitting` 단계에 "검토 중..." 상태 추가
- 검열 결과 mock (랜덤 통과/반려) → 반려 시 사유 다이얼로그
- TDS `BottomSheet` 또는 `AlertDialog`로 결과 표시

**DoD**
- [ ] 제출 → 검토 중 → (통과/반려) 흐름이 시각적으로 구분됨
- [ ] 반려 시 "다시 작성" 버튼으로 폼 유지
- [ ] 통과 시 더미 alert 대신 성공 다이얼로그

---

## P11. 일일 등록 횟수 제한 UI

**목표:** Charter 6.1 — 1일 최대 3개 제한 시각화.

**작업**
- 화면 진입 시 "오늘 N/3개 등록" 표시 (mock 카운트)
- 3개 도달 시 폼 disabled + 안내 문구
- 신규 계정 24시간 쿨다운 mock 분기

**DoD**
- [ ] 등록 가능 횟수가 상단에 표시됨
- [ ] 한도 도달 시 등록 버튼 영구 비활성 + 사유 노출
- [ ] mock 데이터로 동작 검증

---

## 우선순위 제안

1. **P7** (라우터 머지 직후, 가장 먼저) — 동선 없이는 다른 화면에서 register 진입 불가
2. **P6** (UX 갭 채우기) — disabled 이유가 안 보이는 현 상태는 사용자 혼란 유발
3. **P9** (실기기 검증 필요) — WebView 환경 특성상 데스크탑에선 안 보임
4. P8, P10, P11 — MVP 핵심은 아니지만 품질·정책 정합성에 기여

---

*작성: 2026-04-29 | 기준 패킷: P1~P5 (화면 구성 + 더미 제출 완료)*
