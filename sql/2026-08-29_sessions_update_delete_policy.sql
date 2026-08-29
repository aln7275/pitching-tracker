-- sessions has had INSERT and SELECT policies but no UPDATE or DELETE
-- policy - meaning every update (finishing a game, marking a session
-- missed, editing a scheduled bullpen, deleting a scheduled session) has
-- been silently matching zero rows this whole time. Supabase returns no
-- error for an RLS-filtered update/delete unless you chain .select() after
-- it, so the app code has been proceeding as if these succeeded while the
-- database never actually changed. Mirrors the existing INSERT policy's
-- predicate exactly.

drop policy if exists "Users can update their own sessions" on public.sessions;
create policy "Users can update their own sessions" on public.sessions for update using (
  is_athlete_owner(athlete_id) or has_athlete_access(athlete_id, true)
) with check (
  is_athlete_owner(athlete_id) or has_athlete_access(athlete_id, true)
);

drop policy if exists "Users can delete their own sessions" on public.sessions;
create policy "Users can delete their own sessions" on public.sessions for delete using (
  is_athlete_owner(athlete_id) or has_athlete_access(athlete_id, true)
);
