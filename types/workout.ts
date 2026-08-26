export type DistanceUnit = 'yd' | 'ft' | 'mi';

export type Exercise = {
  id: number;
  name: string;
  category: string;
  requires_weight: boolean;
  requires_reps: boolean;
  requires_duration: boolean;
  requires_distance: boolean;
  requires_sets: boolean;
  requires_intensity: boolean;
  distance_unit: DistanceUnit;
  created_by: string | null;
};

export type ExerciseFieldKey =
  | 'sets'
  | 'reps'
  | 'weight'
  | 'duration_seconds'
  | 'distance'
  | 'intensity';

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return isNaN(n) ? null : n;
}

function formatNumber(value: number | string | null): string {
  return value == null ? '' : String(value);
}

function parseText(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

// Accepts a bare number of seconds ("45") for short exercises, or "mm:ss" /
// "hh:mm:ss" for longer ones (a 30-minute bike ride is "30:00", not "1800").
export function parseDuration(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!trimmed.includes(':')) {
    const n = parseInt(trimmed, 10);
    return isNaN(n) ? null : n;
  }
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => isNaN(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function formatDuration(value: number | string | null): string {
  if (value == null) return '';
  const seconds = typeof value === 'string' ? Number(value) : value;
  if (isNaN(seconds)) return '';
  if (seconds < 60) return String(seconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type ExerciseField = {
  key: ExerciseFieldKey;
  flag: keyof Exercise;
  label: string;
  keyboard: 'numeric' | 'default';
  placeholder?: string;
  parse: (raw: string) => number | string | null;
  format: (value: number | string | null) => string;
};

export const EXERCISE_FIELDS: ExerciseField[] = [
  { key: 'sets', flag: 'requires_sets', label: 'Sets', keyboard: 'numeric', parse: parseNumber, format: formatNumber },
  { key: 'reps', flag: 'requires_reps', label: 'Reps', keyboard: 'numeric', parse: parseNumber, format: formatNumber },
  {
    key: 'weight',
    flag: 'requires_weight',
    label: 'Weight (lbs)',
    keyboard: 'numeric',
    parse: parseNumber,
    format: formatNumber,
  },
  {
    // Rendered as a dedicated min/sec pair of boxes (see components/DurationInput.tsx)
    // rather than this generic single TextInput - the two-box UI already produces a
    // clean total-seconds number, so parse/format here just pass that number through.
    key: 'duration_seconds',
    flag: 'requires_duration',
    label: 'Duration',
    keyboard: 'numeric',
    parse: parseNumber,
    format: formatNumber,
  },
  {
    key: 'distance',
    flag: 'requires_distance',
    label: 'Distance',
    keyboard: 'numeric',
    parse: parseNumber,
    format: formatNumber,
  },
  {
    key: 'intensity',
    flag: 'requires_intensity',
    label: 'Intensity',
    keyboard: 'default',
    parse: parseText,
    format: formatNumber,
  },
];

export function exerciseFieldsFor(exercise: Exercise) {
  return EXERCISE_FIELDS.filter((f) => exercise[f.flag]);
}

// Distance is the one field whose unit varies per exercise (yards for a
// sprint, miles for a jog, feet for a broad jump) - every other label is static.
export function fieldLabel(field: ExerciseField, exercise: Exercise): string {
  if (field.key === 'distance') return `Distance (${exercise.distance_unit})`;
  return field.label;
}

export type WorkoutExerciseRow = {
  id: number;
  exercise_id: number;
  order_index: number;
  target_weight: number | null;
  target_reps: number | null;
  target_sets: number | null;
  target_duration_seconds: number | null;
  target_distance: number | null;
  target_intensity: string | null;
  actual_weight: number | null;
  actual_reps: number | null;
  actual_sets: number | null;
  actual_duration_seconds: number | null;
  actual_distance: number | null;
  actual_intensity: string | null;
  completed: boolean;
  exercises: Exercise;
};

export type WorkoutStatus = 'scheduled' | 'completed' | 'missed';

export type Workout = {
  id: number;
  athlete_id: number;
  assigned_by: string;
  scheduled_date: string;
  title: string | null;
  status: WorkoutStatus;
  missed_reason: string | null;
  notes: string | null;
  recurrence_group_id: string | null;
  workout_exercises: WorkoutExerciseRow[];
};

export const MISSED_REASON_CHIPS = ['Weather', 'Sick/Injured', 'Travel', 'Other'];

export function fieldValue(row: WorkoutExerciseRow, prefix: 'target' | 'actual', key: ExerciseFieldKey) {
  return (row as any)[`${prefix}_${key}`] as number | string | null;
}

export function describeTargets(row: WorkoutExerciseRow): string {
  const parts: string[] = [];
  if (row.target_sets != null && row.target_reps != null) parts.push(`${row.target_sets}x${row.target_reps}`);
  else if (row.target_sets != null) parts.push(`${row.target_sets} sets`);
  else if (row.target_reps != null) parts.push(`${row.target_reps} reps`);
  if (row.target_weight != null) parts.push(`@ ${row.target_weight} lbs`);
  if (row.target_distance != null) parts.push(`${row.target_distance} ${row.exercises.distance_unit}`);
  if (row.target_duration_seconds != null) parts.push(formatDuration(row.target_duration_seconds));
  if (row.target_intensity) parts.push(row.target_intensity);
  return parts.length > 0 ? parts.join('  ') : 'No target set';
}

export function randomGroupId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
