-- ============================================================================
-- unlock_vote_results: 무료이용권으로도 언락 가능하도록 시그니처 확장
--
-- 변경 사항:
-- - 기존: unlock_vote_results(p_vote_id uuid, p_ad_token text)
-- - 신규: unlock_vote_results(p_vote_id uuid, p_ad_token text, p_use_free_pass boolean)
--
-- 동작:
-- - p_use_free_pass = true → users.free_pass_balance 1 차감 후 vote_unlocks 멱등 insert
-- - p_use_free_pass = false (default) → 기존 ad_token 검증 경로
-- - 무료이용권 잔량 0인 상태에서 p_use_free_pass=true면 'free_pass_unavailable' 예외
-- ============================================================================

drop function if exists public.unlock_vote_results(uuid, text);

create or replace function public.unlock_vote_results(
  p_vote_id uuid,
  p_ad_token text default null,
  p_use_free_pass boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_status vote_status;
  v_closed_at timestamptz;
  v_pass_remaining int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  if coalesce(p_use_free_pass, false) then
    -- 무료이용권 1개 차감 (잔량 0이면 예외)
    update public.users
    set free_pass_balance = free_pass_balance - 1
    where id = v_uid
      and free_pass_balance > 0
    returning free_pass_balance into v_pass_remaining;

    if v_pass_remaining is null then
      raise exception 'free pass not available' using errcode = 'P0006';
    end if;
  else
    if not public.fn_consume_ad_token(v_uid, p_ad_token, 'unlock_vote_result') then
      raise exception 'ad token invalid or expired' using errcode = 'P0007';
    end if;
  end if;

  select status, closed_at
    into v_status, v_closed_at
  from public.votes
  where id = p_vote_id;

  if not found then
    raise exception 'vote not found: %', p_vote_id using errcode = '23503';
  end if;

  if v_status = 'active' and v_closed_at > now() then
    raise exception 'vote is still active' using errcode = 'P0001';
  end if;

  insert into public.vote_unlocks (vote_id, user_id)
  values (p_vote_id, v_uid)
  on conflict (vote_id, user_id) do nothing;
end;
$$;

grant execute on function public.unlock_vote_results(uuid, text, boolean) to authenticated;
