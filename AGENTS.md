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

### Bullpen tracking (TCN system) — ~90% complete
- Live bullpen session entry: pitches logged as T (Target — hit the spot), C (Competitive — close miss, still hittable/in-zone-ish), or N (Non-competitive — clear miss)
- Session history, notes, native share sheet for results
- Analytics on `app/athlete.tsx`: Target % Trend (line chart), T/C/N Breakdown (bar chart), date range + session type filters
- **"Simulated Batters Faced" card** — derives simulated K's/BB's from the T/C/N pitch sequence for a single-pitcher bullpen with no real batter. **This logic is mid-redesign — see "Open Decision" below, this is the next thing to pick up.**

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

## Known workflow gotcha (Windows/Expo)
Multiple times this project has hit a "React has detected a change in the order of Hooks" crash originating from `expo-router`'s internal `ContextNavigator`/`useStore`, even when the actual app code was fine. In one confirmed case, the real cause was a stray `useState()` call accidentally placed at module scope (outside any component) in `athlete.tsx` — Expo Router scans every file under `app/` at boot, so this crashed the whole app even when viewing an unrelated screen. **If this error recurs: grep every file under `app/` for hooks (`useState`, `useEffect`, etc.) called outside a component function before assuming it's environment flakiness.** Standard recovery attempted (didn't always work alone): `npx expo start -c`, clear Expo Go cache/data on device, full reboot, `rm -rf node_modules && npm install`.

## Open decision — pick up here next

**"Simulated Batters Faced" C-pitch handling is unresolved and is the next task.**

The problem: the original logic counted both T and C as strikes (only N as a ball). Real session data (T41/C17/N17) produced an unrealistic 18-for-18 simulated strikeout rate — the model has no "ball in play" outcome, so with only two possible resolutions (K or BB), sequences funnel almost entirely into whichever is reached first.

Explored and rejected:
- **C = always strike** (original): overcounts K's badly
- **C = 50/50 random**: not reproducible/trustworthy as a stat parents compare over time
- **C = alternating strike/ball**: arbitrary, not really grounded in anything
- **C weighted by athlete "experience level"**: rejected because it would make the same kid's stat non-comparable over time if his level changes — undermines the actual goal (seeing real improvement trend)
- Real MLB Statcast data on "shadow zone" (borderline) pitches shows ~50% called-strike rate **on taken pitches only** — but this doesn't cover swung-at/contact outcomes, which a "hittable, close to the zone" C pitch would often produce in reality. So no clean empirical rule fully justifies any single treatment.

**Landed on, not yet implemented:** C is **neutral** — only T advances the simulated strike count, only N advances the simulated ball count, C advances neither. Verified against real data (T41/C17/N17 → 13 simulated K, 4 simulated BB, realistic) and the earlier T6/C6/N3 example (2 K, 0 BB, reasonable for small sample).

**Known edge case, accepted as-is:** an all-C session (e.g. 15/15 C pitches) would show 0 batters faced under this rule, since nothing advances either counter. Agreed to add a fallback message for `battersFaced === 0` with real pitches thrown, rather than showing a blank/broken-looking 0.

**Next planned enhancement (not yet designed in detail):** add a third stat alongside simulated K's and BB's on the card — something that surfaces the volume of C ("competitive") pitches thrown, so a strong session heavy in competitive-but-neutral pitches doesn't look like nothing happened. Exact label/presentation still needs to be worked out.

**Implementation location:** the `summarize()` function in `app/athlete.tsx` (used by both the analytics cards and `shareSession()`'s share-text formatting — both need to stay consistent if the logic changes).

## Roadmap (confirmed order)
1. ~~Logout~~ ✅
2. ~~Test/build ownership transfer~~ ✅
3. ~~Athlete editing~~ ✅
4. **Fix C-pitch simulated batters-faced logic** ← next
5. Workouts feature (not started)
6. Game/pitch tracking (not started) — full mechanics design already locked in below

## Game/Pitch Tracking — locked design (not yet built)
Intentionally lightweight, not a GameChanger competitor. Parent-driven live charting during a game or scrimmage.

- Session type selector at start: **Practice/Scrimmage vs. Live Game** (same mechanics either way, just a filterable field — avoids building "live bullpen" as a separate third feature)
- Pitch-by-pitch buttons with **dynamic labels reflecting live count**: "Strike" → "Strike 2", "Ball" → "Ball 2" → "Ball 3"
- **Foul** button: adds to pitch count, does NOT advance strike count past 2 (real baseball rule — foul with 2 strikes stays at 2, except bunts)
- 3rd strike → confirmation popup ("Record out — K?") rather than silent auto-out, to catch mis-taps
- **HBP** and **Hit** buttons: end the at-bat, batter reaches base
- Manual **+Out** button for balls in play (groundout/flyout/etc.)
- **End Inning** button → popup asks for **Total Runs** (required) and **Earned Runs** (optional, defaults to total runs if left blank) — this gives both RA (Runs Allowed, no judgment call needed) and ERA (optional, for parents who want to track it precisely) without forcing an error/no-error judgment call on everyone
- Derived stats once built: Innings Pitched, Pitches/Inning (avg), Runs Allowed, ERA (optional/derived), WHIP, K/9, BB/9, Strike %
- Photo/video upload also planned for this feature: up to ~30-second clips, exact max clip count (1 vs. 3) still undecided — deliberately deferred to decide with real usage rather than guessing now. Storage/compression cost noted as a real consideration once built (Supabase storage limits).

## Product principles (keep applying these)
- Capture raw values, per-pitch timestamps, consistent IDs from day one — schema decisions now affect the longitudinal dataset later
- Prefer lightweight/focused features over trying to out-build full-featured incumbents
- View access to an athlete is permanently free regardless of subscription status — deliberate product decision, not a deferral
- When adding schema changes, default to SQL Editor (not the Supabase GUI) for anything beyond a single simple column, to keep a full runnable history of all database changes