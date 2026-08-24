import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { supabase } from '../supabase';

type AccessGrant = {
  id: number;
  invited_email: string;
  access_level: string;
  status: string;
  relationship_label: string | null;
};

export default function AthleteAccessScreen() {
  const { athleteId, athleteName } = useLocalSearchParams();

  const [isOwner, setIsOwner] = useState(false);
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [accessLevel, setAccessLevel] = useState<'view' | 'full'>('view');
  const [saving, setSaving] = useState(false);

  const RELATIONSHIP_OPTIONS = ['Coach', 'Athlete', 'Parent'];

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();

    const { data: athlete } = await supabase
      .from('athletes')
      .select('user_id')
      .eq('id', athleteId)
      .single();

    if (user && athlete) {
      setIsOwner(athlete.user_id === user.id);
    }

    const { data, error } = await supabase
      .from('athlete_access')
      .select('*')
      .eq('athlete_id', athleteId);

    if (error) {
      console.log('Error loading access:', error.message);
    } else {
      setGrants(data as AccessGrant[]);
    }
    setLoading(false);
  }, [athleteId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const inviteAccess = async () => {
    if (!email.trim()) {
      Alert.alert('Missing email', 'Enter an email address to invite.');
      return;
    }
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('athlete_access').insert({
      athlete_id: athleteId,
      invited_email: email.trim().toLowerCase(),
      access_level: accessLevel,
      relationship_label: label.trim() || null,
      status: 'pending',
    });

    setSaving(false);
    if (error) {
      Alert.alert('Error sending invite', error.message);
      return;
    }

    setEmail('');
    setLabel('');
    setAccessLevel('view');
    loadData();
  };

  const revokeAccess = (grant: AccessGrant) => {
    Alert.alert(
      'Revoke access?',
      `Remove access for ${grant.relationship_label || grant.invited_email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('athlete_access').delete().eq('id', grant.id);
            if (error) {
              Alert.alert('Error revoking access', error.message);
            } else {
              loadData();
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Access — {athleteName}</Text>

      <FlatList
        data={grants}
        keyExtractor={(item) => item.id.toString()}
        ListHeaderComponent={
          <>
            {isOwner && (
              <View style={styles.inviteCard}>
                <Text style={styles.sectionLabel}>Invite Someone</Text>

                <TextInput
                  style={styles.input}
                  placeholder="Email address"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <Text style={styles.smallLabel}>Relationship</Text>
                <View style={styles.levelRow}>
                  {RELATIONSHIP_OPTIONS.map((option) => (
                    <Pressable
                      key={option}
                      style={[styles.levelPill, label === option && styles.levelPillActive]}
                      onPress={() => setLabel(option)}
                    >
                      <Text style={[styles.levelText, label === option && styles.levelTextActive]}>
                        {option}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.levelRow}>
                  <Pressable
                    style={[styles.levelPill, accessLevel === 'view' && styles.levelPillActive]}
                    onPress={() => setAccessLevel('view')}
                  >
                    <Text style={[styles.levelText, accessLevel === 'view' && styles.levelTextActive]}>
                      View Only
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.levelPill, accessLevel === 'full' && styles.levelPillActive]}
                    onPress={() => setAccessLevel('full')}
                  >
                    <Text style={[styles.levelText, accessLevel === 'full' && styles.levelTextActive]}>
                      Full Access
                    </Text>
                  </Pressable>
                </View>

                <Pressable style={styles.inviteButton} onPress={inviteAccess} disabled={saving}>
                  <Text style={styles.inviteButtonText}>{saving ? 'Sending...' : 'Send Invite'}</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.sectionLabel}>Shared With</Text>
          </>
        }
        renderItem={({ item }) => (
          <View style={styles.grantRow}>
            <View>
              <Text style={styles.grantName}>{item.relationship_label || item.invited_email}</Text>
              {item.relationship_label && (
                <Text style={styles.grantEmail}>{item.invited_email}</Text>
              )}
              <View style={styles.badgeRow}>
                <Text style={styles.badge}>{item.access_level === 'full' ? 'Full Access' : 'View Only'}</Text>
                <Text style={[styles.badge, item.status === 'pending' && styles.badgePending]}>
                  {item.status}
                </Text>
              </View>
            </View>
            {isOwner && (
              <Pressable onPress={() => revokeAccess(item)}>
                <Text style={styles.revokeText}>Revoke</Text>
              </Pressable>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No one else has access yet.</Text>}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  sectionLabel: { fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 10 },
  inviteCard: { backgroundColor: '#f7f8fa', borderRadius: 14, borderWidth: 1, borderColor: '#eee', padding: 16, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 14, backgroundColor: '#fff' },
  levelRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  levelPill: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  levelPillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  levelText: { fontSize: 13, color: '#444' },
  levelTextActive: { color: '#fff', fontWeight: '600' },
  inviteButton: { backgroundColor: '#3FB98A', borderRadius: 10, padding: 14, alignItems: 'center' },
  inviteButtonText: { color: '#fff', fontWeight: '600' },
  grantRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 14, marginBottom: 8 },
  grantName: { fontSize: 15, fontWeight: '600' },
  grantEmail: { fontSize: 12, color: '#888', marginTop: 1 },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  badge: { fontSize: 11, color: '#3FB98A', backgroundColor: '#3FB98A18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  badgePending: { color: '#E8A93B', backgroundColor: '#E8A93B18' },
  revokeText: { color: '#D6524F', fontSize: 13, fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginTop: 20 },
  smallLabel: { fontSize: 11, color: '#888', marginBottom: 6, textTransform: 'uppercase' },
});
