export type GamePitchOutcome = 'ball' | 'strike' | 'foul' | 'hbp' | 'hit' | 'out';

export type GamePitch = {
  id: number;
  inning_id: number;
  outcome: GamePitchOutcome;
  pitch_order: number;
};

export type Inning = {
  id: number;
  session_id: number;
  inning_number: number;
  total_runs: number;
  earned_runs: number;
  game_pitches: GamePitch[];
};

export type GameSession = {
  id: number;
  athlete_id: number;
  session_type: string;
  game_subtype: 'practice' | 'live' | null;
  opponent: string | null;
  session_date: string;
  notes: string | null;
  status: string;
  innings: Inning[];
};

export type InningCounts = {
  balls: number;
  strikes: number;
  outs: number;
  k: number;
  bb: number;
  hbp: number;
  hits: number;
  manualOuts: number;
  pitchCount: number;
};

// Replays an ordered event sequence (no separate at-bat table needed) - the
// same trick the bullpen's simulated-batters-faced already uses. Works for
// both the live running count within one inning and for aggregate stats
// across many innings/sessions (order across innings doesn't matter for
// aggregate totals, only within a single inning's own sequence).
export function deriveCounts(outcomes: GamePitchOutcome[]): InningCounts {
  let balls = 0,
    strikes = 0,
    outs = 0,
    k = 0,
    bb = 0,
    hbp = 0,
    hits = 0,
    manualOuts = 0;

  outcomes.forEach((outcome) => {
    if (outcome === 'strike') {
      strikes++;
      if (strikes >= 3) {
        k++;
        outs++;
        balls = 0;
        strikes = 0;
      }
    } else if (outcome === 'foul') {
      if (strikes < 2) strikes++;
    } else if (outcome === 'ball') {
      balls++;
      if (balls >= 4) {
        bb++;
        balls = 0;
        strikes = 0;
      }
    } else if (outcome === 'hbp') {
      hbp++;
      balls = 0;
      strikes = 0;
    } else if (outcome === 'hit') {
      hits++;
      balls = 0;
      strikes = 0;
    } else if (outcome === 'out') {
      manualOuts++;
      outs++;
      balls = 0;
      strikes = 0;
    }
  });

  return { balls, strikes, outs, k, bb, hbp, hits, manualOuts, pitchCount: outcomes.length };
}

// Baseball's IP notation: outs%3 is thirds, shown as .1/.2, never a decimal
// fraction (11 outs = "3.2", not "3.67").
export function formatIP(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

export function formatStat(n: number | null): string {
  return n === null ? '—' : n.toFixed(2);
}

export type BatterResult = 'K' | 'BB' | 'HBP' | 'Hit' | 'Out';

export type BatterLine = {
  seq: GamePitchOutcome[];
  result: BatterResult | null; // null = at-bat still in progress
};

// Same walk as deriveCounts, but keeps each batter's own pitch sequence
// instead of collapsing to totals - powers the expandable batter-by-batter
// log, mirroring the bullpen entry screen's simulated-batter log.
export function groupBatters(outcomes: GamePitchOutcome[]): BatterLine[] {
  const batters: BatterLine[] = [];
  let seq: GamePitchOutcome[] = [];
  let balls = 0;
  let strikes = 0;

  const closeBatter = (result: BatterResult) => {
    batters.push({ seq, result });
    seq = [];
    balls = 0;
    strikes = 0;
  };

  outcomes.forEach((outcome) => {
    seq.push(outcome);
    if (outcome === 'strike') {
      strikes++;
      if (strikes >= 3) closeBatter('K');
    } else if (outcome === 'foul') {
      if (strikes < 2) strikes++;
    } else if (outcome === 'ball') {
      balls++;
      if (balls >= 4) closeBatter('BB');
    } else if (outcome === 'hbp') {
      closeBatter('HBP');
    } else if (outcome === 'hit') {
      closeBatter('Hit');
    } else if (outcome === 'out') {
      closeBatter('Out');
    }
  });

  if (seq.length > 0) batters.push({ seq, result: null });
  return batters;
}

// Each inning's pitch sequence is replayed *independently* and the resulting
// counts summed, rather than concatenating every inning's pitches into one
// long sequence - an inning that was closed out mid-at-bat (pulled with a
// 1-1 count, say) must not leak its unfinished count into the next inning's
// replay.
export function gameSessionStats(session: GameSession) {
  const perInning = session.innings.map((i) => deriveCounts(i.game_pitches.map((p) => p.outcome)));
  const sum = (key: 'outs' | 'k' | 'bb' | 'hbp' | 'hits' | 'manualOuts' | 'pitchCount') =>
    perInning.reduce((total, c) => total + c[key], 0);

  const outs = sum('outs');
  const k = sum('k');
  const bb = sum('bb');
  const hbp = sum('hbp');
  const hits = sum('hits');
  const manualOuts = sum('manualOuts');
  const pitchCount = sum('pitchCount');
  const trueIP = outs / 3;
  const runs = session.innings.reduce((total, i) => total + i.total_runs, 0);
  const earnedRuns = session.innings.reduce((total, i) => total + i.earned_runs, 0);

  // Strike% needs the raw ball tally across every pitch thrown, not the
  // live/resettable balls count.
  const rawBallCount = session.innings.flatMap((i) => i.game_pitches).filter((p) => p.outcome === 'ball').length;

  return {
    outs,
    k,
    bb,
    hbp,
    hits,
    manualOuts,
    pitchCount,
    runs,
    earnedRuns,
    ip: formatIP(outs),
    era: trueIP === 0 ? null : (earnedRuns * 9) / trueIP,
    whip: trueIP === 0 ? null : (bb + hits) / trueIP,
    k9: trueIP === 0 ? null : (k * 9) / trueIP,
    bb9: trueIP === 0 ? null : (bb * 9) / trueIP,
    strikePct: pitchCount === 0 ? 0 : Math.round(((pitchCount - rawBallCount - hbp) / pitchCount) * 100),
  };
}
