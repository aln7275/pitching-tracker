import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DurationInput } from '../components/DurationInput';
import { HomeButton } from '../components/HomeButton';
import { supabase } from '../supabase';
import { WorkoutTemplate, WorkoutTemplateExerciseRow } from '../types/templates';
import {
  DistanceUnit,
  Exercise,
  ExerciseFieldKey,
  exerciseFieldsFor,
  exerciseSuggestedDefault,
  fieldLabel,
} from '../types/workout';

type SelectedExercise = {
  key: string;
  exercise: Exercise;
  values: Partial<Record<ExerciseFieldKey, string>>;
};

function fieldsForSave(row: SelectedExercise) {
  const out: Record<string, number | string | null> = {};
  exerciseFieldsFor(row.exercise).forEach((f) => {
    const raw = row.values[f.key];
    out[`default_${f.key}`] = raw === undefined || raw.trim() === '' ? null : f.parse(raw);
  });
  return out;
}

export default function TemplateEditScreen() {
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  const router = useRouter();
  const isNewTemplate = !templateId;

  const [userId, setUserId] = useState<string | null>(null);
  const [originalTemplate, setOriginalTemplate] = useState<WorkoutTemplate | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<SelectedExercise[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNewTemplate);

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');

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

  useEffect(() => {
    if (!templateId) return;
    (async () => {
      const { data: templateData, error: templateError } = await supabase
        .from('workout_templates')
        .select('*')
        .eq('id', templateId)
        .single();
      if (templateError || !templateData) {
        Alert.alert('Error loading template', templateError?.message ?? 'Unknown error');
        setLoading(false);
        return;
      }
      const { data: rowsData } = await supabase
        .from('workout_template_exercises')
        .select('*, exercises(*)')
        .eq('template_id', templateId)
        .order('order_index');

      setOriginalTemplate(templateData as WorkoutTemplate);
      setName(templateData.name);
      setDescription(templateData.description ?? '');

      const rows = (rowsData ?? []) as WorkoutTemplateExerciseRow[];
      setSelected(
        rows.map((r) => {
          const values: Partial<Record<ExerciseFieldKey, string>> = {};
          exerciseFieldsFor(r.exercises).forEach((f) => {
            const v = (r as any)[`default_${f.key}`];
            if (v != null) values[f.key] = f.format(v);
          });
          return { key: `existing-${r.id}`, exercise: r.exercises, values };
        })
      );
      setLoading(false);
    })();
  }, [templateId]);

  const isOwnTemplate = !!(originalTemplate && originalTemplate.created_by === userId && !originalTemplate.is_preset);

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
    const initialValues: Partial<Record<ExerciseFieldKey, string>> = {};
    exerciseFieldsFor(exercise).forEach((f) => {
      const suggested = exerciseSuggestedDefault(exercise, f.key);
      if (suggested != null) initialValues[f.key] = f.format(suggested);
    });
    setSelected((prev) => [...prev, { key: `${exercise.id}-${Date.now()}`, exercise, values: initialValues }]);
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

  // RLS on workout_templates SELECT already returns only what's visible to
  // this user (their own templates + non-hidden presets) - so a plain name
  // match among those rows IS the "no two visible templates share a name" check.
  const checkNameConflict = async (candidateName: string, excludeId: number | null) => {
    const { data } = await supabase.from('workout_templates').select('id').eq('name', candidateName);
    return (data ?? []).some((t) => t.id !== excludeId);
  };

  const createTemplate = async (creatorId: string, templateName: string, descriptionText: string) => {
    const { data: newTemplate, error } = await supabase
      .from('workout_templates')
      .insert({ created_by: creatorId, is_preset: false, name: templateName, description: descriptionText.trim() || null })
      .select()
      .single();
    if (error || !newTemplate) {
      Alert.alert('Error saving template', error?.message ?? 'Unknown error');
      return null;
    }
    if (selected.length > 0) {
      const rows = selected.map((row, i) => ({
        template_id: newTemplate.id,
        exercise_id: row.exercise.id,
        order_index: i,
        ...fieldsForSave(row),
      }));
      const { error: exError } = await supabase.from('workout_template_exercises').insert(rows);
      if (exError) {
        Alert.alert('Error saving exercises', exError.message);
        return null;
      }
    }
    return newTemplate;
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Missing name', 'Enter a template name.');
      return;
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    if (isNewTemplate) {
      if (await checkNameConflict(trimmedName, null)) {
        Alert.alert('Name already used', `You already have a template named "${trimmedName}".`);
        setSaving(false);
        return;
      }
      const created = await createTemplate(user.id, trimmedName, description);
      setSaving(false);
      if (created) router.back();
      return;
    }

    if (isOwnTemplate && originalTemplate) {
      if (await checkNameConflict(trimmedName, originalTemplate.id)) {
        Alert.alert('Name already used', `You already have a template named "${trimmedName}".`);
        setSaving(false);
        return;
      }
      await supabase
        .from('workout_templates')
        .update({ name: trimmedName, description: description.trim() || null })
        .eq('id', originalTemplate.id);
      // Replace exercise rows wholesale - simplest correct approach since the
      // exercise list/order can change freely between edits.
      await supabase.from('workout_template_exercises').delete().eq('template_id', originalTemplate.id);
      if (selected.length > 0) {
        const rows = selected.map((row, i) => ({
          template_id: originalTemplate.id,
          exercise_id: row.exercise.id,
          order_index: i,
          ...fieldsForSave(row),
        }));
        await supabase.from('workout_template_exercises').insert(rows);
      }
      setSaving(false);
      router.back();
      return;
    }

    // Editing a preset: fork a personal copy under the same name, then hide
    // the original for this user - never a real edit of the shared preset row.
    // Excludes the preset's own id, since keeping the name unchanged (the
    // common case) would otherwise "conflict" with the preset row itself.
    if (originalTemplate) {
      if (await checkNameConflict(trimmedName, originalTemplate.id)) {
        Alert.alert('Name already used', `You already have a template named "${trimmedName}".`);
        setSaving(false);
        return;
      }
      const created = await createTemplate(user.id, trimmedName, description);
      if (created && originalTemplate.is_preset) {
        await supabase
          .from('workout_template_hidden_for_user')
          .upsert({ user_id: user.id, template_id: originalTemplate.id });
      }
      setSaving(false);
      if (created) router.back();
    }
  };

  const confirmSaveAs = async () => {
    const trimmed = saveAsName.trim();
    if (!trimmed) {
      Alert.alert('Missing name', 'Enter a name for the new template.');
      return;
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    if (await checkNameConflict(trimmed, null)) {
      Alert.alert('Name already used', `You already have a template named "${trimmed}".`);
      setSaving(false);
      return;
    }
    const created = await createTemplate(user.id, trimmed, description);
    setSaving(false);
    if (created) {
      setShowSaveAs(false);
      router.back();
    }
  };

  const handleDeleteOrHide = () => {
    if (!originalTemplate || !userId) return;
    if (originalTemplate.is_preset) {
      Alert.alert('Hide this template?', `"${originalTemplate.name}" will no longer show in your list. It stays available for everyone else.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          onPress: async () => {
            await supabase
              .from('workout_template_hidden_for_user')
              .upsert({ user_id: userId, template_id: originalTemplate.id });
            router.back();
          },
        },
      ]);
    } else if (isOwnTemplate) {
      Alert.alert('Delete this template?', `"${originalTemplate.name}" will be permanently deleted. This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('workout_templates').delete().eq('id', originalTemplate.id);
            router.back();
          },
        },
      ]);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <HomeButton />
        <Text style={styles.title}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <HomeButton />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{isNewTemplate ? 'New Template' : originalTemplate?.is_preset ? 'Edit Preset' : 'Edit Template'}</Text>

        <TextInput style={styles.input} placeholder="Template name" value={name} onChangeText={setName} />
        <TextInput
          style={styles.input}
          placeholder="Description (optional)"
          value={description}
          onChangeText={setDescription}
        />

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

        <View style={styles.footerButtons}>
          <Pressable style={styles.cancelButton} onPress={() => router.back()}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.saveButtonMain} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveButtonMainText}>{saving ? 'Saving...' : 'Save'}</Text>
          </Pressable>
        </View>

        {!isNewTemplate && (
          <Pressable style={styles.saveAsButton} onPress={() => { setSaveAsName(''); setShowSaveAs(true); }}>
            <Text style={styles.saveAsButtonText}>Save As...</Text>
          </Pressable>
        )}

        {!isNewTemplate && (
          <Pressable style={styles.deleteButton} onPress={handleDeleteOrHide}>
            <Text style={styles.deleteButtonText}>
              {originalTemplate?.is_preset ? 'Hide This Template' : 'Delete This Template'}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal visible={pickerVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Exercise</Text>
            <TextInput style={styles.input} placeholder="Search exercises" value={search} onChangeText={setSearch} />
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
              {filteredExercises.length === 0 && <Text style={styles.noFieldsText}>No matching exercises.</Text>}
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={() => setPickerVisible(false)}>
                <Text style={styles.cancelButtonText}>Close</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.saveButton]} onPress={() => setCustomModalVisible(true)}>
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

      <Modal visible={showSaveAs} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Save As New Template</Text>
            <Text style={styles.smallLabel}>New name</Text>
            <TextInput style={styles.input} placeholder="e.g. Arm Care Day — Advanced" value={saveAsName} onChangeText={setSaveAsName} />
            <View style={styles.modalButtons}>
              <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={() => setShowSaveAs(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.saveButton]} onPress={confirmSaveAs} disabled={saving}>
                <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save As'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
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
  const [nameInput, setNameInput] = useState('');
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
    if (!nameInput.trim() || !category.trim()) {
      Alert.alert('Missing info', 'Enter a name and category.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('exercises')
      .insert({
        name: nameInput.trim(),
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
    setNameInput('');
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
          <TextInput style={styles.input} placeholder="Exercise name" value={nameInput} onChangeText={setNameInput} />
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
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  label: { fontSize: 12, color: '#666', marginBottom: 8, marginTop: 8, textTransform: 'uppercase' },
  smallLabel: { fontSize: 11, color: '#888', marginBottom: 6, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 12 },

  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  togglePillSmall: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  togglePillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  toggleText: { fontSize: 13, color: '#444' },
  toggleTextActive: { color: '#fff', fontWeight: '600' },

  exerciseCard: { backgroundColor: '#f7f8fa', borderRadius: 12, padding: 14, marginBottom: 10 },
  exerciseCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  exerciseName: { fontSize: 15, fontWeight: '600' },
  exerciseCategory: { fontSize: 12, color: '#888', marginTop: 2 },
  removeText: { fontSize: 12, color: '#D6524F', fontWeight: '600' },
  noFieldsText: { fontSize: 12, color: '#999', marginTop: 8, fontStyle: 'italic' },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  fieldBox: { minWidth: 90 },
  fieldLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  fieldInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, fontSize: 14, backgroundColor: '#fff' },

  addExerciseButton: { borderWidth: 1, borderColor: '#4C9BE8', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 20 },
  addExerciseButtonText: { color: '#4C9BE8', fontWeight: '600' },

  footerButtons: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cancelButton: { flex: 1, padding: 16, borderRadius: 10, backgroundColor: '#eee', alignItems: 'center' },
  cancelButtonText: { fontWeight: '600', color: '#333' },
  saveButtonMain: { flex: 1, padding: 16, borderRadius: 10, backgroundColor: '#4C9BE8', alignItems: 'center' },
  saveButtonMainText: { fontWeight: '600', color: '#fff' },

  saveAsButton: { borderWidth: 1, borderColor: '#4C9BE8', borderRadius: 10, padding: 13, alignItems: 'center', marginBottom: 12 },
  saveAsButtonText: { color: '#4C9BE8', fontSize: 14, fontWeight: '600' },
  deleteButton: { alignItems: 'center', padding: 10 },
  deleteButtonText: { color: '#D6524F', fontSize: 13, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: '85%' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalButton: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  saveButton: { backgroundColor: '#4C9BE8' },
  saveButtonText: { color: '#fff', fontWeight: '600' },

  categoryScroll: { marginBottom: 12, flexGrow: 0 },
  categoryPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#ddd', marginRight: 8 },
  pickerList: { maxHeight: 300, marginBottom: 8 },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  pickerRowName: { fontSize: 15, color: '#333' },
  pickerRowCategory: { fontSize: 12, color: '#999' },

  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  checkboxMark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  checkboxLabel: { fontSize: 14, color: '#333' },
});
