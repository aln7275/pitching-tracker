import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { HomeButton } from '../components/HomeButton';
import { supabase } from '../supabase';
import { WorkoutTemplate } from '../types/templates';

export default function TemplatesScreen() {
  const router = useRouter();
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    // RLS already limits this to visible presets (not hidden for this user)
    // plus the user's own templates.
    const { data, error } = await supabase.from('workout_templates').select('*').order('name');
    if (error) console.log('Error fetching templates:', error.message);
    else setTemplates(data as WorkoutTemplate[]);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTemplates();
    }, [fetchTemplates])
  );

  const hidePreset = (template: WorkoutTemplate) => {
    Alert.alert('Hide this template?', `"${template.name}" will no longer show in your list. It stays available for everyone else.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Hide',
        onPress: async () => {
          if (!userId) return;
          await supabase.from('workout_template_hidden_for_user').upsert({ user_id: userId, template_id: template.id });
          fetchTemplates();
        },
      },
    ]);
  };

  const deleteOwn = (template: WorkoutTemplate) => {
    Alert.alert('Delete this template?', `"${template.name}" will be permanently deleted. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('workout_templates').delete().eq('id', template.id);
          fetchTemplates();
        },
      },
    ]);
  };

  const presets = templates.filter((t) => t.is_preset);
  const mine = templates.filter((t) => !t.is_preset);

  return (
    <View style={styles.container}>
      <HomeButton />
      <Text style={styles.title}>My Templates</Text>

      <Pressable style={styles.button} onPress={() => router.push('/template-edit')}>
        <Text style={styles.buttonText}>+ Create Custom Workout</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : (
        <FlatList
          data={[...mine, ...presets]}
          keyExtractor={(item) => item.id.toString()}
          ListHeaderComponent={
            mine.length > 0 ? <Text style={styles.sectionTitle}>My Templates</Text> : null
          }
          renderItem={({ item, index }) => (
            <>
              {index === mine.length && <Text style={styles.sectionTitle}>Presets</Text>}
              <Pressable
                style={styles.row}
                onPress={() => router.push({ pathname: '/template-edit', params: { templateId: item.id } })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.name}</Text>
                  {item.description && <Text style={styles.rowDescription}>{item.description}</Text>}
                </View>
                <Pressable onPress={() => (item.is_preset ? hidePreset(item) : deleteOwn(item))} hitSlop={8}>
                  <Text style={styles.removeText}>{item.is_preset ? 'Hide' : 'Delete'}</Text>
                </Pressable>
              </Pressable>
            </>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No templates yet.</Text>}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 20 },
  button: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: {
    fontSize: 13,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowName: { fontSize: 15, fontWeight: '600', color: '#222' },
  rowDescription: { fontSize: 12, color: '#888', marginTop: 2 },
  removeText: { fontSize: 12, color: '#D6524F', fontWeight: '600', marginLeft: 10 },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginVertical: 20 },
});
