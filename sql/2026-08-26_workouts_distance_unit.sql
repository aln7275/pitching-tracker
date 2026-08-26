-- Adds a per-exercise distance unit so "Distance" isn't hardcoded to yards
-- (sprints/throwing are naturally yards, aerobic work is miles, jumps are feet).
-- Run once in the Supabase SQL Editor, after 2026-08-26_workouts_feature.sql.

alter table public.exercises
  add column distance_unit text not null default 'yd' check (distance_unit in ('yd', 'ft', 'mi'));

update public.exercises set distance_unit = 'mi' where category = 'Aerobic' and requires_distance;
update public.exercises set distance_unit = 'ft' where category = 'Power' and requires_distance;
-- Everything else that tracks distance (Speed, Throwing, Conditioning, Strength/Core) stays 'yd', the column default.
