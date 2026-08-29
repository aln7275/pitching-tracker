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
import { HomeButton } from '../components/HomeButton';
import { supabase } from '../supabase';

type AccessGrant = {
  id: number;
  invited_email: string;
  access_level: string;
  status: string;
  relationship_label: string | null;
  granted_to_user_id: string | null;
  name: string | null;
};

type TransferRequest = {
  id: number;
  requested_by: string;
  status: string;
};

export default function AthleteAccessScreen() {
  const { athleteId, athleteName } = useLocalSearchParams();

  const [isOwner, setIsOwner] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [accessLevel, setAccessLevel] = useState<'view' | 'full'>('view');
  const [saving, setSaving] = useState(false);
  const [transferRequests, setTransferRequests] = useState<TransferRequest[]>([]);
  const [requestingTransfer, setRequestingTransfer] = useState(false);

  const RELATIONSHIP_OPTIONS = ['Coach', 'Athlete', 'Parent'];

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? null);

    const { data: athlete } = await supabase
      .from('athletes')
      .select('user_id')
      .eq('id', athleteId)
      .single();

    if (user && athlete) {
      setIsOwner(athlete.user_id === user.id);
    }

    const { data: requests } = await supabase
      .from('transfer_requests')
      .select('id, requested_by, status')
      .eq('athlete_id', athleteId)
      .eq('status', 'pending');
    setTransferRequests((requests ?? []) as TransferRequest[]);

    const { data, error } = await supabase
      .from('athlete_access')
      .select('*')
      .eq('athlete_id', athleteId);

    if (error) {
      console.log('Error loading access:', error.message);
    } else {
      setGrants(data as AccessGrant[]);

      const userIds = (data as AccessGrant[])
        .map((g) => g.granted_to_user_id)
        .filter((id): id is string => id !== null);

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name')
          .in('id', userIds);

        const nameMap: Record<string, string> = {};
        profiles?.forEach((p) => {
          if (p.name) nameMap[p.id] = p.name;
        });
        setProfileNames(nameMap);
      }
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
      `Remove access for ${(grant.granted_to_user_id && profileNames[grant.granted_to_user_id]) || grant.relationship_label || grant.invited_email}?`,
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

    const transferOwnership = (grant: AccessGrant) => {
    Alert.alert(
      'Transfer Ownership?',
       `Make ${(grant.granted_to_user_id && profileNames[grant.granted_to_user_id]) || grant.relationship_label || grant.invited_email} the new owner of ${athleteName}? You'll keep full access, but they'll control sharing and can remove your access going forward.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('transfer_ownership', {
              p_athlete_id: athleteId,
              p_new_owner_user_id: grant.granted_to_user_id,
            });
            if (error) {
              Alert.alert('Error transferring ownership', error.message);
            } else {
              Alert.alert('Ownership transferred');
              loadData();
            }
          },
        },
      ]
    );
  };

  const requestTransfer = async () => {
    if (!currentUserId) return;
    setRequestingTransfer(true);
    const { error } = await supabase.from('transfer_requests').insert({
      athlete_id: athleteId,
      requested_by: currentUserId,
    });
    setRequestingTransfer(false);
    if (error) {
      Alert.alert(
        error.message.includes('duplicate') || error.message.includes('unique') ? 'Already requested' : 'Error requesting transfer',
        error.message.includes('duplicate') || error.message.includes('unique')
          ? "You already have a pending request for this athlete."
          : error.message
      );
      return;
    }
    const requesterName = profileNames[currentUserId] || 'Someone with access';
    await supabase.from('messages').insert({
      athlete_id: athleteId,
      sender_id: currentUserId,
      body: `${requesterName} has requested to become the owner of ${athleteName}. Open Manage Access to approve or decline.`,
    });
    Alert.alert('Request sent', 'The current owner has been notified.');
    loadData();
  };

  const approveTransfer = (request: TransferRequest) => {
    Alert.alert('Approve ownership transfer?', `You'll keep full access, but they'll control sharing going forward.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          const { error } = await supabase.rpc('transfer_ownership', {
            p_athlete_id: athleteId,
            p_new_owner_user_id: request.requested_by,
          });
          if (error) {
            Alert.alert('Error transferring ownership', error.message);
            return;
          }
          await supabase
            .from('transfer_requests')
            .update({ status: 'approved', resolved_at: new Date().toISOString() })
            .eq('id', request.id);
          Alert.alert('Ownership transferred');
          loadData();
        },
      },
    ]);
  };

  const declineTransfer = async (request: TransferRequest) => {
    await supabase
      .from('transfer_requests')
      .update({ status: 'declined', resolved_at: new Date().toISOString() })
      .eq('id', request.id);
    loadData();
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
      <HomeButton />
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

{isOwner && grants.some((g) => g.status === 'active') && (
              <View style={styles.inviteCard}>
                <Text style={styles.sectionLabel}>Transfer Ownership</Text>
                <Text style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
                  Make someone else the owner. You'll keep full access, but they'll take over control.
                </Text>
                {grants
                  .filter((g) => g.status === 'active')
                  .map((g) => (
                    <Pressable
                      key={g.id}
                      style={styles.transferRow}
                      onPress={() => transferOwnership(g)}
                    >
                    <Text style={styles.transferName}>
                        {(g.granted_to_user_id && profileNames[g.granted_to_user_id]) || g.relationship_label || g.invited_email}
                      </Text>
                      <Text style={styles.transferAction}>Make Owner →</Text>
                    </Pressable>
                  ))}
              </View>
            )}

            {isOwner && transferRequests.length > 0 && (
              <View style={styles.inviteCard}>
                <Text style={styles.sectionLabel}>Ownership Transfer Requests</Text>
                {transferRequests.map((r) => (
                  <View key={r.id} style={styles.transferRow}>
                    <Text style={styles.transferName}>{profileNames[r.requested_by] || 'Someone with access'}</Text>
                    <View style={{ flexDirection: 'row', gap: 14 }}>
                      <Pressable onPress={() => approveTransfer(r)}>
                        <Text style={styles.transferAction}>Approve</Text>
                      </Pressable>
                      <Pressable onPress={() => declineTransfer(r)}>
                        <Text style={styles.revokeText}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {!isOwner && grants.some((g) => g.granted_to_user_id === currentUserId && g.status === 'active') && (
              <View style={styles.inviteCard}>
                {transferRequests.some((r) => r.requested_by === currentUserId) ? (
                  <Text style={styles.smallLabel}>Ownership transfer requested — waiting on the owner.</Text>
                ) : (
                  <Pressable style={styles.inviteButton} onPress={requestTransfer} disabled={requestingTransfer}>
                    <Text style={styles.inviteButtonText}>
                      {requestingTransfer ? 'Requesting...' : 'Request Ownership Transfer'}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            <Text style={styles.sectionLabel}>Shared With</Text>
          </>
        }
        renderItem={({ item }) => (
          <View style={styles.grantRow}>
            <View>
              <Text style={styles.grantName}>
                {(item.granted_to_user_id && profileNames[item.granted_to_user_id]) || item.invited_email}
              </Text>
              <Text style={styles.grantEmail}>{item.invited_email}</Text>
              <View style={styles.badgeRow}>
                {item.relationship_label && (
                  <Text style={styles.badge}>{item.relationship_label}</Text>
                )}
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
  transferRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  transferName: { fontSize: 14, fontWeight: '600' },
  transferAction: { fontSize: 13, color: '#4C9BE8', fontWeight: '600' },
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
