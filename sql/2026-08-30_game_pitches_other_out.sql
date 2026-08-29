-- Adds 'other_out' as a valid game_pitches outcome: an out that isn't part
-- of the current batter's plate appearance (a runner caught stealing,
-- picked off, or thrown out from an earlier at-bat) - counts toward the
-- inning's outs without closing anyone's at-bat sequence. Safe to re-run.

do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.game_pitches'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%outcome%';
  if con_name is not null then
    execute format('alter table public.game_pitches drop constraint %I', con_name);
  end if;
end $$;

alter table public.game_pitches add constraint game_pitches_outcome_check
  check (outcome in ('ball', 'strike', 'foul', 'hbp', 'hit', 'out', 'other_out'));
