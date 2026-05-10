-- admin_create rate limit 외부화 (admin_settings 로)
--
-- 배경:
--   _admin_check_and_bump_create_rl 가 분당 5건 / 일일 100건 cap 을 하드코딩.
--   베타 단계에서 admin 이 GPT 로 시드 컨텐츠를 자동 생성/투입하려는데 분당 5건이
--   너무 빡빡함. 동시에 GPT 호출 비용 폭주는 막아야 하므로, cap 자체는 유지하되
--   admin_settings 로 외부화해서 SPA 에서 조정 가능하게 함.
--
-- 동작:
--   cap=0 또는 null → 해당 cap 비활성 (무제한)
--   cap>0 → 기존 동작 (초과 시 P0011)
--
-- 카운터(admin_create_rate_limit 테이블)는 그대로 누적 — SystemStatusPage 의
-- OpenAI 호출 추정 카운트로 사용됨.

-- ============================================================================
-- 1. admin_settings 에 cap 키 추가
-- ============================================================================

insert into public.admin_settings
  (key, value, category, value_type, description, min_value, max_value, risk_level)
values
  ('admin_create_per_minute_cap', to_jsonb(0),  'system', 'int',
   'admin 컨텐츠 생성 분당 cap (0=무제한). 베타 시드 자동화 중에는 0 권장, 출시 후 5 권장',
   0, 1000, 'medium'),
  ('admin_create_daily_cap',      to_jsonb(0),  'system', 'int',
   'admin 컨텐츠 생성 일일 cap (0=무제한). GPT 호출 비용 가드',
   0, 100000, 'medium')
on conflict (key) do nothing;

-- ============================================================================
-- 2. _admin_check_and_bump_create_rl 재정의 — admin_settings lookup
-- ============================================================================

create or replace function public._admin_check_and_bump_create_rl(p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz;
  v_minute_count int;
  v_day_count int;
  v_per_minute_cap int;
  v_daily_cap int;
begin
  -- cap 값 lookup (없으면 fallback: 분당 5, 일일 100 — 기존 하드코딩 default 보존)
  select coalesce((value #>> '{}')::int, 5) into v_per_minute_cap
  from public.admin_settings where key = 'admin_create_per_minute_cap';
  if v_per_minute_cap is null then v_per_minute_cap := 5; end if;

  select coalesce((value #>> '{}')::int, 100) into v_daily_cap
  from public.admin_settings where key = 'admin_create_daily_cap';
  if v_daily_cap is null then v_daily_cap := 100; end if;

  v_bucket := date_trunc('minute', now());

  -- 카운터는 항상 누적 (SystemStatusPage 의 OpenAI 호출 추정에 사용)
  insert into public.admin_create_rate_limit (admin_id, bucket_minute, count)
  values (p_admin_id, v_bucket, 1)
  on conflict (admin_id, bucket_minute)
    do update set count = public.admin_create_rate_limit.count + 1
  returning count into v_minute_count;

  -- 분당 cap (0 또는 음수면 비활성)
  if v_per_minute_cap > 0 and v_minute_count > v_per_minute_cap then
    raise exception 'admin create rate limit (per-minute %) exceeded', v_per_minute_cap
      using errcode = 'P0011';
  end if;

  -- 일일 cap (0 또는 음수면 비활성)
  if v_daily_cap > 0 then
    select coalesce(sum(count), 0) into v_day_count
    from public.admin_create_rate_limit
    where admin_id = p_admin_id
      and bucket_minute >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

    if v_day_count > v_daily_cap then
      raise exception 'admin create rate limit (daily %) exceeded', v_daily_cap
        using errcode = 'P0011';
    end if;
  end if;
end;
$$;
