-- fn_get_pending_payouts / fn_get_pending_payouts_for_user 의 id 컬럼 ambiguity 해결
--
-- 버그:
--   `where id = rec.id` 에서 id 가 update target 의 column 인지
--   `returns table (id uuid, ...)` 의 OUT parameter 인지 모호.
--   PostgreSQL: ERROR 42702 column reference "id" is ambiguous.
--
-- 수정:
--   update 문에서 `where points_log.id = rec.id` 로 fully-qualified.
--   본문 외 부분은 20260510000009 와 동일.

-- ============================================================================
-- fn_get_pending_payouts (cron 전체 처리 모드)
-- ============================================================================

drop function if exists public.fn_get_pending_payouts(int);

create or replace function public.fn_get_pending_payouts(p_batch_size int default 100)
returns table (
  id uuid,
  user_id uuid,
  toss_user_key text,
  trigger text,
  amount int,
  promotion_id text,
  promotion_test_mode boolean,
  related_vote_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_limit_breached boolean;
  v_setting_value jsonb;
  v_gate_hours int;
  v_gate_cutoff timestamptz;
begin
  select value into v_setting_value
  from public.admin_settings where key = 'payout_new_user_gate_hours';
  v_gate_hours := coalesce((v_setting_value #>> '{}')::int, 0);
  v_gate_cutoff := now() - make_interval(hours => v_gate_hours);

  for rec in
    select pl.id, pl.user_id, pl.trigger, pl.amount
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    where pl.status = 'pending'
      and u.created_at <= v_gate_cutoff
    order by pl.created_at asc
  loop
    v_limit_breached := public.fn_check_daily_payout_limit(
      rec.user_id,
      public.fn_points_category(rec.trigger),
      rec.amount
    );
    if v_limit_breached then
      update public.points_log
      set status = 'blocked'
      where points_log.id = rec.id;
    end if;
  end loop;

  return query
    select
      pl.id,
      pl.user_id,
      u.toss_user_key,
      pl.trigger,
      pl.amount,
      tp.promotion_id,
      coalesce(tp.test_mode, true) as promotion_test_mode,
      pl.related_vote_id,
      pl.created_at
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    left join public.toss_promotions tp on tp.trigger = pl.trigger
    where pl.status = 'pending'
      and u.created_at <= v_gate_cutoff
    order by pl.created_at asc
    limit p_batch_size;
end;
$$;

revoke execute on function public.fn_get_pending_payouts(int) from public, anon, authenticated;
grant execute on function public.fn_get_pending_payouts(int) to service_role;

-- ============================================================================
-- fn_get_pending_payouts_for_user (즉시 지급 user-scoped 모드)
-- ============================================================================

create or replace function public.fn_get_pending_payouts_for_user(
  p_user_id uuid,
  p_batch_size int default 50
)
returns table (
  id uuid,
  user_id uuid,
  toss_user_key text,
  trigger text,
  amount int,
  promotion_id text,
  promotion_test_mode boolean,
  related_vote_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_limit_breached boolean;
  v_setting_value jsonb;
  v_gate_hours int;
  v_gate_cutoff timestamptz;
begin
  select value into v_setting_value
  from public.admin_settings where key = 'payout_new_user_gate_hours';
  v_gate_hours := coalesce((v_setting_value #>> '{}')::int, 0);
  v_gate_cutoff := now() - make_interval(hours => v_gate_hours);

  for rec in
    select pl.id, pl.user_id, pl.trigger, pl.amount
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    where pl.status = 'pending'
      and pl.user_id = p_user_id
      and u.created_at <= v_gate_cutoff
    order by pl.created_at asc
  loop
    v_limit_breached := public.fn_check_daily_payout_limit(
      rec.user_id,
      public.fn_points_category(rec.trigger),
      rec.amount
    );
    if v_limit_breached then
      update public.points_log
      set status = 'blocked'
      where points_log.id = rec.id;
    end if;
  end loop;

  return query
    select
      pl.id,
      pl.user_id,
      u.toss_user_key,
      pl.trigger,
      pl.amount,
      tp.promotion_id,
      coalesce(tp.test_mode, true) as promotion_test_mode,
      pl.related_vote_id,
      pl.created_at
    from public.points_log pl
    join public.users u on u.id = pl.user_id
    left join public.toss_promotions tp on tp.trigger = pl.trigger
    where pl.status = 'pending'
      and pl.user_id = p_user_id
      and u.created_at <= v_gate_cutoff
    order by pl.created_at asc
    limit p_batch_size;
end;
$$;

revoke execute on function public.fn_get_pending_payouts_for_user(uuid, int) from public, anon, authenticated;
grant execute on function public.fn_get_pending_payouts_for_user(uuid, int) to service_role;
