export type PitchOutcome = 'T' | 'C' | 'N';

export type Pitch = {
  id?: number;
  outcome: PitchOutcome;
  pitch_type: string | null;
  speed: number | null;
  pitch_order: number;
};

export type BullpenSession = {
  id: number;
  athlete_id: number;
  session_date: string;
  session_type: string;
  bullpen_subtype: string | null;
  target_pitches: number | null;
  notes: string | null;
  status: string;
  missed_reason: string | null;
  pitches: Pitch[];
};

export type BatterLine = { seq: PitchOutcome[]; result: 'K' | 'BB' | null };

// C is neutral: a competitive pitch is close enough to be hittable, so it
// shouldn't auto-resolve as either a strike or a ball in the simulation.
// Shared by the live entry screen and any read-only results view so the two
// can never quietly diverge on what a session's K/BB total means.
export function simulateBatters(pitches: { outcome: string }[]) {
  let strikes = 0,
    balls = 0,
    k = 0,
    bb = 0;
  const batters: BatterLine[] = [];
  let seq: PitchOutcome[] = [];

  for (const p of pitches) {
    if (p.outcome !== 'T' && p.outcome !== 'C' && p.outcome !== 'N') continue;
    seq.push(p.outcome);
    if (p.outcome === 'T') strikes++;
    else if (p.outcome === 'N') balls++;

    if (strikes >= 3) {
      k++;
      batters.push({ seq, result: 'K' });
      seq = [];
      strikes = 0;
      balls = 0;
    } else if (balls >= 4) {
      bb++;
      batters.push({ seq, result: 'BB' });
      seq = [];
      strikes = 0;
      balls = 0;
    }
  }
  if (seq.length > 0) batters.push({ seq, result: null });

  return { k, bb, battersFaced: batters.length, batters };
}

export function tcnCounts(pitches: { outcome: string }[]) {
  const counts = { T: 0, C: 0, N: 0 };
  pitches.forEach((p) => {
    if (p.outcome === 'T' || p.outcome === 'C' || p.outcome === 'N') counts[p.outcome]++;
  });
  return counts;
}
