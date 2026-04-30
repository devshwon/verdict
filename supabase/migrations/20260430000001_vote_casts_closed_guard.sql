-- vote_casts INSERT 가드: 마감된/비활성 투표에는 cast 불가
-- 기획서 §4-2: 마감된 투표는 재투표 불가
-- 기존 unique(vote_id, user_id) 제약만으로는 마감 후 신규 cast를 막지 못함.

create or replace function public.fn_guard_vote_cast()
returns trigger
language plpgsql
as $$
declare
  v_status vote_status;
  v_closed_at timestamptz;
begin
  select status, closed_at
    into v_status, v_closed_at
  from public.votes
  where id = new.vote_id;

  if v_status is null then
    raise exception 'vote not found: %', new.vote_id
      using errcode = '23503';
  end if;

  if v_status <> 'active' then
    raise exception 'vote is not active (status: %)', v_status
      using errcode = 'P0001';
  end if;

  if v_closed_at <= now() then
    raise exception 'vote has already closed at %', v_closed_at
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_vote_casts_guard
before insert on public.vote_casts
for each row execute function public.fn_guard_vote_cast();
