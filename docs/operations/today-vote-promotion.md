# 오늘의 투표 승격 운영 가이드

> `today_candidate` → `today` 승격 절차 — 매일 운영자가 직접 1개를 픽해 다음날 발행.
> 향후 AI 자동 추천 + 운영자 1-클릭 승격 도구로 자동화 예정 (§자동화 섹션).

---

## 1. 운영 개요

### 1-1. 데이터 흐름

```
사용자가 "오늘의 투표 신청" 토글 ON으로 등록
    ↓
votes (type='today_candidate', status='active')
    ↓
같은 날 모인 후보들 (1인 1일 1건 하드캡)
    ↓
다음날 운영자 검토 (수동 또는 AI 보조)
    ↓
1건 선정 → UPDATE votes SET type='today', today_published_date=<발행일>, started_at=<발행일 08:00 KST>, closed_at=<23:59 KST>
    ↓
선정 안 된 후보는 type='today_candidate' 그대로 유지 (자동 만료 정책 별도 결정 필요 — 백로그 참고)
    ↓
선정자에게 +30P 추가 보상 (작성 5P는 등록 시 이미 지급됨)
```

### 1-2. 핵심 원칙

- **1인 1일 1건**: `register_vote` RPC가 강제 (P0002 에러 코드)
- **카테고리별 1건씩 선정**: 일상 / 게임 / 연애·관계 / 직장·학교 4개 카테고리 (오늘의 투표 카드 노출 카테고리 — `TODAY_CARD_CATEGORIES`). `etc`는 오늘의 투표 후보 대상 아님.
- **발행 시각**: 매일 KST 08:00. 마감 KST 23:59. 24시간 미만 — 가벼운 앱 톤 유지.
- **포인트 지급**: 작성 시 5P(자동) + 선정 시 +30P + 참여 50명당 +5P (캡 100P, 작성 5P 별도)
- **트랙 분리**: 일반 투표(`normal_*`)와 보상/통계 분리 — `points_log.trigger`도 prefix 분리

---

## 2. 일일 운영 절차 (수동 단계)

### 2-1. 매일 KST 06:00~07:30 — 후보 검토

#### Step 1. 어제 등록된 후보 조회

```sql
-- 어제(KST 기준) 등록된 today_candidate 전수 조회
-- 카테고리 / 작성자 / 질문 / 옵션 / AI 점수 / 추천수 / 작성자 활동성 함께 표시
select
  v.id,
  v.category,
  v.question,
  v.author_id,
  v.ai_score,
  (
    select count(*) from public.today_candidate_recommendations r
    where r.vote_id = v.id
  ) as recommend_count,
  (
    select count(*) from public.votes v2
    where v2.author_id = v.author_id and v2.created_at < v.created_at
  ) as author_register_count,
  (
    select count(*) from public.vote_casts c
    where c.user_id = v.author_id
  ) as author_cast_count,
  array(
    select option_text from public.vote_options o
    where o.vote_id = v.id order by o.display_order
  ) as options
from public.votes v
where v.type = 'today_candidate'
  and v.created_at >= (current_date - interval '1 day') at time zone 'Asia/Seoul'
  and v.created_at <  current_date at time zone 'Asia/Seoul'
order by v.category, v.ai_score desc nulls last;
```

> 운영 초기에는 위 쿼리를 Supabase SQL Editor에서 직접 실행해 결과를 검토. 자동화되면 운영자 대시보드 화면으로 이동(§자동화 섹션).

#### Step 2. AI 점수 보조 산정 (초기엔 수동 Claude 호출)

기획서 §5 점수 산정 기준에 따라 **카테고리별 후보 5~10개를 Claude에 일괄 평가**:

```
프롬프트 템플릿 (예시):

다음은 "Verdict" 앱의 오늘의 투표 후보 질문 목록입니다.
각 질문에 대해 0~10점으로 흥미도를 평가하고, 부적절하거나 중복된 질문을 표시해주세요.

평가 기준:
- 정답이 없는 질문인가 (대중의 의견이 갈리는가)
- 일상 공감 요소가 있는가
- 혐오/비하/정치적 편향이 없는가
- 최근 30일 내 유사 질문 중복 여부

[질문 목록]
1. (id) 카테고리: ... 질문: ...
2. ...

각 질문 응답 형식:
- id, score: 7.5, 통과/반려, 사유: ...
```

#### Step 3. 카테고리별 1건 선정

검토 기준 (기획서 §5 점수 산정 기준 가중치 적용):

| 항목 | 가중치 | 기준 |
|---|---|---|
| Claude 흥미도 | 40% | 위 Step 2 점수 |
| 커뮤니티 추천수 | 25% | `today_candidate_recommendations` 카운트 |
| 작성자 활동 점수 | 20% | 본인 등록/참여 이력 (위 SQL의 `author_*_count`) |
| 계정 신뢰도 | 10% | 가입 후 7일 이상 / `report_received_count = 0` |
| 카테고리 다양성 | 5% | 전날과 같은 작성자의 동일 카테고리 선정 시 감점 |

**선정 안 된 후보**:
- `type='today_candidate'` 상태 유지
- 자동 만료 정책 미정 — 백로그 §B-2 참고
- 작성자 화면에서는 "후보 신청 — 미선정" 노출 (마이페이지 구현 시 처리)

### 2-2. 매일 KST 07:30~08:00 — 승격 RPC 호출

선정된 후보 ID 4건(카테고리당 1건)을 확보한 후 `promote_today_candidates` RPC 1회 호출로 승격 + 보상 적립을 한 번에 처리.

#### 사전 조건

- 호출하는 운영자 계정이 `users.is_admin = true`로 설정되어 있어야 함:
  ```sql
  update public.users set is_admin = true where id = '<운영자 user_id>';
  ```

#### RPC 호출

Supabase SQL Editor에서:

```sql
select * from public.promote_today_candidates(
  p_selections := jsonb_build_object(
    'daily',        '<daily_vote_id>'::uuid,
    'game',         '<game_vote_id>'::uuid,
    'relationship', '<love_vote_id>'::uuid,
    'work',         '<work_vote_id>'::uuid
  ),
  p_publish_date := current_date
);
```

> 카테고리 키는 DB 표기를 따라 `relationship`(연애·관계), `daily`/`game`/`work` — UI의 `love`와 다름 주의.

**RPC 동작:**
1. `auth.uid()` → `users.is_admin` 검증 (실패 시 P0008)
2. 각 카테고리 entry에 대해:
   - `votes.type='today'` + `today_published_date=p_publish_date` + `started_at=발행일 00:00 KST` + `duration_minutes=1440`
   - 마감은 BEFORE 트리거가 `started_at + 1440분` = 다음날 00:00 KST로 자동 계산
   - `today_selection` 보상 30P를 `points_log`에 적립 (idempotency_key로 중복 방지)
3. 결과 테이블 `(vote_id, category, status='promoted')` 반환

**duration 제약**: 마이그레이션 `20260430000011`에서 `(10,30,60,360,1440)` enum → `1~1440 between` 범위 검사로 완화됨. 운영자가 임의 분 단위로 발행 가능 (예: 16시간 발행하려면 `duration_minutes=960`로 직접 UPDATE).

#### 1건만 수동 승격하는 경우

특정 카테고리만 승격하거나 특수 케이스(긴급 교체 등)는 직접 UPDATE:

```sql
update public.votes
set type = 'today',
    today_published_date = current_date,
    started_at = date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul',
    duration_minutes = 1440,
    status = 'active'
where id = '<vote_id>'
  and type = 'today_candidate';

-- 보상 적립 (idempotency_key 충돌하면 무시됨)
insert into public.points_log (user_id, trigger, amount, idempotency_key, related_vote_id)
select author_id, 'today_selection', 30,
       'today_selection:' || author_id::text || ':' || id::text,
       id
from public.votes
where id = '<vote_id>'
on conflict (idempotency_key) do nothing;
```

### 2-3. 선정 보상 지급

§2-2 `promote_today_candidates` RPC 호출 시 자동으로 `today_selection` 30P가 적립됨. 별도 SQL 불필요.

> 참여 50명당 +5P (캡 100P)는 마감 후 별도 워커에서 처리 — 출시 전 후속 마이그레이션 추가 필요.

---

## 3. 승격 SQL 체크리스트

매일 실행 전:

- [ ] 카테고리별 1건씩 픽했는가 (4건)
- [ ] 픽한 vote_id의 `type` 이 `today_candidate`인가
- [ ] 픽한 vote의 작성자가 `register_blocked_until` 정지 상태가 아닌가
- [ ] 같은 작성자가 전날 선정자와 동일하지 않은가 (다양성)
- [ ] `idempotency_key` 충돌이 없는가 (이미 적립한 vote인지)

매일 실행 후:

- [ ] `select * from votes where type='today' and today_published_date = current_date;` — 4건 노출
- [ ] 홈피드 카테고리 탭에서 오늘의 투표 카드 4종 모두 정상 렌더
- [ ] `points_log` 신규 row 4건 (`trigger='today_selection'`)

---

## 4. 자동화 로드맵

### 4-1. v1.1 — AI 점수 자동 계산 (Edge Function)

**`supabase/functions/today-candidate-score/index.ts`** (신규)

- 매일 KST 06:00 `pg_cron`에서 호출 또는 운영자 트리거
- 어제 등록된 `today_candidate` 일괄 조회
- Claude API에 카테고리별 후보 묶음 전송
- 응답 점수를 `votes.ai_score`에 UPDATE

```sql
-- 호출 후 결과
select id, question, ai_score, category from public.votes
where type = 'today_candidate'
  and created_at >= (current_date - interval '1 day') at time zone 'Asia/Seoul'
order by category, ai_score desc nulls last;
```

운영자는 이 결과를 보고 카테고리별 1건씩 픽 → §2-2 승격 SQL 실행.

### 4-2. v1.2 — 운영자 대시보드 + 1-클릭 승격

**별도 관리 화면 (`/admin/today-candidates`)**:

- 어제 후보 카드 그리드 노출 (카테고리별 정렬)
- AI 점수 / 추천수 / 작성자 통계 한눈에
- 카테고리별 라디오 선택 + "오늘의 투표로 승격" 버튼 1개
- 버튼 클릭 → `promote_today_candidates(p_vote_ids)` RPC 호출
  - service_role 또는 별도 admin 권한 컬럼 검증
  - §2-2 + §2-3 SQL을 한 트랜잭션에 처리
- 결과 토스트 + 승격된 카드 즉시 비활성화

**필요 마이그레이션**:
- `users.is_admin boolean` 또는 별도 admin 테이블
- `promote_today_candidates(uuid[])` RPC (security definer, admin 검증)
- 운영자 대시보드 Edge Function 또는 라우트 가드

### 4-3. v1.3 — 완전 자동 (옵션)

- AI 점수 + 추천수 가중 합산으로 카테고리별 자동 선정
- 운영자는 결과 알림만 받고 이상 케이스에만 개입
- 카테고리 다양성 / 이상 패턴 탐지 룰 추가

---

## 5. 백업 / 롤백

### 잘못 승격된 경우 (잘못된 후보를 today로 올림)

```sql
-- 즉시 되돌리기 (오늘의 투표 카드에서 사라짐)
update public.votes
set type = 'today_candidate',
    today_published_date = null,
    status = 'active'
where id = :wrong_vote_id;

-- 잘못 적립된 today_selection 포인트 정정
delete from public.points_log
where idempotency_key = 'today_selection:' || (
  select author_id from public.votes where id = :wrong_vote_id
)::text || ':' || :wrong_vote_id::text
  and status = 'pending';
-- status='completed'로 이미 토스에 지급된 경우는 절대 DELETE 금지 — 별도 보정 절차 필요
```

### 발행 누락 (그날 승격 SQL을 못 돌린 경우)

- 늦게라도 같은 SQL 실행 — `today_published_date = current_date`로 두면 그날치로 처리
- 마감 시각은 발행~다음날 00:00이 아닌 24시간 카운트 유지 (`duration_minutes=1440`)

---

## 6. 주요 SQL 레퍼런스

```sql
-- 오늘 발행된 today 투표 4건 조회
select id, category, question, started_at, closed_at, participants_count
from public.votes
where type = 'today' and today_published_date = current_date
order by category;

-- 어제 후보 중 미선정 그룹 (운영 회고용)
select category, count(*) as candidate_count
from public.votes
where type = 'today_candidate'
  and created_at >= (current_date - interval '1 day') at time zone 'Asia/Seoul'
  and created_at <  current_date at time zone 'Asia/Seoul'
group by category;

-- 최근 7일 today 발행 이력 (다양성 검토)
select today_published_date, category, author_id, question
from public.votes
where type = 'today'
  and today_published_date >= current_date - interval '7 days'
order by today_published_date desc, category;

-- 특정 작성자의 today 선정 이력 (반복 선정 모니터)
select today_published_date, category, question
from public.votes
where type = 'today' and author_id = :user_id
order by today_published_date desc;
```

---

*문서 버전: v1.0 | 최종 수정: 2026-04-30 | 기반: pickit_plan.md v1.6*
