export type RestGuideline = {
  age_min: number;
  age_max: number;
  pitch_min: number;
  pitch_max: number | null;
  rest_days_required: number;
};

export type DailyMaxGuideline = {
  age_min: number;
  age_max: number;
  daily_max: number;
};

export type DayPitchCount = { bullpen: number; game: number };

export function calculateAge(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const today = new Date();
  const birth = new Date(birthdate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function toYMD(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toYMD(d);
}

function daysBetween(fromStr: string, toStr: string): number {
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T00:00:00');
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// Monday of the calendar week containing dateStr (weeks run Mon-Sun).
export function mondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return toYMD(d);
}

// Guideline rows are seeded per exact age bracket (e.g. 7-8, 9-10, ...) -
// an age outside every defined bracket clamps to the nearest one rather
// than showing no guidance at all.
function findBracket<T extends { age_min: number; age_max: number }>(rows: T[], age: number): T | null {
  if (rows.length === 0) return null;
  const exact = rows.find((r) => age >= r.age_min && age <= r.age_max);
  if (exact) return exact;
  const sorted = [...rows].sort((a, b) => a.age_min - b.age_min);
  if (age < sorted[0].age_min) return sorted[0];
  return sorted[sorted.length - 1];
}

export function dailyMaxForAge(guidelines: DailyMaxGuideline[], age: number): number | null {
  return findBracket(guidelines, age)?.daily_max ?? null;
}

// The rest-day scale for an age is picked by which bracket-group the age
// falls in (7-14 vs 15-18) - every row sharing that group's age_min/age_max
// is one tier of that scale.
export function restTiersForAge(guidelines: RestGuideline[], age: number): RestGuideline[] {
  const bracket = findBracket(guidelines, age);
  if (!bracket) return [];
  return guidelines
    .filter((g) => g.age_min === bracket.age_min && g.age_max === bracket.age_max)
    .sort((a, b) => a.pitch_min - b.pitch_min);
}

export function restDaysForCount(tiers: RestGuideline[], pitchCount: number): number {
  if (pitchCount <= 0) return 0;
  const tier = tiers.find((t) => pitchCount >= t.pitch_min && (t.pitch_max === null || pitchCount <= t.pitch_max));
  return tier?.rest_days_required ?? (tiers.length > 0 ? tiers[tiers.length - 1].rest_days_required : 0);
}

export function countForMode(day: DayPitchCount | undefined, mode: 'all' | 'games'): number {
  if (!day) return 0;
  return mode === 'games' ? day.game : day.bullpen + day.game;
}

export type SuggestedRest =
  | { eligible: true }
  | { eligible: false; daysRemaining: number; nextEligibleDate: string; triggerDate: string; triggerCount: number };

// Looks back up to 5 calendar days (the longest possible tier) from today.
// Every day in the window is checked independently - an outing from a few
// days ago can still impose a longer remaining wait than a more recent one,
// so this takes the max remaining_rest across the whole window, not just
// the most recent day.
export function computeSuggestedRest(
  today: string,
  dailyCounts: Record<string, DayPitchCount>,
  tiers: RestGuideline[],
  mode: 'all' | 'games'
): SuggestedRest {
  let best: { remaining: number; triggerDate: string; triggerCount: number; required: number } | null = null;

  for (let back = 0; back <= 4; back++) {
    const day = addDays(today, -back);
    const count = countForMode(dailyCounts[day], mode);
    if (count <= 0) continue;
    const required = restDaysForCount(tiers, count);
    const elapsed = daysBetween(day, today);
    const remaining = required - elapsed;
    if (!best || remaining > best.remaining) {
      best = { remaining, triggerDate: day, triggerCount: count, required };
    }
  }

  if (!best || best.remaining <= 0) return { eligible: true };

  return {
    eligible: false,
    daysRemaining: best.remaining,
    nextEligibleDate: addDays(best.triggerDate, best.required),
    triggerDate: best.triggerDate,
    triggerCount: best.triggerCount,
  };
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
