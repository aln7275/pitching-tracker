-- Remove Athlete (unified action), Archive, and Request Transfer.
-- Safe to re-run from scratch: every step is guarded.

-- ============================================================
-- transfer_ownership: a new 3-arg overload alongside the existing 2-arg
-- function (left untouched - its exact live signature/security wrapper
-- aren't in version control, so overloading is safer than trying to
-- blindly replace it). Existing 2-arg call sites keep hitting the original
-- function unchanged. p_remove_departing_owner=true skips granting the
-- departing owner continuing access (used by "Transfer and Remove");
-- default false reproduces the original function's behavior exactly.
-- ============================================================
create or replace function public.transfer_ownership(
  p_athlete_id bigint,
  p_new_owner_user_id uuid,
  p_remove_departing_owner boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_current_owner uuid;
  v_current_owner_email text;
  v_grant_exists boolean;
  v_existing_row_id bigint;
begin
  select user_id into v_current_owner
  from athletes
  where id = p_athlete_id;

  if v_current_owner is null then
    raise exception 'Athlete not found';
  end if;

  if v_current_owner <> auth.uid() then
    raise exception 'Only the current owner can transfer ownership';
  end if;

  select exists (
    select 1 from athlete_access
    where athlete_id = p_athlete_id
      and granted_to_user_id = p_new_owner_user_id
      and status = 'active'
  ) into v_grant_exists;

  if not v_grant_exists then
    raise exception 'New owner must already have accepted access to this athlete';
  end if;

  select email into v_current_owner_email from auth.users where id = v_current_owner;

  -- Do the actual ownership change
  update athletes
  set user_id = p_new_owner_user_id
  where id = p_athlete_id;

  -- Soft-delete (deactivate) the new owner's old grant row, instead of erasing it,
  -- so their name/relationship is preserved if they're ever demoted again later
  update athlete_access
  set status = 'inactive'
  where athlete_id = p_athlete_id
    and granted_to_user_id = p_new_owner_user_id
    and status = 'active';

  if p_remove_departing_owner then
    -- Transfer and Remove: the departing owner keeps no access going forward.
    -- Owners don't normally hold an athlete_access row of their own, but
    -- defensively deactivate one if it somehow exists - never a hard delete,
    -- to stay consistent with the rest of this function.
    update athlete_access
    set status = 'inactive'
    where athlete_id = p_athlete_id
      and granted_to_user_id = v_current_owner
      and status = 'active';
  else
    -- Check if the departing owner has a past (inactive) row we can reactivate,
    -- so their name/relationship comes back if they've held access before
    select id into v_existing_row_id
    from athlete_access
    where athlete_id = p_athlete_id
      and granted_to_user_id = v_current_owner
      and status = 'inactive'
    order by id desc
    limit 1;

    if v_existing_row_id is not null then
      update athlete_access
      set status = 'active', access_level = 'full'
      where id = v_existing_row_id;
    else
      insert into athlete_access (athlete_id, invited_email, granted_to_user_id, access_level, status)
      values (p_athlete_id, v_current_owner_email, v_current_owner, 'full', 'active');
    end if;
  end if;
end;
$function$;

-- ============================================================
-- Remove Athlete (non-owner): today the only DELETE policy on
-- athlete_access requires being the athlete's owner, and the only UPDATE
-- policy is narrowly scoped to claiming a pending invite - there is no way
-- for a grantee to remove their own access. This adds that, as a soft
-- delete (active -> inactive), consistent with how transfer_ownership
-- already treats access rows. Additive only - doesn't touch the three
-- existing athlete_access policies.
-- ============================================================
drop policy if exists "Grantee can deactivate own access" on public.athlete_access;
create policy "Grantee can deactivate own access" on public.athlete_access
for update using (
  granted_to_user_id = auth.uid() and status = 'active'
) with check (
  granted_to_user_id = auth.uid() and status = 'inactive'
);

-- ============================================================
-- Archive: reuses the existing owner-only UPDATE policy on athletes
-- ("Owners can update their own athletes") - no RLS change needed.
-- ============================================================
alter table public.athletes add column if not exists archived boolean not null default false;

-- ============================================================
-- Request Transfer: anyone with active access (view or full) can ask the
-- current owner to transfer ownership to them. Approval/decline happens on
-- the existing Manage Access screen (app/athlete-access.tsx), same
-- mechanics as the owner-initiated transfer flow above - this table is
-- just the request/notification record, not a new transfer mechanism.
-- ============================================================
create table if not exists public.transfer_requests (
  id bigint generated by default as identity primary key,
  athlete_id bigint not null references public.athletes(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.transfer_requests enable row level security;

-- A requester can't spam multiple pending requests for the same athlete.
drop index if exists transfer_requests_one_pending_idx;
create unique index transfer_requests_one_pending_idx on public.transfer_requests (athlete_id, requested_by) where status = 'pending';

drop policy if exists "transfer_requests_select" on public.transfer_requests;
create policy "transfer_requests_select" on public.transfer_requests for select using (
  requested_by = auth.uid()
  or exists (select 1 from public.athletes where id = transfer_requests.athlete_id and user_id = auth.uid())
);

drop policy if exists "transfer_requests_insert" on public.transfer_requests;
create policy "transfer_requests_insert" on public.transfer_requests for insert with check (
  requested_by = auth.uid()
  and exists (
    select 1 from public.athlete_access
    where athlete_id = transfer_requests.athlete_id
      and granted_to_user_id = auth.uid()
      and status = 'active'
  )
);

drop policy if exists "transfer_requests_update" on public.transfer_requests;
create policy "transfer_requests_update" on public.transfer_requests for update using (
  exists (select 1 from public.athletes where id = transfer_requests.athlete_id and user_id = auth.uid())
) with check (
  exists (select 1 from public.athletes where id = transfer_requests.athlete_id and user_id = auth.uid())
);
