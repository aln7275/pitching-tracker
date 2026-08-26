import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { DurationInput } from '../components/DurationInput';
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

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#4C9BE8',
  completed: '#3FB98A',
  missed: '#D6524F',
};

export default function WorkoutsScreen() {
  const { athleteId, athleteName } = useLocalSearchParams<{ athleteId: string; athleteName: string }>();
  const router = useRouter();

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [canLogSessions, setCanLogSessions] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const fetchWorkouts = useCallback(async () => {
    // Only show the full-screen spinner on first load - refreshes after an
    // edit (Save, Mark Complete/Missed, Delete) shouldn't blank the screen.
    if (!hasLoadedOnceRef.current) setLoading(true);
    const { data, error } = await supabase
      .from('workouts')
      .select('*, workout_exercises(*, exercises(*))')
      .eq('athlete_id', athleteId)
      .order('scheduled_date', { ascending: true });

    if (error) {
      console.log('Error fetching workouts:', error.message);
    } else {
      const rows = data as unknown as Workout[];
      // Nested-resource order isn't guaranteed by the API, and exercise rows
      // shouldn't visually reshuffle as they're completed - always sort by
      // the order they were assigned in.
      rows.forEach((w) => w.workout_exercises.sort((a, b) => a.order_index - b.order_index));
      setWorkouts(rows);
    }
    hasLoadedOnceRef.current = true;
    setLoading(false);
  }, [athleteId]);

  // Patches one workout in local state directly, skipping a full refetch -
  // used for optimistic updates (e.g. the per-exercise Complete/Undo toggle)
  // so the screen reflects the change instantly instead of waiting on a
  // round trip that also re-fetches the athlete's whole workout history.
  const patchWorkout = useCallback((workoutId: number, updater: (w: Workout) => Workout) => {
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updater(w) : w)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchWorkouts();
    }, [fetchWorkouts])
  );

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        await supabase
          .from('workout_views')
          .upsert({ user_id: user.id, athlete_id: athleteId, last_viewed_at: new Date().toISOString() });
      })();
    }, [athleteId])
  );

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: athlete } = await supabase.from('athletes').select('user_id').eq('id', athleteId).single();

        if (athlete?.user_id === user.id) {
          setCanLogSessions(true);
          return;
        }

        const { data: access } = await supabase
          .from('athlete_access')
          .select('access_level')
          .eq('athlete_id', athleteId)
          .eq('granted_to_user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();

        setCanLogSessions(access?.access_level === 'full');
      })();
    }, [athleteId])
  );

  const markedDates = useMemo(() => {
    const byDate = new Map<string, Workout[]>();
    workouts.forEach((w) => {
      const list = byDate.get(w.scheduled_date) ?? [];
      list.push(w);
      byDate.set(w.scheduled_date, list);
    });
    const marks: Record<string, any> = {};
    byDate.forEach((list, date) => {
      const status = list.some((w) => w.status === 'missed')
        ? 'missed'
        : list.some((w) => w.status === 'scheduled')
        ? 'scheduled'
        : 'completed';
      marks[date] = { marked: true, dotColor: STATUS_COLOR[status] };
    });
    if (selectedDate) {
      marks[selectedDate] = { ...(marks[selectedDate] ?? {}), selected: true, selectedColor: '#4C9BE8' };
    }
    return marks;
  }, [workouts, selectedDate]);

  const dayWorkouts = useMemo(
    () => (selectedDate ? workouts.filter((w) => w.scheduled_date === selectedDate) : []),
    [workouts, selectedDate]
  );

  const goAssign = (date?: string) => {
    router.push({
      pathname: '/workout-assign',
      params: { athleteId, athleteName, ...(date ? { date } : {}) },
    });
  };

  const cancelAllUpcoming = () => {
    const today = new Date().toISOString().split('T')[0];
    const upcoming = workouts.filter((w) => w.status === 'scheduled' && w.scheduled_date >= today);

    if (upcoming.length === 0) {
      Alert.alert('Nothing to cancel', 'There are no upcoming scheduled workouts.');
      return;
    }

    Alert.alert(
      'Cancel all upcoming workouts?',
      `This will permanently delete ${upcoming.length} upcoming scheduled workout${
        upcoming.length === 1 ? '' : 's'
      } for ${athleteName}. Completed and missed workouts are not affected. This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel All',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('workouts').delete().in('id', upcoming.map((w) => w.id));
            fetchWorkouts();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.title}>Workouts</Text>
        <Text style={styles.athleteName}>{athleteName}</Text>

        {canLogSessions && (
          <Pressable style={styles.assignButton} onPress={() => goAssign()}>
            <Text style={styles.assignButtonText}>+ Assign Workout</Text>
          </Pressable>
        )}

        {canLogSessions && (
          <Pressable style={styles.cancelAllButton} onPress={cancelAllUpcoming}>
            <Text style={styles.cancelAllButtonText}>Cancel All Upcoming Workouts</Text>
          </Pressable>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginVertical: 20 }} />
        ) : (
          <>
            <Calendar
              markingType="dot"
              markedDates={markedDates}
              onDayPress={(day) => setSelectedDate(day.dateString)}
              theme={{ todayTextColor: '#4C9BE8', arrowColor: '#4C9BE8' }}
            />
            <View style={styles.legendRow}>
              <LegendDot color={STATUS_COLOR.scheduled} label="Scheduled" />
              <LegendDot color={STATUS_COLOR.completed} label="Completed" />
              <LegendDot color={STATUS_COLOR.missed} label="Missed" />
            </View>
          </>
        )}
      </ScrollView>

      <Modal visible={!!selectedDate} animationType="slide" transparent onRequestClose={() => setSelectedDate(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.dayModalHeader}>
              <Text style={styles.modalTitle}>{selectedDate}</Text>
              <Pressable onPress={() => setSelectedDate(null)}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 450 }}>
              {dayWorkouts.length === 0 ? (
                <Text style={styles.emptyText}>Nothing scheduled for this day.</Text>
              ) : (
                dayWorkouts.map((w) => (
                  <WorkoutCard
                    key={w.id}
                    workout={w}
                    canEdit={canLogSessions}
                    onChanged={fetchWorkouts}
                    onPatch={patchWorkout}
                  />
                ))
              )}
              {canLogSessions && (
                <Pressable
                  style={styles.addExerciseButton}
                  onPress={() => {
                    const d = selectedDate;
                    setSelectedDate(null);
                    if (d) goAssign(d);
                  }}
                >
                  <Text style={styles.addExerciseButtonText}>+ Add Workout for This Day</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function WorkoutCard({
  workout,
  canEdit,
  onChanged,
  onPatch,
}: {
  workout: Workout;
  canEdit: boolean;
  onChanged: () => void;
  onPatch: (workoutId: number, updater: (w: Workout) => Workout) => void;
}) {
  const [edits, setEdits] = useState<Record<number, Partial<Record<ExerciseFieldKey, string>>>>({});
  const [showMissedPicker, setShowMissedPicker] = useState(false);
  const [missedChip, setMissedChip] = useState<string | null>(null);
  const [missedNote, setMissedNote] = useState('');
  const [notesEdit, setNotesEdit] = useState(workout.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [togglingRowId, setTogglingRowId] = useState<number | null>(null);

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

  const toggleRowComplete = async (row: WorkoutExerciseRow) => {
    setTogglingRowId(row.id);
    const parsedEdits = rowUpdateFromEdits(row);
    const newCompleted = !row.completed;

    // Optimistic: patch the screen's local state immediately so the button/card
    // flip right away, instead of waiting on a write + full refetch round trip.
    onPatch(workout.id, (w) => ({
      ...w,
      workout_exercises: w.workout_exercises.map((r) =>
        r.id === row.id ? ({ ...r, ...parsedEdits, completed: newCompleted } as WorkoutExerciseRow) : r
      ),
    }));
    setEdits((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });

    const update: Record<string, number | string | boolean | null> = { ...parsedEdits, completed: newCompleted };
    const { error } = await supabase.from('workout_exercises').update(update).eq('id', row.id);
    setTogglingRowId(null);
    if (error) {
      Alert.alert('Error saving', error.message);
      onChanged();
    }
  };

  // A row is "missing values" if none of its trackable fields have either a
  // typed-but-unsaved edit or an already-saved actual - partial entries (some
  // fields filled, others not) still count as missing so the gaps get caught.
  const isRowMissingValues = (row: WorkoutExerciseRow) =>
    exerciseFieldsFor(row.exercises).some((f) => {
      const raw = edits[row.id]?.[f.key];
      if (raw !== undefined && raw.trim() !== '') return false;
      return fieldValue(row, 'actual', f.key) == null;
    });

  // Finalizes the workout: any field with a typed edit or existing saved
  // actual is left as-is; any field that's still empty falls back to that
  // exercise's target value when useTargetFallback is true. Every row is
  // marked completed - finishing the workout finishes all of its exercises.
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
    const reason = missedChip === 'Other' && missedNote.trim() ? `Other: ${missedNote.trim()}` : missedNote.trim() ? `${missedChip}: ${missedNote.trim()}` : missedChip;
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
          <View key={row.id} style={[styles.exerciseSubCard, row.completed && styles.exerciseSubCardComplete]}>
            <View style={styles.exerciseSubCardHeader}>
              <Text style={styles.exerciseName}>{row.exercises.name}</Text>
              {canEdit && (
                <Pressable
                  style={[styles.completeButton, row.completed && styles.undoButton]}
                  onPress={() => toggleRowComplete(row)}
                  disabled={togglingRowId === row.id}
                >
                  <Text style={[styles.completeButtonText, row.completed && styles.undoButtonText]}>
                    {row.completed ? 'Undo' : 'Complete'}
                  </Text>
                </Pressable>
              )}
            </View>
            <Text style={styles.exerciseCategory}>{describeTargets(row)}</Text>
            {canEdit && fields.length > 0 && (
              <View style={styles.fieldRow}>
                {fields.map((f) =>
                  f.key === 'duration_seconds' ? (
                    <View key={f.key} style={styles.fieldBox}>
                      <DurationInput
                        label={`Actual ${fieldLabel(f, row.exercises)}`}
                        totalSeconds={valueFor(row, f.key) === '' ? null : Number(valueFor(row, f.key))}
                        onChange={(sec) => setEdit(row.id, 'duration_seconds', sec == null ? '' : String(sec))}
                        disabled={row.completed}
                      />
                    </View>
                  ) : (
                    <View key={f.key} style={styles.fieldBox}>
                      <Text style={styles.fieldLabel}>Actual {fieldLabel(f, row.exercises)}</Text>
                      <TextInput
                        style={[styles.fieldInput, row.completed && styles.fieldInputDisabled]}
                        keyboardType={f.keyboard}
                        placeholder={f.placeholder}
                        value={valueFor(row, f.key)}
                        onChangeText={(v) => setEdit(row.id, f.key, v)}
                        editable={!row.completed}
                      />
                    </View>
                  )
                )}
              </View>
            )}
          </View>
        );
      })}

      {workout.status === 'missed' && workout.missed_reason && (
        <Text style={styles.missedReasonText}>Missed: {workout.missed_reason}</Text>
      )}

      {canEdit ? (
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

      {canEdit && showMissedPicker && (
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
          <TextInput
            style={styles.input}
            placeholder="Optional note"
            value={missedNote}
            onChangeText={setMissedNote}
          />
          <View style={styles.modalButtons}>
            <Pressable
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => setShowMissedPicker(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalButton, styles.saveButton]} onPress={confirmMissed}>
              <Text style={styles.saveButtonText}>Confirm Missed</Text>
            </Pressable>
          </View>
        </View>
      )}

      {canEdit && !showMissedPicker && (
        <View style={styles.dayCardActions}>
          <Pressable style={styles.smallActionButton} onPress={() => persistActuals()} disabled={saving}>
            <Text style={styles.smallActionText}>{saving ? 'Saving...' : 'Save'}</Text>
          </Pressable>
          {workout.status === 'scheduled' && (
            <>
              <Pressable style={styles.smallActionButtonPrimary} onPress={markComplete} disabled={saving}>
                <Text style={styles.smallActionTextPrimary}>Complete Workout</Text>
              </Pressable>
              <Pressable style={styles.smallActionButton} onPress={() => setShowMissedPicker(true)}>
                <Text style={styles.smallActionText}>Mark Missed</Text>
              </Pressable>
            </>
          )}
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
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold' },
  athleteName: { fontSize: 16, color: '#4C9BE8', marginBottom: 16 },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  togglePill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  togglePillSmall: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  togglePillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  toggleText: { fontSize: 13, color: '#444' },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  assignButton: {
    backgroundColor: '#4C9BE8',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  assignButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cancelAllButton: {
    borderWidth: 1,
    borderColor: '#D6524F',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  cancelAllButtonText: { color: '#D6524F', fontSize: 13, fontWeight: '600' },
  legendRow: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 12, color: '#666' },

  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginVertical: 20 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '90%',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  dayModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  closeText: { color: '#4C9BE8', fontWeight: '600' },

  dayCard: { backgroundColor: '#f7f8fa', borderRadius: 14, padding: 16, marginBottom: 14 },
  dayCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusBadge: { fontSize: 11, fontWeight: '700' },
  exerciseSubCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  exerciseSubCardComplete: { backgroundColor: '#E6F7EF', borderColor: '#3FB98A' },
  exerciseSubCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  completeButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#3FB98A' },
  completeButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  undoButton: { backgroundColor: '#eee' },
  undoButtonText: { color: '#333' },
  fieldInputDisabled: { backgroundColor: '#f0f0f0', color: '#999' },
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
  exerciseName: { fontSize: 15, fontWeight: '600' },
  exerciseCategory: { fontSize: 12, color: '#888', marginTop: 2 },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  fieldBox: { minWidth: 90 },
  fieldLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  missedReasonText: { fontSize: 12, color: '#D6524F', marginTop: 4, fontStyle: 'italic' },
  missedPicker: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  dayCardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  smallActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  smallActionText: { fontSize: 12, fontWeight: '600', color: '#444' },
  smallActionButtonPrimary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#3FB98A' },
  smallActionTextPrimary: { fontSize: 12, fontWeight: '600', color: '#fff' },
  deleteText: { fontSize: 12, fontWeight: '600', color: '#D6524F' },

  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalButton: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  cancelButton: { backgroundColor: '#eee' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  saveButton: { backgroundColor: '#4C9BE8' },
  saveButtonText: { color: '#fff', fontWeight: '600' },
  addExerciseButton: {
    borderWidth: 1,
    borderColor: '#4C9BE8',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  addExerciseButtonText: { color: '#4C9BE8', fontWeight: '600' },
});
