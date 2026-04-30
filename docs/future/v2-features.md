# v2 기능 기획 (v1 출시 후)

> v1 출시 범위에 포함하지 않지만 **데이터 모델 / 마이그레이션 틀은 v1에서 미리 준비**해 두어 v2 도입 시 마이그레이션 부담을 최소화.
> 화면 노출은 v2 시점에만.

---

## F1. 친구 초대 보상 (양쪽 무료이용권 +1)

### 정책

- 초대자가 본인 초대 링크 공유 → 신규 유저가 그 링크로 가입 → **양쪽 모두 무료이용권 1개** 획득
- 어뷰징 방지: 신규 유저는 토스 실명 기반 1인 1계정이라 자체 차단됨 (가입 후 24시간 보상 보류 정책으로 한 번 더 게이트)
- 1인당 초대 보상 일일 캡: 5회 (어뷰저가 단기간 다계정 모집 차단)
- 초대 링크 유효기간: 30일

### 데이터 모델 (v1에서 준비, v2에서 활성화)

**v1 스키마 — 미리 만들어 둠 (`free_pass_grants.source` enum에 `friend_invite` 포함):**

```sql
-- 이미 v1에 포함됨
free_pass_grants.source check (source in (
  'ad_reward', 'friend_invite', 'purchase', 'event_promotion', 'admin_grant'
));
```

**v2 — 추가 마이그레이션 필요:**

```sql
-- 초대 관계 테이블
create table public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.users(id) on delete cascade,
  invitee_id uuid references public.users(id) on delete set null,
  invite_code text not null unique,           -- 초대 링크에 포함되는 토큰 (해시 또는 base62)
  created_at timestamptz not null default now(),
  accepted_at timestamptz,                    -- invitee가 가입 완료한 시각
  expires_at timestamptz not null,            -- 30일 후 만료
  status text not null default 'pending'      -- pending / accepted / expired / revoked
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  reward_granted boolean not null default false,
  unique (inviter_id, invitee_id)             -- 같은 사람 두 번 초대 불가
);

create index idx_friend_invites_inviter on public.friend_invites(inviter_id, created_at desc);
create index idx_friend_invites_code on public.friend_invites(invite_code);
create index idx_friend_invites_pending on public.friend_invites(expires_at) where status = 'pending';

-- RLS: 초대자는 본인 초대 이력, 초대받은 자는 본인 row 보임
alter table public.friend_invites enable row level security;
create policy invites_self_view on public.friend_invites
  for select using (auth.uid() = inviter_id or auth.uid() = invitee_id);

-- RPC: generate_invite_code() — 본인 초대 링크 생성
-- RPC: accept_invite(p_code) — 가입 직후 호출, 양쪽 free_pass +1
```

### v2 화면 추가

- 마이페이지 — "친구 초대" 섹션 (현재 무료이용권 카드 아래)
  - "초대 링크 복사" 버튼 + 카카오톡 공유
  - 누적 초대 성공 횟수 / 받은 무료이용권 표시
- 가입 직후 (토스 첫 진입) — 초대 코드가 URL에 있으면 자동 적용

### 의존

- v1 출시 후 트래픽 안정화 확인 후 도입 (어뷰저 패턴 학습 후 캡 조정)

---

## F2. 인앱 결제 (무료이용권 구매)

### 정책

- 무료이용권 패키지 인앱 결제 (예: 5개 ₩1,000 / 12개 ₩2,000 / 30개 ₩4,500)
- 결제 채널: 토스 인앱 결제(IAP) 우선 검토 — 앱인토스 환경 통합성
- 환불 정책: 결제 후 미사용 패스에 한해 7일 내 환불 가능
- 미성년자 결제 보호: 토스 정책에 따름

### 데이터 모델 (v1에서 준비)

**v1 스키마 — 미리 만들어 둠:**

```sql
-- 이미 v1에 포함됨
free_pass_grants.source check (source in (
  ..., 'purchase', ...
));
free_pass_grants.related_purchase_id text  -- 결제 트랜잭션 ID
```

**v2 — 추가 마이그레이션 필요:**

```sql
-- 결제 트랜잭션 이력
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_code text not null check (product_code in (
    'free_pass_5', 'free_pass_12', 'free_pass_30'
  )),
  amount_krw int not null check (amount_krw > 0),
  free_pass_granted int not null check (free_pass_granted > 0),
  toss_payment_key text not null unique,    -- 토스 IAP 결제 키
  status text not null default 'pending'    -- pending / completed / refunded / failed
    check (status in ('pending', 'completed', 'refunded', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  refunded_at timestamptz
);

create index idx_purchases_user on public.purchases(user_id, created_at desc);
create index idx_purchases_pending on public.purchases(created_at) where status = 'pending';

-- RLS: 본인 결제만 조회
alter table public.purchases enable row level security;
create policy purchases_self_select on public.purchases
  for select using (auth.uid() = user_id);

-- RPC: complete_purchase(p_payment_key, p_product_code)
--   토스 결제 검증 + free_pass 적립 + 트랜잭션 기록
```

### v2 화면 추가

- 마이페이지 무료이용권 카드 — "충전하기" 버튼 추가
- 결제 시트 (TDS BottomSheet) — 패키지 3종 + 토스 결제 SDK 호출
- 결제 완료 후 즉시 잔량 갱신 + 토스트

### 의존

- 토스 IAP 약관 + 광고 SDK 약관 교차 점검
- v2 마이페이지 결제 이력 섹션 (구매·환불·잔량 변화 타임라인)
- 세무사 컨펌 (월 매출 ₩100만 초과 시점부터 — 기획서 §7-3과 동일 트리거)
- 미성년자 결제 보호 정책

---

## F3. 통합 — 마이페이지 무료이용권 카드 (v2 완성형)

v1 마이페이지 무료이용권 카드는 "광고 시청으로 1개 받기" 단일 액션. v2에서 다음과 같이 확장:

```
🎫 무료이용권  N개
   ─────────────────────────────
   [광고 보고 받기]   1일 1회 (오늘 받음/받기)
   [친구 초대로 받기] 5명 / 일 (초대 링크 복사)
   [충전하기]        5개 ₩1,000 / 12개 ₩2,000 / 30개 ₩4,500
   ─────────────────────────────
   사용 이력 보기 →
```

---

## v1에서 미리 준비할 것 (이미 포함될 마이그레이션)

이번 free_pass 마이그레이션(`20260430000006_free_pass_and_missions.sql`)에 다음이 포함됨:

- `free_pass_grants.source` enum에 `friend_invite`, `purchase` 포함 (v2에서 그대로 사용)
- `free_pass_grants.related_invite_id`, `related_purchase_id` 컬럼 미리 추가
- v2에서는 별도 테이블(`friend_invites`, `purchases`) 추가 + 해당 RPC만 작성하면 됨

→ **v2 도입 시 free_pass 모델 자체는 손댈 필요 없음.** 신규 테이블 + RPC만 추가.

---

## 도입 순서 권장

1. **v1 출시 + 1~2개월 안정화**
2. **F1 친구 초대** 먼저 — 어뷰징 패턴 데이터 학습 + 신규 유입 채널 확보
3. **F2 인앱 결제** — F1 어뷰징 패턴 검증 후, 결제 약관 정리 + IAP 통합
4. **F3 통합 카드 UI** — F1, F2 모두 도입 후 마이페이지 정리

---

*작성: 2026-04-30 | 기반: pickit_plan.md v1.6 / v1 free_pass 마이그레이션*
