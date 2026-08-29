import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BoxedCalendar, DayEvent } from '../components/BoxedCalendar';
import { BullpenDayCard } from '../components/BullpenDayCard';
import { GameDayCard } from '../components/GameDayCard';
import { SettingsIcon } from '../components/Icons';
import { WorkoutDayCard } from '../components/WorkoutDayCard';
import { supabase } from '../supabase';
import { BullpenSession } from '../types/bullpen';
import { GameSession } from '../types/game';
import { Workout } from '../types/workout';

type Athlete = { id: number; name: string };
type WorkoutRow = { id: number; athlete_id: number; scheduled_date: string; status: string; title: string | null };
type SessionRow = {
  id: number;
  athlete_id: number;
  session_date: string;
  session_type: string;
  status: string | null;
  opponent: string | null;
  game_subtype: string | null;
  session_time: string | null;
};

type AddType = 'workout' | 'bullpen' | 'game';
type Detail = { type: AddType; id: number; athleteId: number; athleteName: string };

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#4C9BE8',
  in_progress: '#4C9BE8',
  completed: '#3FB98A',
  submitted: '#3FB98A',
  missed: '#D6524F',
};

function todayYMD() {
  return new Date().toISOString().split('T')[0];
}

export default function HomeScreen() {
  const router = useRouter();
  const { focusAthleteId } = useLocalSearchParams<{ focusAthleteId?: string }>();
  const focusApplied = useRef(false);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  const [bullpenSessions, setBullpenSessions] = useState<SessionRow[]>([]);
  const [gameSessions, setGameSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailData, setDetailData] = useState<Workout | BullpenSession | GameSession | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [canEditAthlete, setCanEditAthlete] = useState(false);

  const [addVisible, setAddVisible] = useState(false);
  const [addDate, setAddDate] = useState<string>(todayYMD());
  const [addStep, setAddStep] = useState<'athlete' | 'type'>('type');
  const [addAthleteId, setAddAthleteId] = useState<number | null>(null);
  const [addAthleteName, setAddAthleteName] = useState('');
  // Set when the quick-add row (+Workout/+Bullpen/+Game) started the flow -
  // the type is already known then, so the type-picker step is skipped.
  const [addPresetType, setAddPresetType] = useState<AddType | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data: athleteData } = await supabase.from('athletes').select('id, name');
    const athleteList = (athleteData ?? []) as Athlete[];
    setAthletes(athleteList);
    if (focusAthleteId && !focusApplied.current) {
      focusApplied.current = true;
      setSelectedIds([Number(focusAthleteId)]);
    } else {
      setSelectedIds((prev) => (prev.length === 0 ? athleteList.map((a) => a.id) : prev));
    }

    const { data: workoutData } = await supabase
      .from('workouts')
      .select('id, athlete_id, scheduled_date, status, title');
    setWorkouts((workoutData ?? []) as WorkoutRow[]);

    const { data: sessionData } = await supabase
      .from('sessions')
      .select('id, athlete_id, session_date, session_type, status, opponent, game_subtype, session_time');
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

  const checkCanEdit = useCallback(async (athleteId: number) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: athlete } = await supabase.from('athletes').select('user_id').eq('id', athleteId).single();
    if (athlete?.user_id === user.id) return true;
    const { data: access } = await supabase
      .from('athlete_access')
      .select('access_level')
      .eq('athlete_id', athleteId)
      .eq('granted_to_user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    return access?.access_level === 'full';
  }, []);

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
          id: w.id,
          type: 'workout',
          label: 'W',
          color: STATUS_COLOR[w.status] ?? '#4C9BE8',
          detail: `${athleteName(w.athlete_id)} — Workout${w.title ? ': ' + w.title : ''} (${w.status})`,
          athleteId: w.athlete_id,
          status: w.status,
        });
      });

    bullpenSessions
      .filter((s) => selectedSet.has(s.athlete_id))
      .forEach((s) => {
        push(s.session_date, {
          id: s.id,
          type: 'bullpen',
          label: 'P',
          color: STATUS_COLOR[s.status ?? 'scheduled'] ?? '#4C9BE8',
          detail: `${athleteName(s.athlete_id)} — Bullpen (${s.status})`,
          athleteId: s.athlete_id,
          status: s.status ?? 'scheduled',
        });
      });

    gameSessions
      .filter((s) => selectedSet.has(s.athlete_id))
      .forEach((s) => {
        push(s.session_date, {
          id: s.id,
          type: 'game',
          label: 'G',
          color: STATUS_COLOR[s.status ?? 'scheduled'] ?? '#4C9BE8',
          detail: `${athleteName(s.athlete_id)} — Game${s.opponent ? ' vs ' + s.opponent : ''} (${s.status})`,
          athleteId: s.athlete_id,
          status: s.status ?? 'scheduled',
        });
      });

    return map;
  }, [workouts, bullpenSessions, gameSessions, selectedIds, athleteName]);

  const toggleAthlete = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const dayEvents = selectedDate ? markedEvents[selectedDate] ?? [] : [];
  const allSelected = athletes.length > 0 && selectedIds.length === athletes.length;

  const openDetail = async (e: DayEvent) => {
    if (e.type === 'game' && e.status === 'in_progress') {
      const s = gameSessions.find((g) => g.id === e.id);
      router.push({
        pathname: '/game-entry',
        params: {
          athleteId: e.athleteId,
          athleteName: athleteName(e.athleteId),
          sessionDate: s?.session_date ?? '',
          gameSubtype: s?.game_subtype ?? 'live',
          opponent: s?.opponent ?? '',
          resumeSessionId: e.id,
        },
      });
      return;
    }

    setCanEditAthlete(await checkCanEdit(e.athleteId));
    setDetail({ type: e.type, id: e.id, athleteId: e.athleteId, athleteName: athleteName(e.athleteId) });
  };

  useEffect(() => {
    if (!detail) {
      setDetailData(null);
      return;
    }
    (async () => {
      setDetailLoading(true);
      if (detail.type === 'workout') {
        const { data } = await supabase
          .from('workouts')
          .select('*, workout_exercises(*, exercises(*))')
          .eq('id', detail.id)
          .single();
        if (data) (data as any).workout_exercises.sort((a: any, b: any) => a.order_index - b.order_index);
        setDetailData(data as unknown as Workout);
      } else if (detail.type === 'bullpen') {
        const { data } = await supabase.from('sessions').select('*, pitches(*)').eq('id', detail.id).single();
        setDetailData(data as unknown as BullpenSession);
      } else {
        const { data } = await supabase
          .from('sessions')
          .select('*, innings(*, game_pitches(*))')
          .eq('id', detail.id)
          .single();
        setDetailData(data as unknown as GameSession);
      }
      setDetailLoading(false);
    })();
  }, [detail]);

  const closeDayModal = () => {
    setSelectedDate(null);
    setDetail(null);
  };

  const onDetailChanged = () => {
    setDetail(null);
    fetchAll();
  };

  const navigateForAdd = (athleteId: number, athleteNameVal: string, type: AddType, date: string) => {
    setAddVisible(false);
    const params = { athleteId, athleteName: athleteNameVal, date };
    if (type === 'workout') router.push({ pathname: '/workout-assign', params });
    else if (type === 'bullpen') router.push({ pathname: '/bullpen-schedule', params });
    else router.push({ pathname: '/game-schedule', params });
  };

  // presetType is set when the quick-add row started the flow - the type is
  // already known then, so the type-picker step is skipped entirely (and if
  // the athlete is also already resolved, so is the whole modal).
  const openAddFlow = (date: string, presetType?: AddType) => {
    setAddDate(date);
    setAddPresetType(presetType ?? null);
    if (selectedIds.length === 1) {
      const athId = selectedIds[0];
      const athName = athleteName(athId);
      setAddAthleteId(athId);
      setAddAthleteName(athName);
      if (presetType) {
        navigateForAdd(athId, athName, presetType, date);
        return;
      }
      setAddStep('type');
    } else {
      setAddAthleteId(null);
      setAddStep('athlete');
    }
    setSelectedDate(null);
    setAddVisible(true);
  };

  const pickAddAthlete = (a: Athlete) => {
    setAddAthleteId(a.id);
    setAddAthleteName(a.name);
    if (addPresetType) {
      navigateForAdd(a.id, a.name, addPresetType, addDate);
      return;
    }
    setAddStep('type');
  };

  const pickAddType = (type: AddType) => {
    if (!addAthleteId) return;
    navigateForAdd(addAthleteId, addAthleteName, type, addDate);
  };

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

        <Pressable style={styles.secondaryButton} onPress={() => router.push('/templates')}>
          <Text style={styles.secondaryButtonText}>Manage Workouts</Text>
        </Pressable>

        <View style={styles.quickAddRow}>
          <Pressable style={styles.quickAddButton} onPress={() => openAddFlow(todayYMD(), 'workout')}>
            <Text style={styles.quickAddButtonText}>+ Workout</Text>
          </Pressable>
          <Pressable style={styles.quickAddButton} onPress={() => openAddFlow(todayYMD(), 'bullpen')}>
            <Text style={styles.quickAddButtonText}>+ Bullpen</Text>
          </Pressable>
          <Pressable style={styles.quickAddButton} onPress={() => openAddFlow(todayYMD(), 'game')}>
            <Text style={styles.quickAddButtonText}>+ Game</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Calendar</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          {athletes.length > 1 && (
            <Pressable
              style={[styles.filterPill, allSelected && styles.filterPillActive]}
              onPress={() => setSelectedIds(athletes.map((a) => a.id))}
            >
              <Text style={[styles.filterPillText, allSelected && styles.filterPillTextActive]}>All</Text>
            </Pressable>
          )}
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

      {/* Day list / detail modal */}
      <Modal visible={!!selectedDate} animationType="slide" transparent onRequestClose={closeDayModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {detail ? detail.athleteName : selectedDate}
              </Text>
              <Pressable onPress={detail ? () => setDetail(null) : closeDayModal}>
                <Text style={styles.closeText}>{detail ? 'Back' : 'Close'}</Text>
              </Pressable>
            </View>

            {!detail ? (
              <>
                <ScrollView style={{ maxHeight: 400 }}>
                  {dayEvents.length === 0 ? (
                    <Text style={styles.emptyText}>Nothing on this day.</Text>
                  ) : (
                    dayEvents.map((e, i) => (
                      <Pressable key={i} style={styles.eventRow} onPress={() => openDetail(e)}>
                        <View style={[styles.eventDot, { backgroundColor: e.color }]} />
                        <Text style={styles.eventText}>{e.detail}</Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
                <Pressable style={styles.addDayButton} onPress={() => selectedDate && openAddFlow(selectedDate)}>
                  <Text style={styles.addDayButtonText}>+ Add</Text>
                </Pressable>
              </>
            ) : detailLoading || !detailData ? (
              <ActivityIndicator style={{ marginVertical: 30 }} />
            ) : (
              <ScrollView style={{ maxHeight: 500 }}>
                {detail.type === 'workout' && (
                  <WorkoutDayCard workout={detailData as Workout} canEdit={canEditAthlete} onChanged={onDetailChanged} />
                )}
                {detail.type === 'bullpen' && (
                  <BullpenDayCard
                    session={detailData as BullpenSession}
                    athleteId={detail.athleteId}
                    athleteName={detail.athleteName}
                    canEdit={canEditAthlete}
                    onChanged={onDetailChanged}
                  />
                )}
                {detail.type === 'game' && (
                  <GameDayCard
                    session={detailData as GameSession}
                    athleteId={detail.athleteId}
                    athleteName={detail.athleteName}
                    canEdit={canEditAthlete}
                    onChanged={onDetailChanged}
                  />
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Add flow modal */}
      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={() => setAddVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {addStep === 'athlete' ? 'Who is this for?' : `Add for ${addAthleteName}`}
              </Text>
              <Pressable onPress={() => setAddVisible(false)}>
                <Text style={styles.closeText}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.addDateText}>{addDate}</Text>

            {addStep === 'athlete' ? (
              athletes.map((a) => (
                <Pressable key={a.id} style={styles.pickerRow} onPress={() => pickAddAthlete(a)}>
                  <Text style={styles.pickerRowName}>{a.name}</Text>
                </Pressable>
              ))
            ) : (
              <View style={styles.typePickerColumn}>
                <Pressable style={styles.typeButton} onPress={() => pickAddType('workout')}>
                  <Text style={styles.typeButtonText}>Workout</Text>
                </Pressable>
                <Pressable style={styles.typeButton} onPress={() => pickAddType('bullpen')}>
                  <Text style={styles.typeButtonText}>Bullpen Session</Text>
                </Pressable>
                <Pressable style={styles.typeButton} onPress={() => pickAddType('game')}>
                  <Text style={styles.typeButtonText}>Game</Text>
                </Pressable>
              </View>
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

  quickAddRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  quickAddButton: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  quickAddButtonText: { fontSize: 13, fontWeight: '600', color: '#444' },

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
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  closeText: { color: '#4C9BE8', fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginVertical: 20 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  eventDot: { width: 10, height: 10, borderRadius: 5 },
  eventText: { fontSize: 14, color: '#333', flex: 1 },
  addDayButton: { borderWidth: 1, borderColor: '#4C9BE8', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  addDayButtonText: { color: '#4C9BE8', fontWeight: '600' },

  addDateText: { fontSize: 13, color: '#888', marginBottom: 16 },
  pickerRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  pickerRowName: { fontSize: 16, color: '#333' },
  typePickerColumn: { gap: 10 },
  typeButton: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 16, alignItems: 'center' },
  typeButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
