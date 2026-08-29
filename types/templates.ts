import { Exercise } from './workout';

export type WorkoutTemplate = {
  id: number;
  created_by: string | null;
  is_preset: boolean;
  name: string;
  description: string | null;
  created_at: string;
};

export type WorkoutTemplateExerciseRow = {
  id: number;
  template_id: number;
  exercise_id: number;
  order_index: number;
  default_sets: number | null;
  default_reps: number | null;
  default_weight: number | null;
  default_duration_seconds: number | null;
  default_distance: number | null;
  default_intensity: string | null;
  exercises: Exercise;
};

export type WorkoutTemplateWithExercises = WorkoutTemplate & {
  workout_template_exercises: WorkoutTemplateExerciseRow[];
};
