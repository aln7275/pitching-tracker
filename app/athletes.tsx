import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HomeIcon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';

type Athlete = {
  id: number;
  name: string;
  birthdate: string | null;
  user_id: string;
  archived: boolean;
};

type ActiveGrant = { id: number; granted_to_user_id: string | null; invited_email: string; relationship_label: string | null };

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
  const [newWorkoutCounts, setNewWorkoutCounts] = useState<Record<number, number>>({});
  const [newMessageCounts, setNewMessageCounts] = useState<Record<number, number>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [removeAthlete, setRemoveAthlete] = useState<Athlete | null>(null);
  const [removeStep, setRemoveStep] = useState<'choose' | 'pickTransfer'>('choose');
  const [removeGrants, setRemoveGrants] = useState<(ActiveGrant & { displayName: string })[]>([]);
  const [removeLoading, setRemoveLoading] = useState(false);

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
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);
    })();
  }, []);

  const openRemoveFlow = async (athlete: Athlete) => {
    if (athlete.user_id !== currentUserId) {
      Alert.alert(
        'Remove yourself from this athlete?',
        `You'll lose access to ${athlete.name}. The owner would need to re-invite you to get it back.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              const { data: grant } = await supabase
                .from('athlete_access')
                .select('id')
                .eq('athlete_id', athlete.id)
                .eq('granted_to_user_id', currentUserId)
                .eq('status', 'active')
                .maybeSingle();
              if (grant) {
                await supabase.from('athlete_access').update({ status: 'inactive' }).eq('id', grant.id);
                fetchAthletes();
              }
            },
          },
        ]
      );
      return;
    }

    setRemoveLoading(true);
    const { data: grants } = await supabase
      .from('athlete_access')
      .select('id, granted_to_user_id, invited_email, relationship_label')
      .eq('athlete_id', athlete.id)
      .eq('status', 'active');

    const rows = (grants ?? []) as ActiveGrant[];
    const userIds = rows.map((g) => g.granted_to_user_id).filter((x): x is string => x !== null);
    let nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', userIds);
      profiles?.forEach((p) => {
        if (p.name) nameMap[p.id] = p.name;
      });
    }
    setRemoveGrants(
      rows.map((g) => ({
        ...g,
        displayName: (g.granted_to_user_id && nameMap[g.granted_to_user_id]) || g.relationship_label || g.invited_email,
      }))
    );
    setRemoveStep('choose');
    setRemoveAthlete(athlete);
    setRemoveLoading(false);
  };

  const archiveAthlete = () => {
    if (!removeAthlete) return;
    Alert.alert(
      'Archive this athlete?',
      `${removeAthlete.name} will be hidden from the calendar and you won't be able to start new workouts, bullpens, or games for them. They'll still show in this list, and you can un-archive anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('athletes').update({ archived: true }).eq('id', removeAthlete.id);
            setRemoveAthlete(null);
            fetchAthletes();
          },
        },
      ]
    );
  };

  const transferAndRemove = (grant: ActiveGrant & { displayName: string }) => {
    if (!removeAthlete) return;
    Alert.alert(
      'Transfer and remove yourself?',
      `${grant.displayName} will become the new owner of ${removeAthlete.name}. You will lose all access - this can't be undone by you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer and Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('transfer_ownership', {
              p_athlete_id: removeAthlete.id,
              p_new_owner_user_id: grant.granted_to_user_id,
              p_remove_departing_owner: true,
            });
            if (error) {
              Alert.alert('Error transferring ownership', error.message);
              return;
            }
            setRemoveAthlete(null);
            fetchAthletes();
          },
        },
      ]
    );
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
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Pressable onPress={() => router.push('/home')} hitSlop={8}>
            <HomeIcon color="#4C9BE8" size={20} />
          </Pressable>
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
            {item.archived && (
              <View style={styles.archivedBadge}>
                <Text style={styles.archivedBadgeText}>Archived — consider transfer</Text>
              </View>
            )}
            <Pressable onPress={() => openRemoveFlow(item)} hitSlop={8} style={styles.removeLink}>
              <Text style={styles.removeLinkText}>Remove</Text>
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No athletes yet.</Text>}
      />

      <Modal visible={!!removeAthlete} animationType="slide" transparent onRequestClose={() => setRemoveAthlete(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{removeAthlete?.name}</Text>
            {removeLoading ? (
              <ActivityIndicator style={{ marginVertical: 20 }} />
            ) : removeStep === 'choose' ? (
              <>
                <Pressable
                  style={styles.removeOptionButton}
                  onPress={() => (removeGrants.length > 0 ? setRemoveStep('pickTransfer') : Alert.alert('No one to transfer to', 'No one else has active access to this athlete yet.'))}
                >
                  <Text style={styles.removeOptionTitle}>Transfer and Remove</Text>
                  <Text style={styles.removeOptionSubtitle}>
                    Make someone else the owner and lose all your own access.
                  </Text>
                </Pressable>
                <Pressable style={styles.removeOptionButton} onPress={archiveAthlete}>
                  <Text style={styles.removeOptionTitle}>Archive Without Transfer</Text>
                  <Text style={styles.removeOptionSubtitle}>
                    Hide from the calendar and stop new sessions, without giving up ownership.
                  </Text>
                </Pressable>
                <Pressable style={styles.cancelButton} onPress={() => setRemoveAthlete(null)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.smallLabel}>Choose the new owner</Text>
                {removeGrants.map((g) => (
                  <Pressable key={g.id} style={styles.transferPickRow} onPress={() => transferAndRemove(g)}>
                    <Text style={styles.transferPickName}>{g.displayName}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.cancelButton} onPress={() => setRemoveStep('choose')}>
                  <Text style={styles.cancelButtonText}>Back</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

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
  archivedBadge: { alignSelf: 'flex-start', backgroundColor: '#E8A93B18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  archivedBadgeText: { color: '#E8A93B', fontSize: 11, fontWeight: '700' },
  removeLink: { alignSelf: 'flex-end', marginTop: 8 },
  removeLinkText: { color: '#D6524F', fontSize: 12, fontWeight: '600' },
  removeOptionButton: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 14, marginBottom: 10, backgroundColor: '#f7f8fa' },
  removeOptionTitle: { fontSize: 15, fontWeight: '600', color: '#222' },
  removeOptionSubtitle: { fontSize: 12, color: '#888', marginTop: 4 },
  transferPickRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  transferPickName: { fontSize: 16, color: '#333' },
  smallLabel: { fontSize: 11, color: '#888', marginBottom: 10, textTransform: 'uppercase' },
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
