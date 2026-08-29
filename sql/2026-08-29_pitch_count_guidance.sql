-- Pitch Count Tracking & Rest-Day Guidance. Two small, shared reference
-- tables (not per-athlete) so a future MLB/USA Baseball revision is a SQL
-- Editor edit, not a redeploy - plus one per-athlete override column.
-- Guidance only: nothing here blocks logging a bullpen or game session.
-- Safe to re-run from scratch.

-- ============================================================
-- pitch_rest_guidelines: required rest days by pitches thrown in a single
-- day, two scales (ages 7-14, ages 15-18). pitch_max = null means "and
-- above" (the top, uncapped tier).
-- ============================================================
create table if not exists public.pitch_rest_guidelines (
  id bigint generated always as identity primary key,
  age_min int not null,
  age_max int not null,
  pitch_min int not null,
  pitch_max int,
  rest_days_required int not null
);

alter table public.pitch_rest_guidelines enable row level security;

drop policy if exists "pitch_rest_guidelines_select" on public.pitch_rest_guidelines;
create policy "pitch_rest_guidelines_select" on public.pitch_rest_guidelines for select using (true);

do $$
begin
  if not exists (select 1 from public.pitch_rest_guidelines) then
    insert into public.pitch_rest_guidelines (age_min, age_max, pitch_min, pitch_max, rest_days_required) values
      (7, 14, 1, 20, 0),
      (7, 14, 21, 35, 1),
      (7, 14, 36, 50, 2),
      (7, 14, 51, 65, 3),
      (7, 14, 66, null, 4),
      (15, 18, 1, 30, 0),
      (15, 18, 31, 45, 1),
      (15, 18, 46, 60, 2),
      (15, 18, 61, 80, 3),
      (15, 18, 81, null, 4);
  end if;
end $$;

-- ============================================================
-- pitch_daily_max_guidelines: suggested daily pitch max by age bracket.
-- Independent of the rest-day tiers above - a pitch count exceeding this
-- ceiling still looks up rest days normally, the ceiling is just the
-- suggested top reference line.
-- ============================================================
create table if not exists public.pitch_daily_max_guidelines (
  id bigint generated always as identity primary key,
  age_min int not null,
  age_max int not null,
  daily_max int not null
);

alter table public.pitch_daily_max_guidelines enable row level security;

drop policy if exists "pitch_daily_max_guidelines_select" on public.pitch_daily_max_guidelines;
create policy "pitch_daily_max_guidelines_select" on public.pitch_daily_max_guidelines for select using (true);

do $$
begin
  if not exists (select 1 from public.pitch_daily_max_guidelines) then
    insert into public.pitch_daily_max_guidelines (age_min, age_max, daily_max) values
      (7, 8, 50),
      (9, 10, 75),
      (11, 12, 85),
      (13, 14, 95),
      (15, 16, 95),
      (17, 18, 105);
  end if;
end $$;

-- ============================================================
-- Per-athlete override of the daily max (nullable - null means use the
-- age-computed default). Owner-only, reuses the existing "Owners can
-- update their own athletes" UPDATE policy - no RLS change needed.
-- ============================================================
alter table public.athletes add column if not exists daily_pitch_limit_override int;
