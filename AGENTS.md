# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

# Pitching Tracker — Project Context

## What this is
A youth baseball/softball pitching tracker mobile app, built as a side project. Originated from a real coaching drill. Primary user is a parent (the developer) tracking his son's pitching development; a former SEC D1 coach is a potential future customer/partner.

## Tech stack
- React Native, Expo SDK 54 (managed workflow)
- Expo Router (file-based routing under `app/`)
- Supabase (PostgreSQL + RLS + auth + storage)
- GitHub: `aln7275/pitching-tracker`
- Dev distribution: Expo Go (same-network dev server), not yet a standalone build

## What's built (as of this handoff)

### Bullpen tracking (TCN system)
- Live bullpen session entry: pitches logged as T (Target — hit the spot), C (Competitive — close miss, still hittable/in-zone-ish), or N (Non-competitive — clear miss)
- Session history, notes, native share sheet for results
- Analytics on `app/athlete.tsx`: Target % Trend (line chart), T/C/N Breakdown (bar chart), date range + session type filters
- **"Simulated Batters Faced" card** — derives simulated K's/BB's from the T/C/N pitch sequence for a single-pitcher bullpen with no real batter. C is **neutral**: only T advances the simulated strike count, only N advances the ball count, C advances neither (rejected alternatives: C-as-always-strike, 50/50 random, alternating, experience-weighted — see git history on `app/athlete.tsx`'s `summarize()` for the reasoning). An all-C session shows a fallback message instead of a blank "0 batters faced". Shared logic lives in `types/bullpen.ts` (`simulateBatters`, `tcnCounts`), used by both the live entry screen and Home's read-only results card; `app/athlete.tsx`'s own `summarize()`/`shareSession()` predate that extraction and still have a near-duplicate local copy — worth consolidating if touched again.
- Can now also be **scheduled ahead of time** (see "Home screen" below) with a target pitch count + coach notes, in addition to the original "start now" flow from the athlete tab.

### Athlete profiles
- Fields: name, birthdate, throwing_hand (R/L), sport (baseball/softball), team_name (optional)
- Editable via pencil icon on `app/athlete.tsx` → modal (reuses toggle-pill pattern)
- `athletes` table has RLS: SELECT/INSERT for owner, UPDATE policy added for owner-editing (was missing initially — a real gap that had to be fixed)

### Access-sharing system
- Per-athlete access grants: view-only or full access, email-based invites
- `athlete_access` table: `status` ('pending' → 'active' → can be 'inactive' on ownership transfer), `access_level` ('view'/'full'), `relationship_label` (Coach/Athlete/Parent), `granted_to_user_id`
- Auto-claim via `claim_pending_invites()` security definer function (fixed a Postgres RLS quirk: can't UPDATE a row you can't yet SELECT under RLS — claim logic had to move into a security definer function)
- Ownership transfer via `transfer_ownership(p_athlete_id, p_new_owner_user_id)` security definer function — validates caller is current owner, target has active access, then swaps `athletes.user_id` and soft-deletes/reactivates access rows (not hard delete) so relationship_label/profile data survives repeated transfers
- Two RLS bugs solved historically: circular policy recursion (fixed with `is_athlete_owner`/`has_athlete_access` helper functions), and the claim-invite UPDATE-visibility issue above

### Profiles (real identity layer)
- `profiles` table: `id` (matches `auth.users.id`), `name`, `created_at`
- Auto-created via `handle_new_user()` trigger on `auth.users` insert, pulling `name` from signup metadata (`raw_user_meta_data->>'name'`)
- Name is account-level, not per-invite — important because a coach may have access to multiple athletes and needs one consistent name across all of them, not retyped per relationship
- Editable anytime via `app/athletes.tsx` (tap name near top of screen)
- `athlete_access.name` column exists but is now dead/unused — display logic pulls from `profiles.name` via `granted_to_user_id` instead, falling back to invited_email for pending invites with no account yet

### Logout
- `context/AuthContext.tsx` — lightweight AuthProvider wrapping the app in `app/_layout.tsx`, exposes `session`, `user`, `loading`, `signOut()`
- Logout button on `app/athletes.tsx` (the post-login home screen)

### Messaging
- In-app per-athlete messaging (`app/messages.tsx`) via Supabase Realtime, unread-count badge shown on `app/athlete.tsx`

### Workouts
- `exercises` / `workout_templates` / `workout_template_exercises` / `workouts` / `workout_exercises` tables. Exercises carry both per-exercise "suggested default" values (`exercises.default_*`, pre-fills a form whenever that exercise is newly added to any template) and, independently, a template's own saved values (`workout_template_exercises.default_*`) — the two are never overwritten by each other, so editing one template's numbers can't leak into another.
- **Workout Templates** (`app/templates.tsx`, `app/template-edit.tsx`): reusable exercise bundles, user-owned (not athlete-scoped — a deliberate exception to the rest of the app's data model). Presets (`is_preset = true, created_by = null`) are shared/global; hiding or editing a preset only ever affects that one user's view — `workout_template_hidden_for_user` is a per-user hide, and editing a preset **forks** a personal copy under the same name rather than mutating the shared row. Save (in-place update for an owned template, fork-and-hide for a preset) vs. Save As (always creates a new copy-and-rename, original untouched) are both name-unique per user via a partial unique index that excludes preset rows. Assigning a template to an athlete (`workout-assign.tsx`'s "Start from Template") is a one-time copy into that athlete's `workouts`/`workout_exercises`, never a live link.
- Scheduling/completion lifecycle (`scheduled` → `completed`/`missed`, with `missed_reason` reason chips) originally lived on a dedicated `app/workouts.tsx` calendar screen — **that screen is retired**; see "Home screen" below, which absorbed it.

### Game/Pitch Tracking
- Live entry (`app/game-setup.tsx` → `app/game-entry.tsx`): Practice/Scrimmage vs. Live Game, dynamic ball/strike/foul button labels, 3rd-strike confirm, manual +Out, End Inning (Total Runs required, Earned Runs optional), inning-batched persistence with resume, shareable recap. One shared `sessions` table (`session_type: 'bullpen' | 'game'`) backs both bullpen and games.
- Can now also be **scheduled ahead of time** with date, optional time, and opponent/game name — see "Home screen" below.

### Home screen — unified scheduling and results surface
- `app/home.tsx`: a hand-built "boxed" month calendar aggregating workouts/bullpens/games across every athlete (or filtered to one via pills — the "All" pill only appears once you have more than one athlete).
- Adding something: tap a day (or use the `+Workout`/`+Bullpen`/`+Game` quick-add row, which already knows its type and so skips straight past that step) → pick an athlete only if more than one is currently selected → land on the right create/schedule screen (`workout-assign`, the new `bullpen-schedule`, or the new `game-schedule`).
- Viewing/acting on something: tapping an existing item opens a per-type card (`components/WorkoutDayCard.tsx`, `BullpenDayCard.tsx`, `GameDayCard.tsx`) in place. Once an item is resolved (workout `completed`/`missed`, bullpen `submitted`/`missed`, game `submitted`/`missed`) it's read-only — no more edits. While unresolved (`scheduled`, or a game actually `in_progress`) it stays editable: Mark Missed (reason chips + note, the same pattern across all three types) and Delete are available, except a game that's already past its date and never started can't be deleted (only resolved via Mark Missed or by opening tracking and filling it in retroactively) — a *future* scheduled game can still be deleted outright. Tapping a genuinely `in_progress` game skips the card and resumes live tracking directly.
- A scheduled bullpen/game is a real row from the moment it's scheduled (`sessions.status = 'scheduled'`, plus `target_pitches` for bullpen or `session_time`/`opponent` for games) — opening it to begin tracking adopts that same row rather than creating a second, disconnected one. Closing the app after opening a scheduled item but before finishing still discards any half-entered pitches (neither bullpen nor game checkpoints mid-entry), but the scheduled placeholder itself survives so nothing is silently lost.
- The athlete tab's "Quick Start Bullpen" / "Quick Start Game" / "Quick Start Workout" buttons remain a separate, unscheduled "start right now" shortcut, unchanged by any of the above.

## Known workflow gotcha (Windows/Expo)
Multiple times this project has hit a "React has detected a change in the order of Hooks" crash originating from `expo-router`'s internal `ContextNavigator`/`useStore`, even when the actual app code was fine. In one confirmed case, the real cause was a stray `useState()` call accidentally placed at module scope (outside any component) in `athlete.tsx` — Expo Router scans every file under `app/` at boot, so this crashed the whole app even when viewing an unrelated screen. **If this error recurs: grep every file under `app/` for hooks (`useState`, `useEffect`, etc.) called outside a component function before assuming it's environment flakiness.** Standard recovery attempted (didn't always work alone): `npx expo start -c`, clear Expo Go cache/data on device, full reboot, `rm -rf node_modules && npm install`.

## Roadmap
Logout, ownership transfer, athlete editing, the C-pitch simulated-batters-faced fix, the Workouts feature, Game/Pitch Tracking, Messaging, Workout Templates, and the Home screen (including scheduled bullpen/game sessions) are all built — see "What's built" above for each. Photo/video upload for Game/Pitch Tracking (up to ~30-second clips, exact max clip count still undecided) remains explicitly deferred to decide with real usage rather than guessing now; Supabase storage/compression cost is a real consideration once it's picked up. No other item is currently queued — check with the user for what's next before assuming.

## Product principles (keep applying these)
- Capture raw values, per-pitch timestamps, consistent IDs from day one — schema decisions now affect the longitudinal dataset later
- Prefer lightweight/focused features over trying to out-build full-featured incumbents
- View access to an athlete is permanently free regardless of subscription status — deliberate product decision, not a deferral
- When adding schema changes, default to SQL Editor (not the Supabase GUI) for anything beyond a single simple column, to keep a full runnable history of all database changes