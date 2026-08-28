import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BoxedCalendar, DayEvent } from '../components/BoxedCalendar';
import { SettingsIcon } from '../components/Icons';
import { supabase } from '../supabase';

type Athlete = { id: number; name: string };
type WorkoutRow = { id: number; athlete_id: number; scheduled_date: string; status: string; title: string | null };
type SessionRow = {
  id: number;
  athlete_id: number;
  session_date: string;
  session_type: string;
  status: string | null;
  opponent: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#4C9BE8',
  in_progress: '#4C9BE8',
  completed: '#3FB98A',
  submitted: '#3FB98A',
  missed: '#D6524F',
};

export default function HomeScreen() {
  const router = useRouter();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  const [bullpenSessions, setBullpenSessions] = useState<SessionRow[]>([]);
  const [gameSessions, setGameSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data: athleteData } = await supabase.from('athletes').select('id, name');
    const athleteList = (athleteData ?? []) as Athlete[];
    setAthletes(athleteList);
    setSelectedIds((prev) => (prev.length === 0 ? athleteList.map((a) => a.id) : prev));

    const { data: workoutData } = await supabase
      .from('workouts')
      .select('id, athlete_id, scheduled_date, status, title');
    setWorkouts((workoutData ?? []) as WorkoutRow[]);

    const { data: sessionData } = await supabase
      .from('sessions')
      .select('id, athlete_id, session_date, session_type, status, opponent');
    const allSessions = (sessionData ?? []) as SessionRow[];
    setBullpenSessions(allSessions.filter((s) => s.session_type === 'bullpen'));
    setGameSessions(allSessions.filter((s) => s.session_type === 'game'));

    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  const athleteName = useCallback((id: number) => athletes.find((a) => a.id === id)?.name ?? '', [athletes]);

  const markedEvents = useMemo(() => {
    const map: Record<string, DayEvent[]> = {};
    const selectedSet = new Set(selectedIds);
    const push = (date: string, ev: DayEvent) => {
      (map[date] ??= []).push(ev);
    };

    workouts
      .filter((w) => selectedSet.has(w.athlete_id))
      .forEach((w) => {
        push(w.scheduled_date, {
          type: 'workout',
          label: 'W',
          color: STATUS_COLOR[w.status] ?? '#4C9BE8',
          detail: `${athleteName(w.athlete_id)} — Workout${w.title ? ': ' + w.title : ''} (${w.status})`,
          athleteId: w.athlete_id,
        });
      });

    bullpenSessions
      .filter((s) => selectedSet.has(s.athlete_id))
      .forEach((s) => {
        push(s.session_date, {
          type: 'bullpen',
          label: 'P',
          color: '#4C9BE8',
          detail: `${athleteName(s.athlete_id)} — Bullpen Session`,
          athleteId: s.athlete_id,
        });
      });

    gameSessions
      .filter((s) => selectedSet.has(s.athlete_id))
      .forEach((s) => {
        push(s.session_date, {
          type: 'game',
          label: 'G',
          color: STATUS_COLOR[s.status ?? 'in_progress'] ?? '#4C9BE8',
          detail: `${athleteName(s.athlete_id)} — Game${s.opponent ? ' vs ' + s.opponent : ''}`,
          athleteId: s.athlete_id,
        });
      });

    return map;
  }, [workouts, bullpenSessions, gameSessions, selectedIds, athleteName]);

  const toggleAthlete = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const dayEvents = selectedDate ? markedEvents[selectedDate] ?? [] : [];
  const allSelected = athletes.length > 0 && selectedIds.length === athletes.length;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Home</Text>
          <Pressable
            style={styles.settingsButton}
            onPress={() => Alert.alert('Coming Soon', 'Profile management is coming soon.')}
            hitSlop={10}
          >
            <SettingsIcon color="#888" size={22} />
          </Pressable>
        </View>

        <Pressable style={styles.button} onPress={() => router.push('/athletes')}>
          <Text style={styles.buttonText}>Athletes/Analytics</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => Alert.alert('Coming Soon', 'Managing workouts from Home is coming soon.')}
        >
          <Text style={styles.secondaryButtonText}>Manage Workouts</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Calendar</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <Pressable
            style={[styles.filterPill, allSelected && styles.filterPillActive]}
            onPress={() => setSelectedIds(athletes.map((a) => a.id))}
          >
            <Text style={[styles.filterPillText, allSelected && styles.filterPillTextActive]}>All</Text>
          </Pressable>
          {athletes.map((a) => (
            <Pressable
              key={a.id}
              style={[styles.filterPill, selectedIds.includes(a.id) && styles.filterPillActive]}
              onPress={() => toggleAthlete(a.id)}
            >
              <Text style={[styles.filterPillText, selectedIds.includes(a.id) && styles.filterPillTextActive]}>
                {a.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <ActivityIndicator style={{ marginVertical: 20 }} />
        ) : (
          <BoxedCalendar markedEvents={markedEvents} onDayPress={setSelectedDate} selectedDate={selectedDate} />
        )}

        <View style={styles.legendRow}>
          <LegendChip color="#4C9BE8" label="W = Workout" />
          <LegendChip color="#4C9BE8" label="P = Bullpen" />
          <LegendChip color="#4C9BE8" label="G = Game" />
        </View>
        <Text style={styles.legendNote}>Blue = scheduled/in progress · Green = completed · Red = missed</Text>
      </ScrollView>

      <Modal visible={!!selectedDate} animationType="slide" transparent onRequestClose={() => setSelectedDate(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedDate}</Text>
              <Pressable onPress={() => setSelectedDate(null)}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
            {dayEvents.length === 0 ? (
              <Text style={styles.emptyText}>Nothing on this day.</Text>
            ) : (
              dayEvents.map((e, i) => (
                <Pressable
                  key={i}
                  style={styles.eventRow}
                  onPress={() => {
                    setSelectedDate(null);
                    if (e.type === 'workout') {
                      router.push({
                        pathname: '/workouts',
                        params: { athleteId: e.athleteId, athleteName: athleteName(e.athleteId) },
                      });
                    } else {
                      router.push({ pathname: '/athlete', params: { id: e.athleteId, name: athleteName(e.athleteId) } });
                    }
                  }}
                >
                  <View style={[styles.eventDot, { backgroundColor: e.color }]} />
                  <Text style={styles.eventText}>{e.detail}</Text>
                </Pressable>
              ))
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold' },
  settingsButton: { padding: 4 },

  button: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: '#4C9BE8', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 12 },
  secondaryButtonText: { color: '#4C9BE8', fontSize: 14, fontWeight: '600' },

  sectionTitle: { fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 10 },

  filterScroll: { marginBottom: 12, flexGrow: 0 },
  filterPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#ddd', marginRight: 8 },
  filterPillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  filterPillText: { fontSize: 12, color: '#444' },
  filterPillTextActive: { color: '#fff', fontWeight: '600' },

  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 14, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { fontSize: 12, color: '#666' },
  legendNote: { fontSize: 11, color: '#999', textAlign: 'center', marginTop: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  closeText: { color: '#4C9BE8', fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginVertical: 20 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  eventDot: { width: 10, height: 10, borderRadius: 5 },
  eventText: { fontSize: 14, color: '#333', flex: 1 },
});
