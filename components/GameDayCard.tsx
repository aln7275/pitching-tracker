import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../supabase';
import { GameSession, formatStat, gameSessionStats } from '../types/game';
import { MISSED_REASON_CHIPS } from '../types/workout';

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#4C9BE8',
  in_progress: '#4C9BE8',
  submitted: '#3FB98A',
  missed: '#D6524F',
};

function todayYMD() {
  return new Date().toISOString().split('T')[0];
}

export function GameDayCard({
  session,
  athleteId,
  athleteName,
  canEdit,
  onChanged,
}: {
  session: GameSession;
  athleteId: number;
  athleteName: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showMissedPicker, setShowMissedPicker] = useState(false);
  const [missedChip, setMissedChip] = useState<string | null>(null);
  const [missedNote, setMissedNote] = useState('');

  const isFuture = session.session_date >= todayYMD();

  const beginTracking = () => {
    router.push({
      pathname: '/game-setup',
      params: {
        athleteId,
        athleteName,
        adoptSessionId: session.id,
        initialDate: session.session_date,
        initialOpponent: session.opponent ?? '',
        initialSubtype: session.game_subtype ?? 'live',
      },
    });
  };

  const resumeTracking = () => {
    router.push({
      pathname: '/game-entry',
      params: {
        athleteId,
        athleteName,
        sessionDate: session.session_date,
        gameSubtype: session.game_subtype ?? 'live',
        opponent: session.opponent ?? '',
        resumeSessionId: session.id,
      },
    });
  };

  const confirmMissed = async () => {
    if (!missedChip) {
      Alert.alert('Pick a reason', 'Select a quick reason for the missed game.');
      return;
    }
    const reason =
      missedChip === 'Other' && missedNote.trim()
        ? `Other: ${missedNote.trim()}`
        : missedNote.trim()
        ? `${missedChip}: ${missedNote.trim()}`
        : missedChip;
    setSaving(true);
    await supabase.from('sessions').update({ status: 'missed', missed_reason: reason }).eq('id', session.id);
    setSaving(false);
    setShowMissedPicker(false);
    onChanged();
  };

  const deleteSession = () => {
    Alert.alert('Delete this game?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('sessions').delete().eq('id', session.id);
          onChanged();
        },
      },
    ]);
  };

  const shareRecap = async () => {
    const stats = gameSessionStats(session);
    const message =
      `Game — ${session.session_date}\n` +
      `${session.game_subtype === 'practice' ? 'Practice/Scrimmage' : 'Live Game'}${
        session.opponent ? ' vs ' + session.opponent : ''
      }\n\n` +
      `IP: ${stats.ip}   Pitches: ${stats.pitchCount}\n` +
      `R: ${stats.runs}   ER: ${stats.earnedRuns}\n` +
      `K: ${stats.k}   BB: ${stats.bb}   HBP: ${stats.hbp}   H: ${stats.hits}\n` +
      `ERA: ${formatStat(stats.era)}   WHIP: ${formatStat(stats.whip)}\n` +
      `Strike %: ${stats.strikePct}%`;
    try {
      await Share.share({ message });
    } catch (err) {
      console.log('Share error:', err);
    }
  };

  if (session.status === 'in_progress') {
    return (
      <View style={styles.dayCard}>
        <View style={styles.dayCardHeader}>
          <Text style={styles.title}>Game{session.opponent ? ' vs ' + session.opponent : ''}</Text>
          <Text style={[styles.statusBadge, { color: STATUS_COLOR.in_progress }]}>IN PROGRESS</Text>
        </View>
        {canEdit && (
          <Pressable style={styles.smallActionButtonPrimary} onPress={resumeTracking}>
            <Text style={styles.smallActionTextPrimary}>Resume Tracking</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (session.status === 'submitted') {
    const stats = gameSessionStats(session);
    return (
      <View style={styles.dayCard}>
        <View style={styles.dayCardHeader}>
          <Text style={styles.title}>Game{session.opponent ? ' vs ' + session.opponent : ''}</Text>
          <Text style={[styles.statusBadge, { color: STATUS_COLOR.submitted }]}>SUBMITTED</Text>
        </View>
        <Text style={styles.resultLine}>
          IP: {stats.ip}  ·  Pitches: {stats.pitchCount}  ·  R: {stats.runs} (ER {stats.earnedRuns})
        </Text>
        <Text style={styles.resultLine}>
          K: {stats.k}  ·  BB: {stats.bb}  ·  HBP: {stats.hbp}  ·  H: {stats.hits}
        </Text>
        <Text style={styles.resultLine}>
          ERA: {formatStat(stats.era)}  ·  WHIP: {formatStat(stats.whip)}  ·  Strike%: {stats.strikePct}%
        </Text>
        <Pressable style={styles.smallActionButton} onPress={shareRecap}>
          <Text style={styles.smallActionText}>Share</Text>
        </Pressable>
      </View>
    );
  }

  if (session.status === 'missed') {
    return (
      <View style={styles.dayCard}>
        <View style={styles.dayCardHeader}>
          <Text style={styles.title}>Game{session.opponent ? ' vs ' + session.opponent : ''}</Text>
          <Text style={[styles.statusBadge, { color: STATUS_COLOR.missed }]}>MISSED</Text>
        </View>
        {session.missed_reason && <Text style={styles.missedReasonText}>Missed: {session.missed_reason}</Text>}
      </View>
    );
  }

  // scheduled
  return (
    <View style={styles.dayCard}>
      <View style={styles.dayCardHeader}>
        <Text style={styles.title}>Game{session.opponent ? ' vs ' + session.opponent : ''}</Text>
        <Text style={[styles.statusBadge, { color: STATUS_COLOR.scheduled }]}>SCHEDULED</Text>
      </View>
      <Text style={styles.resultLine}>
        {session.game_subtype === 'practice' ? 'Practice/Scrimmage' : 'Live Game'}
        {session.session_time ? ` · ${session.session_time}` : ''}
      </Text>

      {canEdit && !showMissedPicker && (
        <View style={styles.dayCardActions}>
          <Pressable style={styles.smallActionButtonPrimary} onPress={beginTracking}>
            <Text style={styles.smallActionTextPrimary}>Begin Tracking</Text>
          </Pressable>
          <Pressable style={styles.smallActionButton} onPress={() => setShowMissedPicker(true)}>
            <Text style={styles.smallActionText}>Mark Missed</Text>
          </Pressable>
          {isFuture && (
            <Pressable style={styles.smallActionButton} onPress={deleteSession}>
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          )}
        </View>
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
          <TextInput style={styles.input} placeholder="Optional note" value={missedNote} onChangeText={setMissedNote} />
          <View style={styles.modalButtons}>
            <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={() => setShowMissedPicker(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalButton, styles.saveButton]} onPress={confirmMissed} disabled={saving}>
              <Text style={styles.saveButtonText}>Confirm Missed</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dayCard: { backgroundColor: '#f7f8fa', borderRadius: 14, padding: 16, marginBottom: 14 },
  dayCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 15, fontWeight: '600' },
  statusBadge: { fontSize: 11, fontWeight: '700' },
  resultLine: { fontSize: 13, color: '#333', marginBottom: 6 },
  missedReasonText: { fontSize: 12, color: '#D6524F', marginTop: 4, fontStyle: 'italic' },
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
