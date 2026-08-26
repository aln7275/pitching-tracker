import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../supabase';

const PITCH_TYPES = ['Fastball', 'Curveball', 'Changeup', 'Slider'];

const OUTCOME_META: Record<string, { label: string; color: string }> = {
  T: { label: 'Target', color: '#3FB98A' },
  C: { label: 'Competitive', color: '#E8A93B' },
  N: { label: 'Non-Competitive', color: '#D6524F' },
};

type Pitch = { outcome: 'T' | 'C' | 'N'; pitchType: string; speed: string | null };

function simulateBatters(pitches: Pitch[]) {
  let strikes = 0, balls = 0, k = 0, bb = 0;
  const batters: { seq: string[]; result: string | null }[] = [];
  let seq: string[] = [];

  for (const p of pitches) {
    seq.push(p.outcome);
    // C is neutral: a competitive pitch is close enough to be hittable, so it
    // shouldn't auto-resolve as either a strike or a ball in the simulation.
    if (p.outcome === 'T') strikes++;
    else if (p.outcome === 'N') balls++;

    if (strikes >= 3) {
      k++;
      batters.push({ seq, result: 'K' });
      seq = []; strikes = 0; balls = 0;
    } else if (balls >= 4) {
      bb++;
      batters.push({ seq, result: 'BB' });
      seq = []; strikes = 0; balls = 0;
    }
  }
  if (seq.length > 0) batters.push({ seq, result: null });

  return { k, bb, battersFaced: batters.length, batters };
}

export default function BullpenEntryScreen() {
  const { athleteId, athleteName, sessionDate } = useLocalSearchParams();
  const router = useRouter();

  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [pitchType, setPitchType] = useState('Fastball');
  const [speed, setSpeed] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { T: 0, C: 0, N: 0 };
    pitches.forEach((p) => c[p.outcome]++);
    return c;
  }, [pitches]);

  const total = pitches.length;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  const sim = useMemo(() => simulateBatters(pitches), [pitches]);

  const logPitch = (outcome: 'T' | 'C' | 'N') => {
    setPitches((prev) => [...prev, { outcome, pitchType, speed: speed.trim() || null }]);
    setSpeed('');
  };

  const undoLast = () => setPitches((prev) => prev.slice(0, -1));

  const handleCancel = () => {
    Alert.alert('Discard session?', 'This session will not be saved.', [
      { text: 'Keep Going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const handleSubmit = async () => {
    if (total === 0) return;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Not logged in', 'Please log in again.');
      setSaving(false);
      return;
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        athlete_id: athleteId,
        user_id: user.id,
        session_type: 'bullpen',
        bullpen_subtype: 'TCN',
        session_date: sessionDate,
        notes: notes.trim() || null,
        status: 'submitted',
      })
      .select()
      .single();

    if (sessionError || !session) {
      Alert.alert('Error saving session', sessionError?.message ?? 'Unknown error');
      setSaving(false);
      return;
    }

    const pitchRows = pitches.map((p, index) => ({
      session_id: session.id,
      user_id: user.id,
      outcome: p.outcome,
      pitch_type: p.pitchType,
      speed: p.speed ? parseInt(p.speed, 10) : null,
      pitch_order: index + 1,
    }));

    const { error: pitchError } = await supabase.from('pitches').insert(pitchRows);

    setSaving(false);
    if (pitchError) {
      Alert.alert('Error saving pitches', pitchError.message);
      return;
    }

    Alert.alert('Session Saved', `Logged ${total} pitches for ${athleteName}.`);
    router.push({ pathname: '/athlete', params: { id: athleteId, name: athleteName } });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.athleteName}>{athleteName}</Text>
      <Text style={styles.sessionDate}>{sessionDate} · Bullpen · TCN</Text>

      <View style={styles.row}>
        <View style={styles.speedBox}>
          <Text style={styles.label}>Velocity (mph)</Text>
          <TextInput
            style={styles.speedInput}
            keyboardType="numeric"
            value={speed}
            onChangeText={setSpeed}
            placeholder="—"
          />
        </View>
      </View>

      <View style={styles.pitchTypeRow}>
        {PITCH_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setPitchType(t)}
            style={[styles.pitchTypeChip, pitchType === t && styles.pitchTypeChipActive]}
          >
            <Text style={[styles.pitchTypeText, pitchType === t && styles.pitchTypeTextActive]}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.outcomeRow}>
        {(['T', 'C', 'N'] as const).map((key) => (
          <Pressable
            key={key}
            style={[styles.outcomeButton, { borderColor: OUTCOME_META[key].color }]}
            onPress={() => logPitch(key)}
          >
            <Text style={[styles.outcomeLetter, { color: OUTCOME_META[key].color }]}>{key}</Text>
            <Text style={styles.outcomeLabel}>{OUTCOME_META[key].label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={undoLast} disabled={total === 0} style={styles.undoButton}>
        <Text style={styles.undoText}>Undo last pitch</Text>
      </Pressable>

      <View style={styles.summaryBox}>
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>Session Summary</Text>
          <Text style={styles.pitchCount}>PITCH {total}</Text>
        </View>

        <View style={styles.countRow}>
          {(['T', 'C', 'N'] as const).map((k) => (
            <View key={k} style={styles.countItem}>
              <Text style={[styles.countNumber, { color: OUTCOME_META[k].color }]}>{counts[k]}</Text>
              <Text style={styles.countLabel}>{k} · {pct(counts[k])}%</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        <Text style={styles.summaryTitle}>
          Batters Faced: {sim.battersFaced}  ·  K: {sim.k}  ·  BB: {sim.bb}
        </Text>

        {sim.batters.length > 0 && (
          <View style={styles.batterLog}>
            {sim.batters.map((b, i) => (
              <View key={i} style={styles.batterLine}>
                <Text style={styles.batterNum}>{i + 1}</Text>
                <View style={styles.batterSeq}>
                  {b.seq.map((o, j) => (
                    <Text key={j} style={[styles.seqDot, { color: OUTCOME_META[o].color }]}>
                      {o}
                    </Text>
                  ))}
                </View>
                <Text style={styles.batterResult}>{b.result ?? 'at bat'}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Session Notes, e.g. pitch mix, mechanics, athlete's condition etc."
        multiline
      />

      <View style={styles.footerButtons}>
        <Pressable style={styles.cancelButton} onPress={handleCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
       <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={total === 0 || saving}>
          <Text style={styles.submitButtonText}>{saving ? 'Saving...' : 'Submit Session'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  athleteName: { fontSize: 22, fontWeight: 'bold' },
  sessionDate: { fontSize: 13, color: '#888', marginBottom: 20 },
  label: { fontSize: 12, color: '#666', marginBottom: 6, textTransform: 'uppercase' },
  row: { marginBottom: 16 },
  speedBox: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12 },
  speedInput: { fontSize: 22, fontWeight: '600' },
  pitchTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  pitchTypeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#ddd' },
  pitchTypeChipActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  pitchTypeText: { fontSize: 13, color: '#333' },
  pitchTypeTextActive: { color: '#fff', fontWeight: '600' },
  outcomeRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  outcomeButton: { flex: 1, borderWidth: 2, borderRadius: 14, paddingVertical: 20, alignItems: 'center' },
  outcomeLetter: { fontSize: 28, fontWeight: 'bold' },
  outcomeLabel: { fontSize: 10, color: '#666', marginTop: 4, textTransform: 'uppercase' },
  undoButton: { alignItems: 'center', paddingVertical: 10, marginBottom: 20 },
  undoText: { color: '#888', fontSize: 13 },
  summaryBox: { backgroundColor: '#f7f8fa', borderRadius: 14, padding: 16, marginBottom: 20 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  summaryTitle: { fontSize: 13, fontWeight: '600', color: '#333' },
  pitchCount: { fontSize: 13, fontWeight: '600' },
  countRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12 },
  countItem: { alignItems: 'center' },
  countNumber: { fontSize: 20, fontWeight: 'bold' },
  countLabel: { fontSize: 11, color: '#666' },
  divider: { height: 1, backgroundColor: '#e0e0e0', marginBottom: 12 },
  batterLog: { marginTop: 12, gap: 8 },
  batterLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  batterNum: { fontSize: 11, color: '#999', width: 16 },
  batterSeq: { flexDirection: 'row', gap: 4, flex: 1 },
  seqDot: { fontSize: 13, fontWeight: 'bold' },
  batterResult: { fontSize: 11, fontWeight: '600', color: '#666' },
  notesInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, minHeight: 60, marginBottom: 24, textAlignVertical: 'top' },
  footerButtons: { flexDirection: 'row', gap: 10 },
  cancelButton: { flex: 1, padding: 16, borderRadius: 10, backgroundColor: '#eee', alignItems: 'center' },
  cancelButtonText: { fontWeight: '600', color: '#333' },
  submitButton: { flex: 1, padding: 16, borderRadius: 10, backgroundColor: '#4C9BE8', alignItems: 'center' },
  submitButtonText: { fontWeight: '600', color: '#fff' },
});
