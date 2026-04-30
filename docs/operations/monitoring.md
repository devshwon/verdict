# 운영 모니터링 가이드

> Supabase 백엔드의 자동화 잡 / 큐 / 한도 / 어뷰징 모니터링 SQL 모음.
> Supabase Dashboard → SQL Editor에서 직접 실행. 정기적 검토(주 1회 권장) 또는 알람 트리거 기준.

---

## 1. pg_cron 잡 모니터링 (백로그 §S4)

### 1-1. 등록된 잡 목록

```sql
select jobid, jobname, schedule, command, active
from cron.job
order by jobname;
```

**기대 잡 7종:**

| jobname | schedule | 용도 | 마이그레이션 |
|---|---|---|---|
| cleanup-normal-votes-30d | `0 4 * * *` | 일반 투표 30일 후 삭제 (§12-1) | `20260430000003` |
| cleanup-today-votes-180d | `10 4 * * *` | 오늘의 투표 180일 후 삭제 (§12-2) | `20260430000003` |
| cleanup-today-candidates-7d | `15 4 * * *` | today_candidate 미선정 7일 후 삭제 (§S5) | `20260430000011` |
| moderate-vote-fallback | `*/5 * * * *` | 검열 누락 vote 자동 재시도 (§S1-FALLBACK) | `20260430000011` |
| payout-points-worker | `*/5 * * * *` | 토스 포인트 지급 워커 (§S3) | `20260430000010` (수동 등록) |

### 1-2. 최근 실행 이력

```sql
select jobname, status, return_message, start_time, end_time,
       end_time - start_time as duration
from cron.job_run_details
where start_time > now() - interval '24 hours'
order by start_time desc
limit 100;
```

### 1-3. 실패한 잡만

```sql
select jobname, return_message, start_time
from cron.job_run_details
where status <> 'succeeded'
  and start_time > now() - interval '7 days'
order by start_time desc;
```

### 1-4. 잡별 평균 실행 시간 (성능 추이)

```sql
select jobname,
       count(*) as runs_7d,
       avg(end_time - start_time) as avg_duration,
       max(end_time - start_time) as max_duration
from cron.job_run_details
where start_time > now() - interval '7 days'
group by jobname
order by avg_duration desc;
```

---

## 2. 자동 삭제 검증

### 2-1. 마감 후 보관 기간 초과한 일반 투표 (있으면 cron 실패)

```sql
select count(*) as overdue_normal_votes
from public.votes
where type = 'normal'
  and closed_at < now() - interval '30 days';
-- 0이어야 정상. >0면 cleanup-normal-votes-30d 잡이 죽었거나 권한 문제
```

### 2-2. 마감 후 보관 기간 초과한 오늘의 투표

```sql
select count(*) as overdue_today_votes
from public.votes
where type = 'today'
  and closed_at < now() - interval '180 days';
```

### 2-3. 만료 기한 초과한 today_candidate (S5)

```sql
select count(*) as overdue_candidates
from public.votes
where type = 'today_candidate'
  and created_at < now() - interval '7 days';
```

---

## 3. 검열 큐 (백로그 §S1)

### 3-1. 검열 대기 중인 vote (5분 이상이면 fallback 작동 여부 확인)

```sql
select count(*) as pending_count,
       count(*) filter (where created_at < now() - interval '5 minutes') as needs_fallback,
       count(*) filter (where created_at < now() - interval '1 hour') as stuck_long
from public.votes
where status = 'pending_review';
-- needs_fallback이 0에 가까워야 정상
-- stuck_long이 >0이면 moderate-vote EF 또는 OPENAI_API_KEY / GUC 문제
```

### 3-2. 최근 24시간 검열 결과 분포

```sql
select status, count(*) as cnt,
       round(avg(ai_score)::numeric, 2) as avg_score
from public.votes
where created_at > now() - interval '24 hours'
  and status in ('active', 'blinded', 'pending_review')
group by status;
```

### 3-3. 반려 사유 빈도 (운영 인사이트)

```sql
select rejection_reason, count(*) as cnt
from public.votes
where status = 'blinded'
  and rejection_reason is not null
  and created_at > now() - interval '30 days'
group by rejection_reason
order by cnt desc
limit 20;
```

---

## 4. 광고 시청 모니터링 (백로그 §S2)

### 4-1. 일일 광고 시청 현황 (KST 자정 기준)

```sql
with kst_today as (
  select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as t
)
select ad_unit,
       count(*) as watches,
       count(*) filter (where consumed) as consumed,
       count(distinct user_id) as unique_users
from public.ad_watches, kst_today
where watched_at >= kst_today.t
group by ad_unit
order by watches desc;
```

### 4-2. 토큰 미소비 (광고 시청만 하고 RPC 호출 안 한 케이스)

```sql
select user_id, ad_unit, count(*) as orphan_count
from public.ad_watches
where not consumed
  and watched_at < now() - interval '5 minutes'
group by user_id, ad_unit
order by orphan_count desc
limit 20;
-- 사용자별 다수 발생 시 어뷰저 의심 또는 클라이언트 버그
```

### 4-3. 일일 캡 도달 사용자 (어뷰저 후보)

```sql
with kst_today as (
  select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as t
)
select user_id, count(*) as total_today
from public.ad_watches, kst_today
where watched_at >= kst_today.t
group by user_id
having count(*) >= 50
order by total_today desc;
```

---

## 5. 포인트 지급 큐 (백로그 §S3)

### 5-1. 큐 상태 분포

```sql
select status, count(*) as cnt, sum(amount) as total_p
from public.points_log
group by status
order by status;
-- pending이 많으면 worker 작동 점검
-- blocked / failed가 누적되면 운영자 수동 처리 필요
```

### 5-2. 오래된 pending (worker 멈춤 의심)

```sql
select trigger, count(*) as stuck, min(created_at) as oldest
from public.points_log
where status = 'pending'
  and created_at < now() - interval '30 minutes'
group by trigger
order by oldest asc;
-- 24시간 이상 pending이면 신규 가입자 24h 지연이 아닌 한 worker 문제
```

### 5-3. 일일 한도로 차단된 사용자

```sql
with kst_today as (
  select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as t
)
select user_id, count(*) as blocked_count, sum(amount) as blocked_amount
from public.points_log, kst_today
where status = 'blocked'
  and created_at >= kst_today.t
group by user_id
order by blocked_amount desc
limit 20;
```

### 5-4. 사용자별 카테고리별 일일 누적 (한도 검증용)

```sql
with kst_today as (
  select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as t
)
select pl.user_id,
       public.fn_points_category(pl.trigger) as category,
       count(*) as cnt,
       sum(amount) filter (where status = 'completed') as completed_p,
       sum(amount) filter (where status = 'pending') as pending_p,
       sum(amount) filter (where status = 'blocked') as blocked_p
from public.points_log pl, kst_today
where created_at >= kst_today.t
group by pl.user_id, public.fn_points_category(pl.trigger)
having sum(amount) filter (where status in ('completed', 'pending')) > 20  -- 한도 근접 사용자만
order by completed_p desc nulls last
limit 50;
```

### 5-5. 실패 이력 (재시도 정책 결정용)

```sql
select trigger, count(*) as failed_cnt, sum(amount) as failed_amount,
       min(created_at) as first_fail, max(created_at) as last_fail
from public.points_log
where status = 'failed'
  and created_at > now() - interval '7 days'
group by trigger
order by failed_cnt desc;
-- 재시도하려면 pending으로 복원: update points_log set status='pending' where id in (...);
```

---

## 6. 어뷰징 / 신고 모니터링

### 6-1. 신고 누적 vote (블라인드 직전)

```sql
select id, question, category, report_count, status
from public.votes
where report_count > 0
  and status not in ('blinded', 'deleted')
order by report_count desc
limit 30;
```

### 6-2. 등록 정지된 사용자

```sql
select id, register_blocked_until, report_received_count
from public.users
where register_blocked_until > now()
order by register_blocked_until desc;
```

### 6-3. 일별 신규 등록 / 참여 추이

```sql
with kst as (
  select generate_series(
    date_trunc('day', now() at time zone 'Asia/Seoul') - interval '7 days',
    date_trunc('day', now() at time zone 'Asia/Seoul'),
    '1 day'
  ) as day
)
select kst.day::date as kst_day,
       (select count(*) from public.votes
        where (created_at at time zone 'Asia/Seoul')::date = kst.day::date
          and type = 'normal') as normal_registers,
       (select count(*) from public.votes
        where (created_at at time zone 'Asia/Seoul')::date = kst.day::date
          and type = 'today_candidate') as today_candidate_registers,
       (select count(*) from public.vote_casts
        where (cast_at at time zone 'Asia/Seoul')::date = kst.day::date) as casts
from kst
order by kst.day desc;
```

---

## 7. 무료이용권 모니터링

### 7-1. 출처별 발급 현황

```sql
select source, count(*) as grants, sum(amount) as total_passes
from public.free_pass_grants
where created_at > now() - interval '30 days'
group by source
order by total_passes desc;
```

### 7-2. 잔량 상위 사용자 (어뷰징 모니터링)

```sql
select id, free_pass_balance,
       (select count(*) from public.free_pass_grants where user_id = users.id) as lifetime_grants
from public.users
where free_pass_balance >= 5
order by free_pass_balance desc
limit 30;
```

---

## 8. 알람 임계값 권장

| 항목 | 정상 | 경고 | 즉시 조치 |
|---|---|---|---|
| 5분 이상 pending_review | 0 | 5+ | 50+ → moderate-vote EF / GUC 점검 |
| 30분 이상 pending payout | 0 | 10+ | 100+ → payout-points / 토스 API 점검 |
| 일일 캡 도달 사용자 | 0 | 1+ | 5+ → 어뷰저 패턴 분석 |
| failed payout 누적 | 0 | 10+ | 50+ → 토스 비즈월렛 약관/장애 점검 |
| cron 실패 | 0 | 1+ | 즉시 jobname 확인 후 GUC/permissions 검사 |

---

*작성: 2026-04-30 | 기반: 마이그레이션 ~20260430000011, EF moderate-vote / register-ad-watch / payout-points*
