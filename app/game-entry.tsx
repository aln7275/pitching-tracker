import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../supabase';
import { GamePitch, GamePitchOutcome, deriveCounts } from '../types/game';

type InningLogRow = { number: number; pitches: number; outs: number; runs: number; earnedRuns: number };

export default function GameEntryScreen() {
  const { athleteId, athleteName, sessionDate, gameSubtype, opponent, resumeSessionId } = useLocalSearchParams<{
    athleteId: string;
    athleteName: string;
    sessionDate: string;
    gameSubtype: string;
    opponent?: string;
    resumeSessionId?: string;
  }>();
  const router = useRouter();

  const [events, setEvents] = useState<GamePitchOutcome[]>([]);
  const [inningNumber, setInningNumber] = useState(1);
  const [inningLog, setInningLog] = useState<InningLogRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [pendingStrikeout, setPendingStrikeout] = useState(false);
  const [showEndInning, setShowEndInning] = useState(false);
  const [runsInput, setRunsInput] = useState('');
  const [earnedRunsInput, setEarnedRunsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [resuming, setResuming] = useState(!!resumeSessionId);

  useEffect(() => {
    if (!resumeSessionId) return;
    (async () => {
      const { data, error } = await supabase
        .from('innings')
        .select('*, game_pitches(*)')
        .eq('session_id', resumeSessionId)
        .order('inning_number', { ascending: true });

      if (error || !data) {
        Alert.alert('Error resuming game', error?.message ?? 'Could not load the in-progress game.');
        setResuming(false);
        return;
      }

      const rows = data as unknown as { inning_number: number; total_runs: number; earned_runs: number; game_pitches: GamePitch[] }[];
      const log = rows.map((i) => {
        const c = deriveCounts(i.game_pitches.map((p) => p.outcome));
        return { number: i.inning_number, pitches: c.pitchCount, outs: c.outs, runs: i.total_runs, earnedRuns: i.earned_runs };
      });
      const maxInning = rows.reduce((max, i) => Math.max(max, i.inning_number), 0);

      setSessionId(Number(resumeSessionId));
      setInningLog(log);
      setInningNumber(maxInning + 1);
      setResuming(false);
    })();
  }, [resumeSessionId]);

  const counts = useMemo(() => deriveCounts(events), [events]);

  const strikeLabel = counts.strikes === 0 ? 'Strike' : counts.strikes === 1 ? 'Strike 2' : 'Strike 3';
  const ballLabel =
    counts.balls === 0 ? 'Ball' : counts.balls === 1 ? 'Ball 2' : counts.balls === 2 ? 'Ball 3' : 'Ball 4';

  const appendEvent = (outcome: GamePitchOutcome) => setEvents((prev) => [...prev, outcome]);

  const tapStrike = () => {
    if (counts.strikes === 2) setPendingStrikeout(true);
    else appendEvent('strike');
  };

  const undo = () => setEvents((prev) => prev.slice(0, -1));

  const ensureSession = async (): Promise<number> => {
    if (sessionId) return sessionId;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not logged in');

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        athlete_id: athleteId,
        user_id: user.id,
        session_type: 'game',
        game_subtype: gameSubtype,
        opponent: opponent || null,
        session_date: sessionDate,
        status: 'in_progress',
      })
      .select()
      .single();

    if (error || !data) throw new Error(error?.message ?? 'Could not start the game session');
    setSessionId(data.id);
    return data.id;
  };

  const confirmEndInning = async () => {
    setSaving(true);
    try {
      const sid = await ensureSession();
      const runs = parseInt(runsInput, 10) || 0;
      const earned = earnedRunsInput.trim() === '' ? runs : parseInt(earnedRunsInput, 10) || 0;

      const { data: inning, error: inningError } = await supabase
        .from('innings')
        .insert({ session_id: sid, inning_number: inningNumber, total_runs: runs, earned_runs: earned })
        .select()
        .single();
      if (inningError || !inning) throw new Error(inningError?.message ?? 'Could not save the inning');

      if (events.length > 0) {
        const pitchRows = events.map((outcome, i) => ({
          inning_id: inning.id,
          outcome,
          pitch_order: i + 1,
        }));
        const { error: pitchError } = await supabase.from('game_pitches').insert(pitchRows);
        if (pitchError) throw new Error(pitchError.message);
      }

      setInningLog((prev) => [
        ...prev,
        { number: inningNumber, pitches: counts.pitchCount, outs: counts.outs, runs, earnedRuns: earned },
      ]);
      setEvents([]);
      setInningNumber((n) => n + 1);
      setShowEndInning(false);
      setRunsInput('');
      setEarnedRunsInput('');
    } catch (err: any) {
      Alert.alert('Error saving inning', err.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const finishOuting = () => {
    if (events.length > 0) {
      Alert.alert(
        'Inning in progress',
        `You have ${events.length} pitch${events.length === 1 ? '' : 'es'} logged for the current inning that haven't been saved yet. End the inning first, or discard them and finish?`,
        [
          { text: 'Go Back', style: 'cancel' },
          {
            text: 'Discard & Finish',
            style: 'destructive',
            onPress: () => finalizeSession(),
          },
        ]
      );
      return;
    }
    finalizeSession();
  };

  const finalizeSession = async () => {
    if (!sessionId) {
      router.push({ pathname: '/athlete', params: { id: athleteId, name: athleteName } });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('sessions').update({ status: 'submitted' }).eq('id', sessionId);
    setSaving(false);
    if (error) {
      Alert.alert('Error finishing outing', error.message);
      return;
    }
    router.push({ pathname: '/athlete', params: { id: athleteId, name: athleteName } });
  };

  if (resuming) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12, color: '#888', fontSize: 13 }}>Loading game in progress...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.athleteName}>{athleteName}</Text>
        <Text style={styles.sessionMeta}>
          {sessionDate} · {gameSubtype === 'practice' ? 'Practice/Scrimmage' : 'Live Game'}
          {opponent ? ` · ${opponent}` : ''}
        </Text>

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusLabel}>Inning {inningNumber}</Text>
            <Text style={styles.statusPitch}>Pitch {counts.pitchCount}</Text>
          </View>
          <View style={styles.statusRow}>
            <View style={styles.statusItem}>
              <Text style={styles.statusNumber}>
                {counts.balls}-{counts.strikes}
              </Text>
              <Text style={styles.statusItemLabel}>Count</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusNumber}>{counts.outs}</Text>
              <Text style={styles.statusItemLabel}>Outs</Text>
            </View>
          </View>
        </View>

        <View style={styles.buttonRow}>
          <Pressable style={[styles.outcomeButton, { backgroundColor: '#3FB98A' }]} onPress={tapStrike}>
            <Text style={styles.outcomeButtonText}>{strikeLabel}</Text>
          </Pressable>
          <Pressable style={[styles.outcomeButton, { backgroundColor: '#D6524F' }]} onPress={() => appendEvent('ball')}>
            <Text style={styles.outcomeButtonText}>{ballLabel}</Text>
          </Pressable>
          <Pressable style={[styles.outcomeButton, { backgroundColor: '#E8A93B' }]} onPress={() => appendEvent('foul')}>
            <Text style={styles.outcomeButtonText}>Foul</Text>
          </Pressable>
        </View>

        <View style={styles.buttonRowSmall}>
          <Pressable style={[styles.outcomeButtonSmall, { backgroundColor: '#C23B38' }]} onPress={() => appendEvent('hbp')}>
            <Text style={styles.outcomeButtonSmallText}>HBP</Text>
          </Pressable>
          <Pressable style={[styles.outcomeButtonSmall, { backgroundColor: '#C23B38' }]} onPress={() => appendEvent('hit')}>
            <Text style={styles.outcomeButtonSmallText}>Hit</Text>
          </Pressable>
          <Pressable style={[styles.outcomeButtonSmall, { backgroundColor: '#2F9C71' }]} onPress={() => appendEvent('out')}>
            <Text style={styles.outcomeButtonSmallText}>+Out</Text>
          </Pressable>
        </View>

        <Pressable onPress={undo} disabled={events.length === 0} style={styles.undoButton}>
          <Text style={[styles.undoText, events.length === 0 && styles.undoTextDisabled]}>Undo last pitch</Text>
        </Pressable>

        <Pressable style={styles.endInningButton} onPress={() => setShowEndInning(true)} disabled={saving}>
          <Text style={styles.endInningButtonText}>End Inning</Text>
        </Pressable>

        <Pressable style={styles.finishButton} onPress={finishOuting} disabled={saving}>
          <Text style={styles.finishButtonText}>Finish Outing</Text>
        </Pressable>

        <Text style={styles.logTitle}>Inning Log</Text>
        {inningLog.length === 0 ? (
          <Text style={styles.emptyText}>No innings closed out yet.</Text>
        ) : (
          inningLog.map((inn) => (
            <View key={inn.number} style={styles.logRow}>
              <Text style={styles.logInning}>Inning {inn.number}</Text>
              <Text style={styles.logDetail}>
                {inn.pitches} pitches · {inn.outs} outs · {inn.runs} R ({inn.earnedRuns} ER)
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={pendingStrikeout} animationType="fade" transparent>
        <View style={styles.centerOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Record Out — K?</Text>
            <Text style={styles.confirmSubtitle}>Third strike recorded. Confirm the out.</Text>
            <View style={styles.confirmButtons}>
              <Pressable
                style={[styles.confirmButton, styles.confirmButtonNo]}
                onPress={() => setPendingStrikeout(false)}
              >
                <Text style={styles.confirmButtonNoText}>No, Keep Going</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, styles.confirmButtonYes]}
                onPress={() => {
                  appendEvent('strike');
                  setPendingStrikeout(false);
                }}
              >
                <Text style={styles.confirmButtonYesText}>Yes, Out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showEndInning} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>End Inning {inningNumber}</Text>

            <Text style={styles.smallLabel}>Total Runs</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="0"
              value={runsInput}
              onChangeText={setRunsInput}
            />

            <Text style={styles.smallLabel}>Earned Runs (optional)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="Same as total"
              value={earnedRunsInput}
              onChangeText={setEarnedRunsInput}
            />

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowEndInning(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.saveButton]}
                onPress={confirmEndInning}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Inning'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  athleteName: { fontSize: 22, fontWeight: 'bold' },
  sessionMeta: { fontSize: 13, color: '#888', marginBottom: 20 },

  statusCard: { backgroundColor: '#f7f8fa', borderRadius: 14, padding: 18, marginBottom: 16 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  statusLabel: { fontSize: 13, fontWeight: '600', color: '#333' },
  statusPitch: { fontSize: 13, color: '#666' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statusItem: { alignItems: 'center' },
  statusNumber: { fontSize: 28, fontWeight: '700', color: '#333' },
  statusItemLabel: { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },

  buttonRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  outcomeButton: { flex: 1, borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  outcomeButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  buttonRowSmall: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  outcomeButtonSmall: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  outcomeButtonSmallText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  undoButton: { alignItems: 'center', paddingVertical: 10, marginBottom: 6 },
  undoText: { color: '#888', fontSize: 13 },
  undoTextDisabled: { color: '#ccc' },

  endInningButton: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  endInningButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  finishButton: { borderWidth: 1, borderColor: '#4C9BE8', borderRadius: 10, padding: 13, alignItems: 'center', marginBottom: 24 },
  finishButtonText: { color: '#4C9BE8', fontSize: 13, fontWeight: '600' },

  logTitle: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 4 },
  emptyText: { fontSize: 13, color: '#aaa', textAlign: 'center', paddingVertical: 16 },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  logInning: { fontSize: 13, color: '#333', fontWeight: '600' },
  logDetail: { fontSize: 12, color: '#666' },

  centerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 30 },
  confirmCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%' },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 8, textAlign: 'center' },
  confirmSubtitle: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 20 },
  confirmButtons: { flexDirection: 'row', gap: 10 },
  confirmButton: { flex: 1, borderRadius: 10, padding: 14, alignItems: 'center' },
  confirmButtonNo: { backgroundColor: '#eee' },
  confirmButtonNoText: { color: '#333', fontWeight: '600', fontSize: 14 },
  confirmButtonYes: { backgroundColor: '#3FB98A' },
  confirmButtonYesText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  smallLabel: { fontSize: 11, color: '#888', marginBottom: 6, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 16 },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalButton: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  cancelButton: { backgroundColor: '#eee' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  saveButton: { backgroundColor: '#4C9BE8' },
  saveButtonText: { color: '#fff', fontWeight: '600' },
});
