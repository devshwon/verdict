-- 남은 백로그 통합 마이그레이션 (백로그 §S1-FALLBACK / §S5 / §S6 / §S7)
--
-- 포함:
--   §S6 — duration_minutes CHECK 제약 완화 (운영자 today 발행 임의 분 단위 허용)
--   §S5 — today_candidate 미선정 7일 자동 만료 cron
--   §S1-FALLBACK — 검열 누락 vote(5분 이상 pending_review) 자동 재시도 함수
--   §S7 — users.is_admin + promote_today_candidates RPC
--
-- 새 에러 코드:
--   P0008 — 운영자 권한 필요

-- ============================================================================
-- §S6. duration_minutes 제약 완화
-- ============================================================================
--
-- 기존: in (10, 30, 60, 360, 1440) — 일반 등록 5종 강제
-- 변경: 1~1440 범위만 검사 — 운영자가 today 발행 시 임의 분 단위 가능
-- 일반 사용자 등록은 register_vote RPC가 5종 검증 그대로 (백도어 없음)

alter table public.votes
  drop constraint if exists votes_duration_minutes_check;

alter table public.votes
  add constraint votes_duration_minutes_check
  check (duration_minutes between 1 and 1440);

-- ============================================================================
-- §S5. today_candidate 미선정 7일 자동 만료
-- ============================================================================

select cron.schedule(
  'cleanup-today-candidates-7d',
  '15 4 * * *',  -- 매일 04:15 UTC (= 13:15 KST)
  $$
    delete from public.votes
    where type = 'today_candidate'
      and created_at < now() - interval '7 days'
  $$
);

-- ============================================================================
-- §S1-FALLBACK. 검열 누락 자동 재시도
-- ============================================================================
--
-- 클라이언트가 register_vote 후 moderate-vote를 호출하지 않고 도주한 경우,
-- 5분마다 5분 이상 pending_review 상태인 vote에 대해 moderate-vote를 호출.
--
-- 운영자 사전 작업 (Supabase SQL Editor):
--   1) ALTER DATABASE postgres SET app.moderate_vote_url = 'https://<project>.supabase.co/functions/v1/moderate-vote';
--   2) ALTER DATABASE postgres SET app.service_role_key = '<service_role_key>';
--   3) cron.schedule는 본 마이그레이션에서 이미 등록 — 위 GUC 설정만 하면 자동 작동

create or replace function public.fn_moderate_pending_fallback()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_url text;
  v_key text;
  v_count int := 0;
begin
  v_url := current_setting('app.moderate_vote_url', true);
  v_key := current_setting('app.service_role_key', true);

  if v_url is null or v_url = '' then
    raise warning 'fn_moderate_pending_fallback: app.moderate_vote_url not configured';
    return 0;
  end if;
  if v_key is null or v_key = '' then
    raise warning 'fn_moderate_pending_fallback: app.service_role_key not configured';
    return 0;
  end if;

  for rec in
    select id from public.votes
    where status = 'pending_review'
      and created_at < now() - interval '5 minutes'
    order by created_at asc
    limit 50
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('vote_id', rec.id::text)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.fn_moderate_pending_fallback() from public, anon, authenticated;

-- 5분마다 fallback 실행 (GUC 미설정 시 warning 후 0건 처리하므로 안전)
select cron.schedule(
  'moderate-vote-fallback',
  '*/5 * * * *',
  $$select public.fn_moderate_pending_fallback()$$
);

-- ============================================================================
-- §S7. admin 권한 + promote_today_candidates RPC
-- ============================================================================

alter table public.users
  add column is_admin boolean not null default false;

create index idx_users_admin on public.users(id) where is_admin;

-- 입력: { "daily": "uuid", "game": "uuid", ... } + 발행일
-- 동작:
--   1) 호출자가 is_admin=true인지 검증
--   2) 각 카테고리 entry에 대해 today_candidate → today 승격
--   3) today_selection 보상(30P) 적립 (idempotency_key로 중복 방지)
--   4) 발행 결과 반환 (각 vote_id별)

create or replace function public.promote_today_candidates(
  p_selections jsonb,
  p_publish_date date default current_date
)
returns table (vote_id uuid, category text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  rec_key text;
  rec_vote_id uuid;
  v_publish_ts timestamptz;
  v_author_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select coalesce(is_admin, false) into v_is_admin
  from public.users where id = v_uid;
  if not v_is_admin then
    raise exception 'admin permission required' using errcode = 'P0008';
  end if;

  -- 발행일 KST 00:00 → 1440분(24h) 후 자동 마감
  v_publish_ts := (p_publish_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Seoul';

  for rec_key in select * from jsonb_object_keys(p_selections)
  loop
    rec_vote_id := (p_selections->>rec_key)::uuid;

    if rec_key not in ('daily', 'relationship', 'work', 'game') then
      raise exception 'invalid category for today vote: %', rec_key
        using errcode = '23514';
    end if;

    -- 승격 + 발행 메타 갱신 (검열 중인 후보도 운영자가 통과시킬 수 있게 status='active'로 강제)
    update public.votes
    set type = 'today',
        today_published_date = p_publish_date,
        started_at = v_publish_ts,
        duration_minutes = 1440,
        status = 'active',
        rejection_reason = null
    where id = rec_vote_id
      and type = 'today_candidate'
      and category = rec_key
      and status in ('active', 'pending_review')
    returning author_id into v_author_id;

    if not found then
      raise exception 'vote not found or not eligible: % (category=%)',
        rec_vote_id, rec_key
        using errcode = '23503';
    end if;

    -- today_selection 보상 적립 (작성 5P는 등록 시 이미 적립됨)
    insert into public.points_log (
      user_id, trigger, amount, idempotency_key, related_vote_id
    )
    values (
      v_author_id,
      'today_selection',
      30,
      'today_selection:' || v_author_id::text || ':' || rec_vote_id::text,
      rec_vote_id
    )
    on conflict (idempotency_key) do nothing;

    return query
      select rec_vote_id, rec_key, 'promoted'::text;
  end loop;
end;
$$;

grant execute on function public.promote_today_candidates(jsonb, date) to authenticated;

-- ============================================================================
-- 새 에러 코드:
--   P0008 — 운영자 권한 필요
-- ============================================================================
