import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../supabase';
import {
  ExerciseFieldKey,
  MISSED_REASON_CHIPS,
  Workout,
  WorkoutExerciseRow,
  describeTargets,
  exerciseFieldsFor,
  fieldLabel,
  fieldValue,
} from '../types/workout';
import { DurationInput } from './DurationInput';

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#4C9BE8',
  completed: '#3FB98A',
  missed: '#D6524F',
};

export function WorkoutDayCard({
  workout,
  canEdit,
  onChanged,
}: {
  workout: Workout;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [edits, setEdits] = useState<Record<number, Partial<Record<ExerciseFieldKey, string>>>>({});
  const [showMissedPicker, setShowMissedPicker] = useState(false);
  const [missedChip, setMissedChip] = useState<string | null>(null);
  const [missedNote, setMissedNote] = useState('');
  const [notesEdit, setNotesEdit] = useState(workout.notes ?? '');
  const [saving, setSaving] = useState(false);

  // Once resolved (completed or missed), a workout is history - no more edits.
  const resolved = workout.status !== 'scheduled';

  const setEdit = (rowId: number, field: ExerciseFieldKey, value: string) => {
    setEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [field]: value } }));
  };

  const valueFor = (row: WorkoutExerciseRow, field: ExerciseFieldKey) => {
    const edited = edits[row.id]?.[field];
    if (edited !== undefined) return edited;
    const fieldDef = exerciseFieldsFor(row.exercises).find((f) => f.key === field);
    return fieldDef ? fieldDef.format(fieldValue(row, 'actual', field)) : '';
  };

  const rowUpdateFromEdits = (row: WorkoutExerciseRow) => {
    const update: Record<string, number | string | null> = {};
    const rowEdits = edits[row.id];
    if (!rowEdits) return update;
    exerciseFieldsFor(row.exercises).forEach((f) => {
      const raw = rowEdits[f.key];
      if (raw === undefined) return;
      update[`actual_${f.key}`] = f.parse(raw);
    });
    return update;
  };

  const persistActuals = async (statusUpdate?: { status: 'completed' | 'missed'; missed_reason?: string | null }) => {
    setSaving(true);
    for (const row of workout.workout_exercises) {
      const update = rowUpdateFromEdits(row);
      if (Object.keys(update).length > 0) {
        await supabase.from('workout_exercises').update(update).eq('id', row.id);
      }
    }
    const workoutUpdate: Record<string, string | null> = {};
    if (notesEdit !== (workout.notes ?? '')) workoutUpdate.notes = notesEdit.trim() || null;
    if (statusUpdate) {
      workoutUpdate.status = statusUpdate.status;
      workoutUpdate.missed_reason = statusUpdate.missed_reason ?? null;
    }
    if (Object.keys(workoutUpdate).length > 0) {
      await supabase.from('workouts').update(workoutUpdate).eq('id', workout.id);
    }
    setSaving(false);
    onChanged();
  };

  const isRowMissingValues = (row: WorkoutExerciseRow) =>
    exerciseFieldsFor(row.exercises).some((f) => {
      const raw = edits[row.id]?.[f.key];
      if (raw !== undefined && raw.trim() !== '') return false;
      return fieldValue(row, 'actual', f.key) == null;
    });

  const completeWorkout = async (useTargetFallback: boolean) => {
    setSaving(true);
    await Promise.all(
      workout.workout_exercises.map((row) => {
        const update: Record<string, number | string | boolean | null> = {
          ...rowUpdateFromEdits(row),
          completed: true,
        };
        if (useTargetFallback) {
          exerciseFieldsFor(row.exercises).forEach((f) => {
            if (update[`actual_${f.key}`] !== undefined) return;
            if (fieldValue(row, 'actual', f.key) != null) return;
            update[`actual_${f.key}`] = fieldValue(row, 'target', f.key);
          });
        }
        return supabase.from('workout_exercises').update(update).eq('id', row.id);
      })
    );
    const workoutUpdate: Record<string, string | null> = { status: 'completed' };
    if (notesEdit !== (workout.notes ?? '')) workoutUpdate.notes = notesEdit.trim() || null;
    await supabase.from('workouts').update(workoutUpdate).eq('id', workout.id);
    setEdits({});
    setSaving(false);
    onChanged();
  };

  const markComplete = () => {
    if (workout.workout_exercises.length === 0) {
      persistActuals({ status: 'completed' });
      return;
    }
    const missingRows = workout.workout_exercises.filter(isRowMissingValues);
    if (missingRows.length === 0) {
      completeWorkout(false);
      return;
    }
    const names = missingRows.map((r) => r.exercises.name).join(', ');
    Alert.alert(
      'Missing values',
      `${names} ${missingRows.length === 1 ? 'is' : 'are'} missing some actual values. Use the assigned target values for what's missing and complete the workout?`,
      [
        { text: 'Go Back', style: 'cancel' },
        { text: 'Use Targets & Complete', onPress: () => completeWorkout(true) },
      ]
    );
  };

  const confirmMissed = () => {
    if (!missedChip) {
      Alert.alert('Pick a reason', 'Select a quick reason for the missed workout.');
      return;
    }
    const reason =
      missedChip === 'Other' && missedNote.trim()
        ? `Other: ${missedNote.trim()}`
        : missedNote.trim()
        ? `${missedChip}: ${missedNote.trim()}`
        : missedChip;
    persistActuals({ status: 'missed', missed_reason: reason });
    setShowMissedPicker(false);
  };

  const deleteWorkout = () => {
    Alert.alert('Delete this workout?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('workouts').delete().eq('id', workout.id);
          onChanged();
        },
      },
    ]);
  };

  const cancelSeries = async () => {
    const groupId = workout.recurrence_group_id;
    if (!groupId) return;
    const today = new Date().toISOString().split('T')[0];

    const { count } = await supabase
      .from('workouts')
      .select('id', { count: 'exact', head: true })
      .eq('recurrence_group_id', groupId)
      .eq('status', 'scheduled')
      .gte('scheduled_date', today);

    if (!count) {
      Alert.alert('Nothing to cancel', 'No remaining scheduled workouts in this series.');
      return;
    }

    Alert.alert(
      'Cancel remaining series?',
      `This will permanently delete ${count} remaining scheduled workout${count === 1 ? '' : 's'} in this series. Already completed or missed days aren't affected. This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Series',
          style: 'destructive',
          onPress: async () => {
            await supabase
              .from('workouts')
              .delete()
              .eq('recurrence_group_id', groupId)
              .eq('status', 'scheduled')
              .gte('scheduled_date', today);
            onChanged();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.dayCard}>
      <View style={styles.dayCardHeader}>
        <Text style={styles.exerciseName}>{workout.title || 'Workout'}</Text>
        <Text style={[styles.statusBadge, { color: STATUS_COLOR[workout.status] }]}>
          {workout.status.toUpperCase()}
        </Text>
      </View>

      {workout.workout_exercises.map((row) => {
        const fields = exerciseFieldsFor(row.exercises);
        return (
          <View key={row.id} style={styles.exerciseSubCard}>
            <Text style={styles.exerciseName}>{row.exercises.name}</Text>
            <Text style={styles.exerciseCategory}>{describeTargets(row)}</Text>
            {!resolved && canEdit && fields.length > 0 && (
              <View style={styles.fieldRow}>
                {fields.map((f) =>
                  f.key === 'duration_seconds' ? (
                    <View key={f.key} style={styles.fieldBox}>
                      <DurationInput
                        label={`Actual ${fieldLabel(f, row.exercises)}`}
                        totalSeconds={valueFor(row, f.key) === '' ? null : Number(valueFor(row, f.key))}
                        onChange={(sec) => setEdit(row.id, 'duration_seconds', sec == null ? '' : String(sec))}
                      />
                    </View>
                  ) : (
                    <View key={f.key} style={styles.fieldBox}>
                      <Text style={styles.fieldLabel}>Actual {fieldLabel(f, row.exercises)}</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType={f.keyboard}
                        placeholder={f.placeholder}
                        value={valueFor(row, f.key)}
                        onChangeText={(v) => setEdit(row.id, f.key, v)}
                      />
                    </View>
                  )
                )}
              </View>
            )}
            {resolved && fields.length > 0 && (
              <View style={styles.fieldRow}>
                {fields.map((f) => {
                  const v = fieldValue(row, 'actual', f.key);
                  if (v == null) return null;
                  return (
                    <Text key={f.key} style={styles.actualReadOnly}>
                      {fieldLabel(f, row.exercises)}: {f.key === 'duration_seconds' ? valueFor(row, f.key) : v}
                    </Text>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}

      {workout.status === 'missed' && workout.missed_reason && (
        <Text style={styles.missedReasonText}>Missed: {workout.missed_reason}</Text>
      )}

      {resolved ? (
        workout.notes && <Text style={styles.notesReadOnly}>{workout.notes}</Text>
      ) : canEdit ? (
        <TextInput
          style={styles.notesFieldInput}
          placeholder="Notes (e.g. couldn't finish outside portion, weather)"
          value={notesEdit}
          onChangeText={setNotesEdit}
          multiline
        />
      ) : (
        workout.notes && <Text style={styles.notesReadOnly}>{workout.notes}</Text>
      )}

      {!resolved && canEdit && showMissedPicker && (
        <View style={styles.missedPicker}>
          <View style={styles.toggleRow}>
            {MISSED_REASON_CHIPS.map((c) => (
              <Pressable
                key={c}
                style={[styles.togglePillSmall, missedChip === c && styles.togglePillActive]}
                onPress={() => setMissedChip(c)}
              >
                <Text style={[styles.toggleText, missedChip === c && styles.toggleTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput style={styles.input} placeholder="Optional note" value={missedNote} onChangeText={setMissedNote} />
          <View style={styles.modalButtons}>
            <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={() => setShowMissedPicker(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalButton, styles.saveButton]} onPress={confirmMissed}>
              <Text style={styles.saveButtonText}>Confirm Missed</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!resolved && canEdit && !showMissedPicker && (
        <View style={styles.dayCardActions}>
          <Pressable style={styles.smallActionButton} onPress={() => persistActuals()} disabled={saving}>
            <Text style={styles.smallActionText}>{saving ? 'Saving...' : 'Save'}</Text>
          </Pressable>
          <Pressable style={styles.smallActionButtonPrimary} onPress={markComplete} disabled={saving}>
            <Text style={styles.smallActionTextPrimary}>Complete Workout</Text>
          </Pressable>
          <Pressable style={styles.smallActionButton} onPress={() => setShowMissedPicker(true)}>
            <Text style={styles.smallActionText}>Mark Missed</Text>
          </Pressable>
          <Pressable style={styles.smallActionButton} onPress={deleteWorkout}>
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
          {workout.recurrence_group_id && (
            <Pressable style={styles.smallActionButton} onPress={cancelSeries}>
              <Text style={styles.deleteText}>Cancel Series</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dayCard: { backgroundColor: '#f7f8fa', borderRadius: 14, padding: 16, marginBottom: 14 },
  dayCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusBadge: { fontSize: 11, fontWeight: '700' },
  exerciseSubCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  exerciseName: { fontSize: 15, fontWeight: '600' },
  exerciseCategory: { fontSize: 12, color: '#888', marginTop: 2 },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  fieldBox: { minWidth: 90 },
  fieldLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  fieldInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, fontSize: 14, backgroundColor: '#fff' },
  actualReadOnly: { fontSize: 12, color: '#444', marginTop: 6, marginRight: 10 },
  missedReasonText: { fontSize: 12, color: '#D6524F', marginTop: 4, fontStyle: 'italic' },
  notesFieldInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    minHeight: 44,
    textAlignVertical: 'top',
    marginTop: 4,
    marginBottom: 4,
  },
  notesReadOnly: { fontSize: 13, color: '#666', fontStyle: 'italic', marginTop: 4 },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  togglePillSmall: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  togglePillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  toggleText: { fontSize: 13, color: '#444' },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  missedPicker: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  dayCardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  smallActionButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  smallActionText: { fontSize: 12, fontWeight: '600', color: '#444' },
  smallActionButtonPrimary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#3FB98A' },
  smallActionTextPrimary: { fontSize: 12, fontWeight: '600', color: '#fff' },
  deleteText: { fontSize: 12, fontWeight: '600', color: '#D6524F' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 12 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalButton: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  cancelButton: { backgroundColor: '#eee' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  saveButton: { backgroundColor: '#4C9BE8' },
  saveButtonText: { color: '#fff', fontWeight: '600' },
});
