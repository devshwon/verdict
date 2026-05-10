# 테스트 데이터 리셋 가이드

> QA/베타 중 등록한 투표·포인트·광고 시청 기록을 일괄 정리하고, 다시 깨끗한 상태에서 재현 테스트할 때 사용.
> 실 SQL 스크립트: [`reset-test-data.sql`](./reset-test-data.sql)

---

## 0. 무엇이 지워지고 무엇이 남나

| 분류 | 테이블 | 동작 | 비고 |
|---|---|---|---|
| **Config — 보존** | `toss_promotions` | 그대로 | 콘솔 발급 promotion_id ↔ trigger 매핑. 1회 등록 후 거의 불변. |
| **계정 — 보존** | `auth.users`, `public.users` | row 유지, 상태 컬럼만 리셋 | 토스 재로그인 안 해도 됨. `toss_user_key` / `gender_raw` / `age_bucket_raw` / `*_public` / `is_admin` / `created_at` 보존. |
| **컨텐츠 — wipe** | `votes` | TRUNCATE CASCADE | cascade로 `vote_options` / `vote_casts` / `today_candidate_recommendations` / `vote_unlocks` / `reports` 동시 삭제. |
| **로그 — wipe** | `points_log`, `ad_watches`, `free_pass_grants` | TRUNCATE | |
| **users 상태 — 리셋** | `users` 일부 컬럼 | 0 / null | `current_streak`, `last_voted_date`, `free_pass_balance`, `register_blocked_until`, `consecutive_rejections`, `daily_rejection_count`, `daily_rejection_date`, `daily_moderation_calls`, `daily_moderation_date` |

---

## 1. 표준 리셋 (계정 유지)

가장 많이 쓰는 시나리오. 로그인 상태 그대로 유지하면서 누적 투표/포인트/광고 시청만 비웁니다.

1. Supabase Dashboard → **SQL Editor** 열기 (대상 프로젝트 확인 — staging인지 prod인지!)
2. [`docs/operations/reset-test-data.sql`](./reset-test-data.sql) 파일 전체 복사 → 붙여넣기 → **Run**
3. 결과 패널의 마지막 SELECT가 다음과 같은지 확인:
   - 데이터 테이블(`votes` ~ `free_pass_grants`) 모두 `count=0`
   - `users (보존)` / `toss_promotions (보존)`만 카운트가 남아있음
4. 앱 새로고침 → 마이페이지에서 미션 0/n, 무료이용권 0개, 등록/참여 0 인지 육안 확인

> **트랜잭션이 BEGIN/COMMIT으로 감싸져 있어요.** 중간에 에러 나면 자동 ROLLBACK → 부분 삭제로 망가지지 않음.

---

## 2. 풀 와이프 (계정까지 삭제)

토스 로그인부터 다시 검증해야 하는 경우 (예: toss-auth 재진입 흐름, gender/age_bucket 복호화 검증). 신규 가입자 지급 게이트는 default 0 (즉시) 으로 외부화됨 — admin_settings.payout_new_user_gate_hours.

1. 1번 절차 먼저 실행 (FK 정합성 위해)
2. 같은 SQL Editor에서 파일 맨 아래 다음 블록의 `/* */` 주석을 제거 → Run
   ```sql
   begin;
   delete from auth.users
   where email like 'toss_%@verdict.local';
   commit;
   ```
3. `auth.users` 삭제는 `public.users`로 cascade되므로 같이 사라짐
4. 토스 인앱에서 앱 다시 진입 → `toss-auth` Edge Function이 같은 `toss_user_key`로 새 row 자동 생성
5. **주의**: `email like 'toss_%@verdict.local'` 필터로 토스 합성 계정만 골라냄. 운영자가 직접 만든 admin 계정은 보호됨. 만약 다른 도메인의 합성 계정을 쓰고 있다면 필터 수정 필요.

---

## 3. 부분 리셋 — 자주 쓰는 변형

전체 wipe까지 안 가고 특정 시나리오만 다시 돌리고 싶을 때 자주 쓰는 SQL 조각. SQL Editor에서 직접 실행.

### 3-A. 내 등록 카운터만 0으로 (3건째+ 광고 게이트 재현)
```sql
delete from public.votes where author_id = auth.uid() and type = 'normal';
-- vote_casts/options 등은 cascade
```

### 3-B. 미수령 포인트만 비우기 (수령 UX 재현)
```sql
delete from public.points_log
where user_id = auth.uid()
  and status = 'pending'
  and claimed_at is null;
```

### 3-C. 출석 스트릭 리셋 (스트릭 보너스 재현)
```sql
update public.users
set current_streak = 0, last_voted_date = null
where id = auth.uid();
```

### 3-D. 일일 반려 카운터 리셋 (반려 캡 P0008 풀기)
```sql
update public.users
set consecutive_rejections = 0,
    daily_rejection_count = 0,
    daily_rejection_date = null,
    register_blocked_until = null
where id = auth.uid();
```

### 3-E. 광고 일일 캡 리셋 (`register_ad_watch` 50/일 풀기)
```sql
delete from public.ad_watches
where user_id = auth.uid()
  and watched_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
```

> 위 조각들은 **본인 row만** 건드리도록 `auth.uid()` 필터를 답니다. SQL Editor 기본 role이 service_role이면 `auth.uid()`가 null이라 동작 안 함 → 본인 user_id를 직접 박아 넣거나 (`select id from public.users where toss_user_key = '...'`로 찾기), 정 귀찮으면 1번 표준 리셋이 더 빠릅니다.

---

## 4. 안전 가드 — 운영 사고 방지

- 이 스크립트는 **마이그레이션이 아님**. 일부러 RPC 함수로 만들지 않음 — 운영 DB에 `reset_test_data()`가 있으면 service_role 키 유출 시 즉시 사고. 항상 SQL Editor에서 사람이 직접 실행하는 게이트 1단계 추가.
- 실행 전 **반드시 프로젝트 슬러그 확인** (URL `https://<slug>.supabase.co/...`). staging/prod 헷갈리지 않게.
- prod에 절대 실행 금지. 베타 wipe가 필요한 경우라도 `select count(*) from votes;`로 운영 데이터가 있는지 먼저 확인.
- truncate 전 데이터 보관이 필요하면 `pg_dump -t public.votes -t public.points_log ... > backup.sql` 권장.

---

## 5. 관련 문서

- [`reset-test-data.sql`](./reset-test-data.sql) — 실행 SQL 스크립트
- [`deployment-checklist.md`](./deployment-checklist.md) — Edge Function 배포 / secret 설정
- [`ad-smoke-test.md`](./ad-smoke-test.md) — 광고 시나리오 검증 (리셋 후 가장 자주 같이 도는 시나리오)
