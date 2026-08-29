import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Share, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { HomeButton } from '../components/HomeButton';
import { supabase } from '../supabase';
import {
  BatterLine,
  GamePitch,
  GamePitchOutcome,
  GameSession,
  deriveCounts,
  formatStat,
  gameSessionStats,
  groupBatters,
} from '../types/game';

type InningLogRow = {
  number: number;
  pitches: GamePitchOutcome[];
  outs: number;
  runs: number;
  earnedRuns: number;
};

const OUTCOME_LETTER: Record<GamePitchOutcome, string> = {
  strike: 'S',
  ball: 'B',
  foul: 'F',
  hbp: 'HP',
  hit: 'H',
  out: 'O',
  other_out: 'RO',
};

const OUTCOME_COLOR: Record<GamePitchOutcome, string> = {
  strike: '#3FB98A',
  ball: '#D6524F',
  foul: '#E8A93B',
  hbp: '#C23B38',
  hit: '#C23B38',
  out: '#2F9C71',
  other_out: '#888888',
};

// "Runner Out" lines aren't a batter's turn at the plate, so they're
// excluded from the "Batter N" numbering (a real batter after one keeps
// counting from where the last real batter left off).
function numberBatters(batters: BatterLine[]): { batter: BatterLine; num: number }[] {
  let n = 0;
  return batters.map((batter) => ({ batter, num: batter.result === 'Runner Out' ? -1 : n++ }));
}

function BatterRow({ batter, index, detailed }: { batter: BatterLine; index: number; detailed: boolean }) {
  if (batter.result === 'Runner Out') {
    return (
      <View style={styles.runnerOutRow}>
        <Text style={styles.runnerOutText}>Runner Out</Text>
      </View>
    );
  }
  if (!detailed) {
    return (
      <View style={styles.compactBatterRow}>
        <Text style={styles.compactBatterText}>
          Batter {index + 1} — {batter.result ?? 'At bat...'}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.batterRow}>
      <Text style={styles.batterNum}>{index + 1}</Text>
      <View style={styles.batterSeq}>
        {batter.seq.map((o, i) => (
          <Text key={i} style={[styles.seqDot, { color: OUTCOME_COLOR[o] }]}>
            {OUTCOME_LETTER[o]}
          </Text>
        ))}
      </View>
      <Text style={styles.batterResult}>{batter.result ?? '...'}</Text>
    </View>
  );
}

export default function GameEntryScreen() {
  const { athleteId, athleteName, sessionDate, gameSubtype, opponent, resumeSessionId, adoptSessionId } =
    useLocalSearchParams<{
      athleteId: string;
      athleteName: string;
      sessionDate: string;
      gameSubtype: string;
      opponent?: string;
      resumeSessionId?: string;
      adoptSessionId?: string;
    }>();
  const router = useRouter();

  const [events, setEvents] = useState<GamePitchOutcome[]>([]);
  const [inningNumber, setInningNumber] = useState(1);
  const [inningLog, setInningLog] = useState<InningLogRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [pendingStrikeout, setPendingStrikeout] = useState(false);
  const [pendingHitResult, setPendingHitResult] = useState(false);
  const [pendingOutType, setPendingOutType] = useState(false);
  const [pendingRunType, setPendingRunType] = useState(false);
  const [showEndInning, setShowEndInning] = useState(false);
  const [runsInput, setRunsInput] = useState('');
  const [earnedRunsInput, setEarnedRunsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [resuming, setResuming] = useState(!!resumeSessionId);
  const [showDetail, setShowDetail] = useState(false);
  const [expandedInning, setExpandedInning] = useState<number | null>(null);
  const [showRecap, setShowRecap] = useState(false);

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

      const rows = data as unknown as {
        inning_number: number;
        total_runs: number;
        earned_runs: number;
        game_pitches: GamePitch[];
      }[];
      const log: InningLogRow[] = rows.map((i) => {
        const sortedPitches = [...i.game_pitches].sort((a, b) => a.pitch_order - b.pitch_order).map((p) => p.outcome);
        const c = deriveCounts(sortedPitches);
        return { number: i.inning_number, pitches: sortedPitches, outs: c.outs, runs: i.total_runs, earnedRuns: i.earned_runs };
      });
      const maxInning = rows.reduce((max, i) => Math.max(max, i.inning_number), 0);

      setSessionId(Number(resumeSessionId));
      setInningLog(log);
      setInningNumber(maxInning + 1);
      setResuming(false);
    })();
  }, [resumeSessionId]);

  const counts = useMemo(() => deriveCounts(events), [events]);
  const currentBatters = useMemo(() => groupBatters(events), [events]);
  const totalPitchCount = useMemo(
    () =>
      inningLog.reduce((sum, i) => sum + i.pitches.filter((p) => p !== 'other_out').length, 0) + counts.pitchCount,
    [inningLog, counts.pitchCount]
  );

  const strikeLabel = counts.strikes === 0 ? 'Strike' : counts.strikes === 1 ? 'Strike 2' : 'Strike 3';
  const ballLabel =
    counts.balls === 0 ? 'Ball' : counts.balls === 1 ? 'Ball 2' : counts.balls === 2 ? 'Ball 3' : 'Ball 4';

  const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

  const appendEvent = (outcome: GamePitchOutcome) => {
    haptic();
    setEvents((prev) => [...prev, outcome]);
  };

  const tapStrike = () => {
    haptic();
    if (counts.strikes === 2) setPendingStrikeout(true);
    else setEvents((prev) => [...prev, 'strike']);
  };

  const tapHit = () => {
    haptic();
    setPendingHitResult(true);
  };

  const confirmHitResult = (safe: boolean) => {
    setPendingHitResult(false);
    appendEvent(safe ? 'hit' : 'out');
  };

  const tapOut = () => {
    haptic();
    setPendingOutType(true);
  };

  const confirmOutType = (currentBatter: boolean) => {
    setPendingOutType(false);
    appendEvent(currentBatter ? 'out' : 'other_out');
  };

  const tapRun = () => {
    haptic();
    setPendingRunType(true);
  };

  const confirmRunType = (earned: boolean) => {
    haptic();
    setPendingRunType(false);
    setRunsInput((prev) => String((parseInt(prev, 10) || 0) + 1));
    if (earned) setEarnedRunsInput((prev) => String((parseInt(prev, 10) || 0) + 1));
  };

  const undo = () => {
    haptic();
    setEvents((prev) => prev.slice(0, -1));
  };

  // Auto-prompt to close the inning once 3 outs are recorded - the End
  // Inning button stays available too, for a mid-inning pull.
  useEffect(() => {
    if (counts.outs >= 3 && !showEndInning) setShowEndInning(true);
  }, [counts.outs]);

  const ensureSession = async (): Promise<number> => {
    if (sessionId) return sessionId;

    // Beginning tracking on a game that was scheduled ahead of time: adopt
    // that existing row (flip it from 'scheduled' to 'in_progress') instead
    // of inserting a second, disconnected one.
    if (adoptSessionId) {
      const { data, error } = await supabase
        .from('sessions')
        .update({
          game_subtype: gameSubtype,
          opponent: opponent || null,
          session_date: sessionDate,
          status: 'in_progress',
        })
        .eq('id', adoptSessionId)
        .select()
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Could not begin the scheduled game');
      setSessionId(data.id);
      return data.id;
    }

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

      setInningLog((prev) => [...prev, { number: inningNumber, pitches: events, outs: counts.outs, runs, earnedRuns: earned }]);
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

  const goHome = () => {
    if (events.length === 0) {
      router.push('/home');
      return;
    }
    Alert.alert(
      'Leave game?',
      `You have ${events.length} pitch${events.length === 1 ? '' : 'es'} logged for the current inning that haven't been saved. Leaving now will discard them.`,
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Discard & Leave', style: 'destructive', onPress: () => router.push('/home') },
      ]
    );
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
    setShowRecap(true);
  };

  const buildRecapSession = (): GameSession => ({
    id: sessionId ?? 0,
    athlete_id: Number(athleteId),
    session_type: 'game',
    game_subtype: (gameSubtype as 'practice' | 'live') ?? null,
    opponent: opponent || null,
    session_date: sessionDate,
    session_time: null,
    notes: null,
    status: 'submitted',
    missed_reason: null,
    innings: inningLog.map((row) => ({
      id: 0,
      session_id: sessionId ?? 0,
      inning_number: row.number,
      total_runs: row.runs,
      earned_runs: row.earnedRuns,
      game_pitches: row.pitches.map((outcome, i) => ({ id: 0, inning_id: 0, outcome, pitch_order: i + 1 })),
    })),
  });

  const shareRecap = async () => {
    const stats = gameSessionStats(buildRecapSession());
    const message =
      `Game — ${sessionDate}\n` +
      `${gameSubtype === 'practice' ? 'Practice/Scrimmage' : 'Live Game'}${opponent ? ' vs ' + opponent : ''}\n\n` +
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

  if (resuming) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12, color: '#888', fontSize: 13 }}>Loading game in progress...</Text>
      </View>
    );
  }

  if (showRecap) {
    const stats = gameSessionStats(buildRecapSession());
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.athleteName}>{athleteName}</Text>
          <Text style={styles.sessionMeta}>
            {sessionDate} · {gameSubtype === 'practice' ? 'Practice/Scrimmage' : 'Live Game'}
            {opponent ? ` · ${opponent}` : ''}
          </Text>

          <View style={styles.statusCard}>
            <Text style={styles.pitchCountNumber}>{stats.ip}</Text>
            <Text style={styles.pitchCountLabel}>Innings Pitched</Text>

            <View style={[styles.statusRow, { marginTop: 18 }]}>
              <View style={styles.statusItem}>
                <Text style={[styles.statusNumber, { color: '#D6524F' }]}>{stats.runs}</Text>
                <Text style={styles.statusItemLabel}>Runs</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusNumber}>{formatStat(stats.era)}</Text>
                <Text style={styles.statusItemLabel}>ERA</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusNumber}>{formatStat(stats.whip)}</Text>
                <Text style={styles.statusItemLabel}>WHIP</Text>
              </View>
            </View>

            <View style={[styles.statusRow, { marginTop: 18 }]}>
              <View style={styles.statusItem}>
                <Text style={[styles.statusNumber, { color: '#3FB98A' }]}>{stats.k}</Text>
                <Text style={styles.statusItemLabel}>K</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={[styles.statusNumber, { color: '#D6524F' }]}>{stats.bb}</Text>
                <Text style={styles.statusItemLabel}>BB</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusNumber}>{stats.hits}</Text>
                <Text style={styles.statusItemLabel}>Hits</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusNumber}>{stats.pitchCount}</Text>
                <Text style={styles.statusItemLabel}>Pitches</Text>
              </View>
            </View>
          </View>

          <Pressable style={styles.endInningButton} onPress={shareRecap}>
            <Text style={styles.endInningButtonText}>Share</Text>
          </Pressable>
          <Pressable
            style={styles.finishButton}
            onPress={() => router.push({ pathname: '/athlete', params: { id: athleteId, name: athleteName } })}
          >
            <Text style={styles.finishButtonText}>Done</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <HomeButton onPress={goHome} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.athleteName}>{athleteName}</Text>
        <Text style={styles.sessionMeta}>
          {sessionDate} · {gameSubtype === 'practice' ? 'Practice/Scrimmage' : 'Live Game'}
          {opponent ? ` · ${opponent}` : ''}
        </Text>

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusLabel}>Inning {inningNumber}</Text>
            <Text style={styles.statusItemLabel}>This inning: {counts.pitchCount}</Text>
          </View>

          <Text style={styles.pitchCountNumber}>{totalPitchCount}</Text>
          <Text style={styles.pitchCountLabel}>Total Pitches</Text>

          <View style={[styles.statusRow, { marginTop: 16 }]}>
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
        </View>

        <View style={styles.buttonRow}>
          <Pressable style={[styles.outcomeButton, { backgroundColor: '#E8A93B' }]} onPress={() => appendEvent('foul')}>
            <Text style={styles.outcomeButtonText}>Foul</Text>
          </Pressable>
          <Pressable style={[styles.outcomeButton, { backgroundColor: '#C23B38' }]} onPress={tapHit}>
            <Text style={styles.outcomeButtonText}>Hit</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.outcomeButtonSmall, styles.hbpButton, { backgroundColor: '#C23B38' }]} onPress={() => appendEvent('hbp')}>
          <Text style={styles.outcomeButtonSmallText}>HBP</Text>
        </Pressable>

        <View style={styles.buttonRowSmall}>
          <Pressable style={[styles.outcomeButtonSmall, { backgroundColor: '#2F9C71' }]} onPress={tapOut}>
            <Text style={styles.outcomeButtonSmallText}>+Out</Text>
          </Pressable>
          <Pressable style={[styles.outcomeButtonSmall, { backgroundColor: '#4C9BE8' }]} onPress={tapRun}>
            <Text style={styles.outcomeButtonSmallText}>+Run</Text>
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

        <View style={styles.logTitleRow}>
          <Text style={styles.logTitle}>Batters This Inning</Text>
          <Pressable onPress={() => setShowDetail((d) => !d)}>
            <Text style={styles.detailToggle}>{showDetail ? 'Hide Detail' : 'Show Detail'}</Text>
          </Pressable>
        </View>
        {currentBatters.length === 0 ? (
          <Text style={styles.emptyText}>No batters faced yet this inning.</Text>
        ) : (
          numberBatters(currentBatters).map(({ batter, num }, i) => (
            <BatterRow key={i} batter={batter} index={num} detailed={showDetail} />
          ))
        )}

        <Text style={[styles.logTitle, { marginTop: 20 }]}>Inning Log</Text>
        {inningLog.length === 0 ? (
          <Text style={styles.emptyText}>No innings closed out yet.</Text>
        ) : (
          inningLog.map((inn) => {
            const expanded = expandedInning === inn.number;
            return (
              <View key={inn.number}>
                <Pressable style={styles.logRow} onPress={() => setExpandedInning(expanded ? null : inn.number)}>
                  <Text style={styles.logInning}>Inning {inn.number}</Text>
                  <Text style={styles.logDetail}>
                    {inn.pitches.filter((p) => p !== 'other_out').length} pitches · {inn.outs} outs · {inn.runs} R ({inn.earnedRuns} ER)
                  </Text>
                </Pressable>
                {expanded && (
                  <View style={styles.expandedBatters}>
                    {numberBatters(groupBatters(inn.pitches)).map(({ batter, num }, i) => (
                      <BatterRow key={i} batter={batter} index={num} detailed />
                    ))}
                  </View>
                )}
              </View>
            );
          })
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

      <Modal visible={pendingHitResult} animationType="fade" transparent>
        <View style={styles.centerOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Ball in Play</Text>
            <Text style={styles.confirmSubtitle}>Did the batter reach base, or get out?</Text>
            <View style={styles.confirmButtons}>
              <Pressable style={[styles.confirmButton, styles.confirmButtonNo]} onPress={() => confirmHitResult(false)}>
                <Text style={styles.confirmButtonNoText}>Out</Text>
              </Pressable>
              <Pressable style={[styles.confirmButton, styles.confirmButtonYes]} onPress={() => confirmHitResult(true)}>
                <Text style={styles.confirmButtonYesText}>Safe</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={pendingOutType} animationType="fade" transparent>
        <View style={styles.centerOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Record Out</Text>
            <Text style={styles.confirmSubtitle}>Is this the current batter, or a runner (caught stealing, picked off, etc.)?</Text>
            <View style={styles.confirmButtons}>
              <Pressable style={[styles.confirmButton, styles.confirmButtonNo]} onPress={() => confirmOutType(false)}>
                <Text style={styles.confirmButtonNoText}>Other (Runner)</Text>
              </Pressable>
              <Pressable style={[styles.confirmButton, styles.confirmButtonYes]} onPress={() => confirmOutType(true)}>
                <Text style={styles.confirmButtonYesText}>Current Batter</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={pendingRunType} animationType="fade" transparent>
        <View style={styles.centerOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Record Run</Text>
            <Text style={styles.confirmSubtitle}>Earned or unearned?</Text>
            <View style={styles.confirmButtons}>
              <Pressable style={[styles.confirmButton, styles.confirmButtonNo]} onPress={() => confirmRunType(false)}>
                <Text style={styles.confirmButtonNoText}>Unearned</Text>
              </Pressable>
              <Pressable style={[styles.confirmButton, styles.confirmButtonYes]} onPress={() => confirmRunType(true)}>
                <Text style={styles.confirmButtonYesText}>Earned</Text>
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

  statusCard: { backgroundColor: '#f7f8fa', borderRadius: 14, padding: 18, marginBottom: 16, alignItems: 'center' },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 6 },
  statusLabel: { fontSize: 13, fontWeight: '600', color: '#333' },
  pitchCountNumber: { fontSize: 48, fontWeight: '800', color: '#333' },
  pitchCountLabel: { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%' },
  statusItem: { alignItems: 'center' },
  statusNumber: { fontSize: 24, fontWeight: '700', color: '#333' },
  statusItemLabel: { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },

  buttonRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  outcomeButton: { flex: 1, borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  outcomeButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  buttonRowSmall: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  outcomeButtonSmall: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  outcomeButtonSmallText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  hbpButton: { alignSelf: 'stretch', marginBottom: 6 },
  runnerOutRow: { paddingVertical: 6, alignItems: 'center' },
  runnerOutText: { fontSize: 12, color: '#888', fontStyle: 'italic' },

  undoButton: { alignItems: 'center', paddingVertical: 10, marginBottom: 6 },
  undoText: { color: '#888', fontSize: 13 },
  undoTextDisabled: { color: '#ccc' },

  endInningButton: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  endInningButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  finishButton: { borderWidth: 1, borderColor: '#4C9BE8', borderRadius: 10, padding: 13, alignItems: 'center', marginBottom: 24 },
  finishButtonText: { color: '#4C9BE8', fontSize: 13, fontWeight: '600' },

  logTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  logTitle: { fontSize: 13, fontWeight: '600', color: '#333' },
  detailToggle: { fontSize: 12, color: '#4C9BE8', fontWeight: '600' },
  emptyText: { fontSize: 13, color: '#aaa', textAlign: 'center', paddingVertical: 16 },

  compactBatterRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  compactBatterText: { fontSize: 13, color: '#444' },
  batterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  batterNum: { fontSize: 11, color: '#999', width: 18 },
  batterSeq: { flexDirection: 'row', gap: 4, flex: 1 },
  seqDot: { fontSize: 12, fontWeight: 'bold' },
  batterResult: { fontSize: 12, fontWeight: '600', color: '#666' },

  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  logInning: { fontSize: 13, color: '#333', fontWeight: '600' },
  logDetail: { fontSize: 12, color: '#666' },
  expandedBatters: { backgroundColor: '#f7f8fa', borderRadius: 10, padding: 10, marginBottom: 8 },

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
