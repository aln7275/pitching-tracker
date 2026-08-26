import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';

type Athlete = {
  id: number;
  name: string;
  birthdate: string | null;
};

function calculateAge(birthdate: string | null): number | null {
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

export default function AthleteListScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [birthdate, setBirthdate] = useState<Date | null>(null);
  const [showBirthdatePicker, setShowBirthdatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [newWorkoutCounts, setNewWorkoutCounts] = useState<Record<number, number>>({});
  const [newMessageCounts, setNewMessageCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    fetchAthletes();
  }, []);

  const fetchNewWorkoutCounts = useCallback(async (athleteList: Athlete[]) => {
    if (athleteList.length === 0) {
      setNewWorkoutCounts({});
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const athleteIds = athleteList.map((a) => a.id);
    const { data: views } = await supabase
      .from('workout_views')
      .select('athlete_id, last_viewed_at')
      .eq('user_id', user.id)
      .in('athlete_id', athleteIds);

    const viewedAt = new Map<number, string>((views ?? []).map((v) => [v.athlete_id, v.last_viewed_at]));

    const { data: workouts } = await supabase
      .from('workouts')
      .select('athlete_id, created_at')
      .in('athlete_id', athleteIds);

    const counts: Record<number, number> = {};
    (workouts ?? []).forEach((w) => {
      const cutoff = viewedAt.get(w.athlete_id);
      // No view row yet means this user has never opened that athlete's
      // Workouts screen - everything counts as new until they do, once.
      if (!cutoff || w.created_at > cutoff) {
        counts[w.athlete_id] = (counts[w.athlete_id] ?? 0) + 1;
      }
    });
    setNewWorkoutCounts(counts);
  }, []);

  const fetchNewMessageCounts = useCallback(async (athleteList: Athlete[]) => {
    if (athleteList.length === 0) {
      setNewMessageCounts({});
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const athleteIds = athleteList.map((a) => a.id);
    const { data: views } = await supabase
      .from('message_views')
      .select('athlete_id, last_viewed_at')
      .eq('user_id', user.id)
      .in('athlete_id', athleteIds);

    const viewedAt = new Map<number, string>((views ?? []).map((v) => [v.athlete_id, v.last_viewed_at]));

    const { data: messages } = await supabase
      .from('messages')
      .select('athlete_id, created_at')
      .in('athlete_id', athleteIds);

    const counts: Record<number, number> = {};
    (messages ?? []).forEach((m) => {
      const cutoff = viewedAt.get(m.athlete_id);
      if (!cutoff || m.created_at > cutoff) {
        counts[m.athlete_id] = (counts[m.athlete_id] ?? 0) + 1;
      }
    });
    setNewMessageCounts(counts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (athletes.length > 0) {
        fetchNewWorkoutCounts(athletes);
        fetchNewMessageCounts(athletes);
      }
    }, [athletes, fetchNewWorkoutCounts, fetchNewMessageCounts])
  );

  const fetchAthletes = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('athletes').select('*');
    if (error) {
      console.log('Error fetching athletes:', error.message);
    } else {
      setAthletes(data as Athlete[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .single();
      if (data?.name) setProfileName(data.name);
    };
    fetchProfile();
  }, []);

   const saveProfileName = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
        const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, name: profileName.trim() });
    if (error) {
      Alert.alert('Error saving name', error.message);
    } else {
      setEditingName(false);
    }
  };

  const addAthlete = async () => {
    if (!newName.trim()) return;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Not logged in', 'Please log in again.');
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('athletes').insert({
      name: newName.trim(),
      user_id: user.id,
      birthdate: birthdate ? birthdate.toISOString().split('T')[0] : null,
    });

    setSaving(false);
    if (error) {
      console.log('Error adding athlete:', error.message);
      return;
    }
    setNewName('');
    setBirthdate(null);
    setModalVisible(false);
    fetchAthletes();
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

      return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Athletes</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={styles.addButton} onPress={() => setModalVisible(true)}>
            <Text style={styles.addButtonText}>+ Add</Text>
          </Pressable>
          <Pressable
            style={styles.logoutButton}
            onPress={async () => {
              await signOut();
              router.replace('/');
            }}
          >
            <Text style={styles.logoutButtonText}>Log Out</Text>
          </Pressable>
        </View>
      </View>

         {editingName ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            value={profileName}
            onChangeText={setProfileName}
            placeholder="Your name"
            autoFocus
          />
          <Pressable style={styles.addButton} onPress={saveProfileName}>
            <Text style={styles.addButtonText}>Save</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setEditingName(true)} style={{ marginBottom: 16 }}>
          <Text style={{ color: '#4C9BE8', fontSize: 14 }}>
            {profileName ? `👤 ${profileName} (tap to edit)` : '👤 Set your name'}
          </Text>
        </Pressable>
      )}

      <FlatList
        data={athletes}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <Pressable
            style={styles.athleteRow}
            onPress={() => router.push({ pathname: '/athlete', params: { id: item.id, name: item.name } })}
          >
            <View style={styles.athleteRowHeader}>
              <Text style={styles.athleteName}>{item.name}</Text>
              {!!newWorkoutCounts[item.id] && (
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>
                    {newWorkoutCounts[item.id]} new workout{newWorkoutCounts[item.id] === 1 ? '' : 's'}
                  </Text>
                </View>
              )}
              {!!newMessageCounts[item.id] && (
                <View style={styles.newMessageBadge}>
                  <Text style={styles.newBadgeText}>
                    {newMessageCounts[item.id]} new message{newMessageCounts[item.id] === 1 ? '' : 's'}
                  </Text>
                </View>
              )}
            </View>
            {calculateAge(item.birthdate) !== null && (
              <Text style={styles.athleteAge}>Age {calculateAge(item.birthdate)}</Text>
            )}
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No athletes yet.</Text>}
      />

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Athlete</Text>
            <TextInput
              style={styles.input}
              placeholder="Athlete name"
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <Pressable style={styles.input} onPress={() => setShowBirthdatePicker(true)}>
              <Text style={{ color: birthdate ? '#000' : '#999' }}>
                {birthdate ? birthdate.toLocaleDateString() : 'Birthdate (optional)'}
              </Text>
            </Pressable>

            {showBirthdatePicker && (
              <DateTimePicker
                value={birthdate ?? new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selectedDate) => {
                  setShowBirthdatePicker(false);
                  if (selectedDate) setBirthdate(selectedDate);
                }}
              />
            )}
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setModalVisible(false);
                  setNewName('');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.saveButton]}
                onPress={addAthlete}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  addButton: {
    backgroundColor: '#4C9BE8',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  logoutButton: {
  backgroundColor: '#eee',
  paddingHorizontal: 16,
  paddingVertical: 8,
  borderRadius: 8,
},
logoutButtonText: {
  color: '#333',
  fontWeight: '600',
},
  athleteRow: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 10,
  },
  athleteRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  athleteName: {
    fontSize: 18,
  },
  athleteAge: { fontSize: 13, color: '#888', marginTop: 2 },
  newBadge: { backgroundColor: '#D6524F', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  newMessageBadge: { backgroundColor: '#4C9BE8', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  newBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyText: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    marginTop: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#eee',
  },
  cancelButtonText: {
    color: '#333',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#4C9BE8',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
