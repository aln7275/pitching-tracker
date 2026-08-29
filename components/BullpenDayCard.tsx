import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../supabase';
import { BullpenSession, simulateBatters, tcnCounts } from '../types/bullpen';
import { MISSED_REASON_CHIPS } from '../types/workout';

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#4C9BE8',
  submitted: '#3FB98A',
  missed: '#D6524F',
};

export function BullpenDayCard({
  session,
  athleteId,
  athleteName,
  canEdit,
  onChanged,
}: {
  session: BullpenSession;
  athleteId: number;
  athleteName: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [targetPitches, setTargetPitches] = useState(session.target_pitches?.toString() ?? '');
  const [notes, setNotes] = useState(session.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [showMissedPicker, setShowMissedPicker] = useState(false);
  const [missedChip, setMissedChip] = useState<string | null>(null);
  const [missedNote, setMissedNote] = useState('');

  const counts = tcnCounts(session.pitches);
  const sim = simulateBatters(session.pitches);
  const total = session.pitches.length;

  const saveScheduleEdits = async () => {
    setSaving(true);
    await supabase
      .from('sessions')
      .update({
        target_pitches: targetPitches.trim() ? parseInt(targetPitches, 10) : null,
        notes: notes.trim() || null,
      })
      .eq('id', session.id);
    setSaving(false);
    onChanged();
  };

  const beginSession = () => {
    router.push({
      pathname: '/bullpen-entry',
      params: {
        athleteId,
        athleteName,
        sessionDate: session.session_date,
        sessionId: session.id,
        ...(session.target_pitches ? { targetPitches: session.target_pitches } : {}),
        ...(session.notes ? { initialNotes: session.notes } : {}),
      },
    });
  };

  const confirmMissed = async () => {
    if (!missedChip) {
      Alert.alert('Pick a reason', 'Select a quick reason for the missed bullpen.');
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
    Alert.alert('Delete this bullpen?', 'This cannot be undone.', [
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

  if (session.status === 'submitted') {
    return (
      <View style={styles.dayCard}>
        <View style={styles.dayCardHeader}>
          <Text style={styles.title}>Bullpen Session</Text>
          <Text style={[styles.statusBadge, { color: STATUS_COLOR.submitted }]}>SUBMITTED</Text>
        </View>
        <View style={styles.countRow}>
          <Text style={styles.countItem}>T: {counts.T}</Text>
          <Text style={styles.countItem}>C: {counts.C}</Text>
          <Text style={styles.countItem}>N: {counts.N}</Text>
          <Text style={styles.countItem}>Pitches: {total}</Text>
        </View>
        <Text style={styles.resultLine}>
          {sim.battersFaced === 0 && total > 0
            ? 'Batters Faced: 0 (all Competitive — no simulated K/BB)'
            : `Batters Faced: ${sim.battersFaced}  ·  K: ${sim.k}  ·  BB: ${sim.bb}`}
        </Text>
        {session.notes && <Text style={styles.notesReadOnly}>{session.notes}</Text>}
      </View>
    );
  }

  if (session.status === 'missed') {
    return (
      <View style={styles.dayCard}>
        <View style={styles.dayCardHeader}>
          <Text style={styles.title}>Bullpen Session</Text>
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
        <Text style={styles.title}>Bullpen Session</Text>
        <Text style={[styles.statusBadge, { color: STATUS_COLOR.scheduled }]}>SCHEDULED</Text>
      </View>

      {canEdit && !showMissedPicker && (
        <>
          <Text style={styles.fieldLabel}>Target Pitches</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            placeholder="e.g. 30"
            value={targetPitches}
            onChangeText={setTargetPitches}
          />
          <Text style={styles.fieldLabel}>Coach Notes</Text>
          <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Optional notes" multiline />

          <View style={styles.dayCardActions}>
            <Pressable style={styles.smallActionButton} onPress={saveScheduleEdits} disabled={saving}>
              <Text style={styles.smallActionText}>{saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
            <Pressable style={styles.smallActionButtonPrimary} onPress={beginSession}>
              <Text style={styles.smallActionTextPrimary}>Start Bullpen Session</Text>
            </Pressable>
            <Pressable style={styles.smallActionButton} onPress={() => setShowMissedPicker(true)}>
              <Text style={styles.smallActionText}>Mark Missed</Text>
            </Pressable>
            <Pressable style={styles.smallActionButton} onPress={deleteSession}>
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          </View>
        </>
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
  countRow: { flexDirection: 'row', gap: 14, marginBottom: 8 },
  countItem: { fontSize: 13, color: '#444', fontWeight: '600' },
  resultLine: { fontSize: 13, color: '#333', marginBottom: 6 },
  notesReadOnly: { fontSize: 13, color: '#666', fontStyle: 'italic', marginTop: 4 },
  missedReasonText: { fontSize: 12, color: '#D6524F', marginTop: 4, fontStyle: 'italic' },
  fieldLabel: { fontSize: 11, color: '#888', marginBottom: 4, marginTop: 8, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: '#fff' },
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
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalButton: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  cancelButton: { backgroundColor: '#eee' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  saveButton: { backgroundColor: '#4C9BE8' },
  saveButtonText: { color: '#fff', fontWeight: '600' },
});
