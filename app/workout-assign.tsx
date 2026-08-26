import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DurationInput } from '../components/DurationInput';
import { supabase } from '../supabase';
import {
  DistanceUnit,
  Exercise,
  ExerciseFieldKey,
  exerciseFieldsFor,
  fieldLabel,
  randomGroupId,
} from '../types/workout';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_OCCURRENCES = 52;

type SelectedExercise = {
  key: string;
  exercise: Exercise;
  values: Partial<Record<ExerciseFieldKey, string>>;
};

function toYMD(d: Date) {
  return d.toISOString().split('T')[0];
}

function computeOccurrences(
  start: Date,
  repeatMode: 'none' | 'weekly' | 'interval',
  weekdays: number[],
  intervalDays: number,
  until: Date | null
): string[] {
  if (repeatMode === 'none' || !until) return [toYMD(start)];

  const dates: string[] = [];
  const cursor = new Date(start);
  const untilTime = until.getTime();

  while (cursor.getTime() <= untilTime && dates.length < MAX_OCCURRENCES) {
    if (repeatMode === 'weekly') {
      if (weekdays.includes(cursor.getDay())) dates.push(toYMD(cursor));
      cursor.setDate(cursor.getDate() + 1);
    } else {
      dates.push(toYMD(cursor));
      cursor.setDate(cursor.getDate() + intervalDays);
    }
  }
  return dates;
}

function fieldsForSave(row: SelectedExercise, prefix: 'target' | 'actual') {
  const out: Record<string, number | string | null> = {};
  exerciseFieldsFor(row.exercise).forEach((f) => {
    const raw = row.values[f.key];
    out[`${prefix}_${f.key}`] = raw === undefined ? null : f.parse(raw);
  });
  return out;
}

export default function WorkoutAssignScreen() {
  const { athleteId, athleteName, date: dateParam } = useLocalSearchParams<{
    athleteId: string;
    athleteName: string;
    date?: string;
  }>();
  const router = useRouter();

  const initialDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
  const isFutureOrToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return initialDate >= today;
  }, []);

  const [mode, setMode] = useState<'assign' | 'log'>(isFutureOrToday ? 'assign' : 'log');
  const [date, setDate] = useState(initialDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [selected, setSelected] = useState<SelectedExercise[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [customModalVisible, setCustomModalVisible] = useState(false);

  const [repeatMode, setRepeatMode] = useState<'none' | 'weekly' | 'interval'>('none');
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([]);
  const [intervalDays, setIntervalDays] = useState('7');
  const [repeatUntil, setRepeatUntil] = useState<Date | null>(null);
  const [showRepeatUntilPicker, setShowRepeatUntilPicker] = useState(false);

  const fetchExercises = useCallback(async () => {
    const { data, error } = await supabase.from('exercises').select('*').order('category').order('name');
    if (error) console.log('Error fetching exercises:', error.message);
    else setExercises(data as Exercise[]);
  }, []);

  useEffect(() => {
    fetchExercises();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    })();
  }, [fetchExercises]);

  const categories = useMemo(() => {
    const set = new Set(exercises.map((e) => e.category));
    return ['All', ...Array.from(set).sort()];
  }, [exercises]);

  const filteredExercises = useMemo(() => {
    return exercises.filter((e) => {
      if (categoryFilter !== 'All' && e.category !== categoryFilter) return false;
      if (search.trim() && !e.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [exercises, categoryFilter, search]);

  const addExercise = (exercise: Exercise) => {
    setSelected((prev) => [...prev, { key: `${exercise.id}-${Date.now()}`, exercise, values: {} }]);
    setPickerVisible(false);
    setSearch('');
  };

  const removeExercise = (key: string) => {
    setSelected((prev) => prev.filter((r) => r.key !== key));
  };

  const setFieldValue = (key: string, field: ExerciseFieldKey, value: string) => {
    setSelected((prev) =>
      prev.map((r) => (r.key === key ? { ...r, values: { ...r.values, [field]: value } } : r))
    );
  };

  const toggleWeekday = (day: number) => {
    setRepeatWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const handleSave = async () => {
    if (mode === 'assign' && repeatMode !== 'none' && !repeatUntil) {
      Alert.alert('Missing end date', 'Pick a "Repeat until" date.');
      return;
    }
    if (mode === 'assign' && repeatMode === 'weekly' && repeatWeekdays.length === 0) {
      Alert.alert('Pick a day', 'Select at least one weekday to repeat on.');
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Not logged in', 'Please log in again.');
      setSaving(false);
      return;
    }

    const dates =
      mode === 'assign'
        ? computeOccurrences(date, repeatMode, repeatWeekdays, parseInt(intervalDays, 10) || 1, repeatUntil)
        : [toYMD(date)];
    const groupId = dates.length > 1 ? randomGroupId() : null;

    const workoutRows = dates.map((d) => ({
      athlete_id: athleteId,
      assigned_by: user.id,
      scheduled_date: d,
      title: title.trim() || null,
      status: mode === 'log' ? 'completed' : 'scheduled',
      notes: notes.trim() || null,
      recurrence_group_id: groupId,
    }));

    const { data: insertedWorkouts, error: workoutsError } = await supabase
      .from('workouts')
      .insert(workoutRows)
      .select();

    if (workoutsError || !insertedWorkouts) {
      Alert.alert('Error saving workout', workoutsError?.message ?? 'Unknown error');
      setSaving(false);
      return;
    }

    if (selected.length > 0) {
      const prefix = mode === 'assign' ? 'target' : 'actual';
      const exerciseRows = insertedWorkouts.flatMap((w) =>
        selected.map((row, i) => ({
          workout_id: w.id,
          exercise_id: row.exercise.id,
          order_index: i,
          completed: mode === 'log',
          ...fieldsForSave(row, prefix),
        }))
      );
      const { error: weError } = await supabase.from('workout_exercises').insert(exerciseRows);
      if (weError) {
        Alert.alert('Error saving exercises', weError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{mode === 'assign' ? 'Assign Workout' : 'Log Workout'}</Text>
      <Text style={styles.athleteName}>{athleteName}</Text>

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.togglePill, mode === 'assign' && styles.togglePillActive]}
          onPress={() => setMode('assign')}
        >
          <Text style={[styles.toggleText, mode === 'assign' && styles.toggleTextActive]}>Assign for later</Text>
        </Pressable>
        <Pressable
          style={[styles.togglePill, mode === 'log' && styles.togglePillActive]}
          onPress={() => setMode('log')}
        >
          <Text style={[styles.toggleText, mode === 'log' && styles.toggleTextActive]}>Log completed</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Date</Text>
      <Pressable style={styles.input} onPress={() => setShowDatePicker(true)}>
        <Text>{date.toLocaleDateString()}</Text>
      </Pressable>
      {showDatePicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedDate) => {
            setShowDatePicker(false);
            if (selectedDate) setDate(selectedDate);
          }}
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Title (optional, e.g. Tuesday Arm Care)"
        value={title}
        onChangeText={setTitle}
      />

      {mode === 'assign' && (
        <>
          <Text style={styles.label}>Repeat</Text>
          <View style={styles.toggleRow}>
            {(['none', 'weekly', 'interval'] as const).map((m) => (
              <Pressable
                key={m}
                style={[styles.togglePillSmall, repeatMode === m && styles.togglePillActive]}
                onPress={() => setRepeatMode(m)}
              >
                <Text style={[styles.toggleText, repeatMode === m && styles.toggleTextActive]}>
                  {m === 'none' ? 'Does not repeat' : m === 'weekly' ? 'Weekly' : 'Every N days'}
                </Text>
              </Pressable>
            ))}
          </View>

          {repeatMode === 'weekly' && (
            <View style={styles.weekdayRow}>
              {WEEKDAYS.map((label, i) => (
                <Pressable
                  key={label}
                  style={[styles.weekdayPill, repeatWeekdays.includes(i) && styles.togglePillActive]}
                  onPress={() => toggleWeekday(i)}
                >
                  <Text style={[styles.toggleText, repeatWeekdays.includes(i) && styles.toggleTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {repeatMode === 'interval' && (
            <View style={styles.intervalRow}>
              <Text style={styles.intervalLabel}>Every</Text>
              <TextInput
                style={styles.intervalInput}
                keyboardType="numeric"
                value={intervalDays}
                onChangeText={setIntervalDays}
              />
              <Text style={styles.intervalLabel}>days</Text>
            </View>
          )}

          {repeatMode !== 'none' && (
            <>
              <Pressable style={styles.input} onPress={() => setShowRepeatUntilPicker(true)}>
                <Text style={{ color: repeatUntil ? '#000' : '#999' }}>
                  {repeatUntil ? `Repeat until ${repeatUntil.toLocaleDateString()}` : 'Repeat until...'}
                </Text>
              </Pressable>
              {showRepeatUntilPicker && (
                <DateTimePicker
                  value={repeatUntil ?? date}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selectedDate) => {
                    setShowRepeatUntilPicker(false);
                    if (selectedDate) setRepeatUntil(selectedDate);
                  }}
                />
              )}
            </>
          )}
        </>
      )}

      <Text style={styles.label}>Exercises</Text>
      {selected.map((row) => {
        const fields = exerciseFieldsFor(row.exercise);
        return (
          <View key={row.key} style={styles.exerciseCard}>
            <View style={styles.exerciseCardHeader}>
              <View>
                <Text style={styles.exerciseName}>{row.exercise.name}</Text>
                <Text style={styles.exerciseCategory}>{row.exercise.category}</Text>
              </View>
              <Pressable onPress={() => removeExercise(row.key)}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
            {fields.length === 0 ? (
              <Text style={styles.noFieldsText}>No numbers to track for this exercise.</Text>
            ) : (
              <View style={styles.fieldRow}>
                {fields.map((f) =>
                  f.key === 'duration_seconds' ? (
                    <View key={f.key} style={styles.fieldBox}>
                      <DurationInput
                        label={fieldLabel(f, row.exercise)}
                        totalSeconds={row.values.duration_seconds ? Number(row.values.duration_seconds) : null}
                        onChange={(sec) => setFieldValue(row.key, 'duration_seconds', sec == null ? '' : String(sec))}
                      />
                    </View>
                  ) : (
                    <View key={f.key} style={styles.fieldBox}>
                      <Text style={styles.fieldLabel}>{fieldLabel(f, row.exercise)}</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType={f.keyboard}
                        placeholder={f.placeholder}
                        value={row.values[f.key] ?? ''}
                        onChangeText={(v) => setFieldValue(row.key, f.key, v)}
                      />
                    </View>
                  )
                )}
              </View>
            )}
          </View>
        );
      })}

      <Pressable style={styles.addExerciseButton} onPress={() => setPickerVisible(true)}>
        <Text style={styles.addExerciseButtonText}>+ Add Exercise</Text>
      </Pressable>

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Optional notes"
        multiline
      />

      <View style={styles.footerButtons}>
        <Pressable style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.submitButton} onPress={handleSave} disabled={saving}>
          <Text style={styles.submitButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
        </Pressable>
      </View>

      <Modal visible={pickerVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Exercise</Text>
            <TextInput
              style={styles.input}
              placeholder="Search exercises"
              value={search}
              onChangeText={setSearch}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
              {categories.map((c) => (
                <Pressable
                  key={c}
                  style={[styles.categoryPill, categoryFilter === c && styles.togglePillActive]}
                  onPress={() => setCategoryFilter(c)}
                >
                  <Text style={[styles.toggleText, categoryFilter === c && styles.toggleTextActive]}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView style={styles.pickerList}>
              {filteredExercises.map((e) => (
                <Pressable key={e.id} style={styles.pickerRow} onPress={() => addExercise(e)}>
                  <Text style={styles.pickerRowName}>{e.name}</Text>
                  <Text style={styles.pickerRowCategory}>{e.category}</Text>
                </Pressable>
              ))}
              {filteredExercises.length === 0 && (
                <Text style={styles.noFieldsText}>No matching exercises.</Text>
              )}
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setPickerVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Close</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.saveButton]}
                onPress={() => setCustomModalVisible(true)}
              >
                <Text style={styles.saveButtonText}>+ Custom Exercise</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <CustomExerciseModal
        visible={customModalVisible}
        userId={userId}
        onClose={() => setCustomModalVisible(false)}
        onCreated={(exercise) => {
          setExercises((prev) => [...prev, exercise]);
          setCustomModalVisible(false);
          addExercise(exercise);
        }}
      />
    </ScrollView>
  );
}

function CustomExerciseModal({
  visible,
  userId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
  onCreated: (exercise: Exercise) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('yd');
  const [flags, setFlags] = useState({
    requires_weight: false,
    requires_reps: true,
    requires_sets: true,
    requires_duration: false,
    requires_distance: false,
    requires_intensity: false,
  });
  const [saving, setSaving] = useState(false);

  const toggleFlag = (key: keyof typeof flags) => setFlags((prev) => ({ ...prev, [key]: !prev[key] }));

  const save = async () => {
    if (!userId) return;
    if (!name.trim() || !category.trim()) {
      Alert.alert('Missing info', 'Enter a name and category.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('exercises')
      .insert({
        name: name.trim(),
        category: category.trim(),
        created_by: userId,
        ...flags,
        ...(flags.requires_distance ? { distance_unit: distanceUnit } : {}),
      })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      Alert.alert('Error creating exercise', error?.message ?? 'Unknown error');
      return;
    }
    setName('');
    setCategory('');
    onCreated(data as Exercise);
  };

  const FLAG_LABELS: { key: keyof typeof flags; label: string }[] = [
    { key: 'requires_sets', label: 'Track Sets' },
    { key: 'requires_reps', label: 'Track Reps' },
    { key: 'requires_weight', label: 'Track Weight' },
    { key: 'requires_duration', label: 'Track Duration' },
    { key: 'requires_distance', label: 'Track Distance' },
    { key: 'requires_intensity', label: 'Track Intensity' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>New Custom Exercise</Text>
          <TextInput style={styles.input} placeholder="Exercise name" value={name} onChangeText={setName} />
          <TextInput
            style={styles.input}
            placeholder="Category (e.g. Strength, Mobility)"
            value={category}
            onChangeText={setCategory}
          />
          {FLAG_LABELS.map((f) => (
            <Pressable key={f.key} style={styles.checkboxRow} onPress={() => toggleFlag(f.key)}>
              <View style={[styles.checkbox, flags[f.key] && styles.checkboxChecked]}>
                {flags[f.key] && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>{f.label}</Text>
            </Pressable>
          ))}
          {flags.requires_distance && (
            <View style={styles.toggleRow}>
              {(['yd', 'ft', 'mi'] as const).map((u) => (
                <Pressable
                  key={u}
                  style={[styles.togglePillSmall, distanceUnit === u && styles.togglePillActive]}
                  onPress={() => setDistanceUnit(u)}
                >
                  <Text style={[styles.toggleText, distanceUnit === u && styles.toggleTextActive]}>{u}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.modalButtons}>
            <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalButton, styles.saveButton]} onPress={save} disabled={saving}>
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  title: { fontSize: 24, fontWeight: 'bold' },
  athleteName: { fontSize: 16, color: '#4C9BE8', marginBottom: 16 },
  label: { fontSize: 12, color: '#666', marginBottom: 8, marginTop: 8, textTransform: 'uppercase' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
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
  weekdayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  weekdayPill: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  intervalLabel: { fontSize: 14, color: '#444' },
  intervalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    width: 60,
    textAlign: 'center',
  },
  exerciseCard: {
    backgroundColor: '#f7f8fa',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  exerciseCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  exerciseName: { fontSize: 15, fontWeight: '600' },
  exerciseCategory: { fontSize: 12, color: '#888', marginTop: 2 },
  removeText: { fontSize: 12, color: '#D6524F', fontWeight: '600' },
  noFieldsText: { fontSize: 12, color: '#999', marginTop: 8, fontStyle: 'italic' },
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
  addExerciseButton: {
    borderWidth: 1,
    borderColor: '#4C9BE8',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  addExerciseButtonText: { color: '#4C9BE8', fontWeight: '600' },
  notesInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    minHeight: 60,
    marginBottom: 24,
    textAlignVertical: 'top',
  },
  footerButtons: { flexDirection: 'row', gap: 10 },
  cancelButton: { flex: 1, padding: 16, borderRadius: 10, backgroundColor: '#eee', alignItems: 'center' },
  cancelButtonText: { fontWeight: '600', color: '#333' },
  submitButton: { flex: 1, padding: 16, borderRadius: 10, backgroundColor: '#4C9BE8', alignItems: 'center' },
  submitButtonText: { fontWeight: '600', color: '#fff' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '85%',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalButton: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  saveButton: { backgroundColor: '#4C9BE8' },
  saveButtonText: { color: '#fff', fontWeight: '600' },

  categoryScroll: { marginBottom: 12, flexGrow: 0 },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    marginRight: 8,
  },
  pickerList: { maxHeight: 300, marginBottom: 8 },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  pickerRowName: { fontSize: 15, color: '#333' },
  pickerRowCategory: { fontSize: 12, color: '#999' },

  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  checkboxMark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  checkboxLabel: { fontSize: 14, color: '#333' },
});
