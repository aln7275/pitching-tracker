-- Scheduled bullpen/game sessions: lets a bullpen or game be put on the
-- calendar ahead of time (status 'scheduled'), same lifecycle shape workouts
-- already have. Adds 'missed' as a resolvable end state for both, matching
-- workouts' missed_reason pattern. Safe to re-run from scratch.

-- ============================================================
-- sessions.status: the table predates this repo's SQL-migration convention,
-- so its existing CHECK constraint (if any) isn't visible in version control.
-- Find it dynamically by definition (not by a guessed name) and replace it
-- with one covering every status value now in use across bullpen and games:
-- 'scheduled' (not started), 'in_progress' (game only, mid-tracking),
-- 'submitted' (completed), 'missed' (resolved, no data).
-- ============================================================
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.sessions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';
  if con_name is not null then
    execute format('alter table public.sessions drop constraint %I', con_name);
  end if;
end $$;

alter table public.sessions add constraint sessions_status_check
  check (status in ('scheduled', 'in_progress', 'submitted', 'missed'));

-- ============================================================
-- New columns: missed_reason (both types, mirrors workouts.missed_reason),
-- target_pitches (bullpen scheduling only), session_time (game scheduling
-- only - session_date stays date-only, time is optional and games-specific).
-- ============================================================
alter table public.sessions add column if not exists missed_reason text;
alter table public.sessions add column if not exists target_pitches int;
alter table public.sessions add column if not exists session_time text;
