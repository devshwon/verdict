-- promote_today_candidates 의 category / status 컬럼 ambiguity 해결
--
-- 버그:
--   `returns table (vote_id uuid, category text, status text)` 로 OUT 파라미터를
--   선언했는데, 본문의 update 문 where 절에 `category = rec_key`,
--   `status in ('active','pending_review')` 가 bare 참조로 들어가 있어
--   PL/pgSQL 변수인지 votes 테이블 컬럼인지 모호.
--   PostgreSQL: ERROR 42702 column reference "category" is ambiguous.
--   (오늘 후보 → 1건 발행 흐름에서 재현)
--
-- 수정:
--   update 문에서 `votes.category = rec_key`, `votes.status in (...)` 로
--   fully-qualified. 본문 외 부분은 20260504000008_hybrid_claim_system.sql 와 동일.
--   OUT 파라미터 이름은 admin client 가 구조분해해서 쓸 수 있으므로 유지.

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

  v_publish_ts := (p_publish_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Seoul';

  for rec_key in select * from jsonb_object_keys(p_selections)
  loop
    rec_vote_id := (p_selections->>rec_key)::uuid;

    if rec_key not in ('daily', 'relationship', 'work', 'game') then
      raise exception 'invalid category for today vote: %', rec_key
        using errcode = '23514';
    end if;

    update public.votes
    set type = 'today',
        today_published_date = p_publish_date,
        started_at = v_publish_ts,
        duration_minutes = 1440,
        status = 'active',
        rejection_reason = null
    where votes.id = rec_vote_id
      and votes.type = 'today_candidate'
      and votes.category = rec_key
      and votes.status in ('active', 'pending_review')
    returning author_id into v_author_id;

    if not found then
      raise exception 'vote not found or not eligible: % (category=%)',
        rec_vote_id, rec_key
        using errcode = '23503';
    end if;

    insert into public.points_log (
      user_id, trigger, amount, idempotency_key, related_vote_id, status
    )
    values (
      v_author_id, 'today_selection', 20,
      'today_selection:' || v_author_id::text || ':' || rec_vote_id::text,
      rec_vote_id, 'unclaimed'
    )
    on conflict (idempotency_key) do nothing;

    return query
      select rec_vote_id, rec_key, 'promoted'::text;
  end loop;
end;
$$;

grant execute on function public.promote_today_candidates(jsonb, date) to authenticated;
