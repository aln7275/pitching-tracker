-- Tracks, per user and per athlete, when that user last opened the Workouts
-- screen - powers a "New" badge on the athlete list for workouts assigned
-- (by anyone) since the last time this user looked.
-- Run once in the Supabase SQL Editor.

create table public.workout_views (
  user_id uuid not null references auth.users(id),
  athlete_id bigint not null references public.athletes(id),
  last_viewed_at timestamptz not null default now(),
  primary key (user_id, athlete_id)
);

alter table public.workout_views enable row level security;

create policy "workout_views_own" on public.workout_views for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
