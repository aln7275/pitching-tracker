import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { ChatIcon, PencilIcon } from '../components/Icons';
import { supabase } from '../supabase';
import { MISSED_REASON_CHIPS, Workout, primaryMetric } from '../types/workout';

type Session = {
  id: number;
  session_date: string;
  session_type: string;
  bullpen_subtype: string | null;
  notes: string | null;
  pitches: { outcome: string }[];
};

type AthleteData = {
  user_id: string;
  name: string;
  birthdate: string | null;
  throwing_hand: string | null;
  sport: string;
  team_name: string | null;
  owner_relationship_label: string | null;
};

type PersonRow = {
  key: string;
  name: string;
  relationshipLabel: string | null;
  accessLevel: 'owner' | 'full' | 'view';
};

const DATE_RANGES = [
  { key: 'all-time', label: 'All Time' },
  { key: '1y', label: '1 Year' },
  { key: '3m', label: '3 Months' },
  { key: '1m', label: '1 Month' },
];

const ANALYTICS_TYPES = [
  { key: 'bullpen', label: 'Bullpen' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'games', label: 'Games' },
] as const;

const RELATIONSHIP_OPTIONS = ['Coach', 'Athlete', 'Parent'];

function roleColor(label: string | null): string {
  if (label === 'Coach') return '#4C9BE8';
  if (label === 'Athlete') return '#3FB98A';
  if (label === 'Parent') return '#E8A93B';
  return '#999';
}

function summarize(pitches: { outcome: string }[]) {
  const counts = { T: 0, C: 0, N: 0 };
  pitches.forEach((p) => {
    if (p.outcome === 'T' || p.outcome === 'C' || p.outcome === 'N') counts[p.outcome]++;
  });
  const total = pitches.length;
  const targetPct = total === 0 ? 0 : Math.round((counts.T / total) * 100);

  let strikes = 0, balls = 0, k = 0, bb = 0;
  pitches.forEach((p) => {
    // C is neutral: a competitive pitch is close enough to be hittable, so it
    // shouldn't auto-resolve as either a strike or a ball in the simulation.
    if (p.outcome === 'T') strikes++;
    else if (p.outcome === 'N') balls++;
    if (strikes >= 3) { k++; strikes = 0; balls = 0; }
    else if (balls >= 4) { bb++; strikes = 0; balls = 0; }
  });

  return { counts, total, targetPct, k, bb };
}

async function shareSession(item: Session) {
  const s = summarize(item.pitches);
  const battersFaced = s.k + s.bb;
  const battersFacedLine =
    battersFaced === 0 && s.total > 0
      ? `Batters Faced: 0 (all pitches were Competitive — no simulated K/BB)\n`
      : `Batters Faced: ${battersFaced}\n` + `K: ${s.k}  BB: ${s.bb}\n`;
  const message =
    `Bullpen Session — ${item.session_date}\n` +
    `${item.session_type}${item.bullpen_subtype ? ' · ' + item.bullpen_subtype : ''}\n\n` +
    `Pitches: ${s.total}\n` +
    `T: ${s.counts.T}  C: ${s.counts.C}  N: ${s.counts.N}\n` +
    `Target %: ${s.targetPct}%\n\n` +
    battersFacedLine +
    `Competitive pitches: ${s.counts.C} (neutral — don't count toward K/BB)` +
    (item.notes ? `\n\nNotes: ${item.notes}` : '');

  try {
    await Share.share({ message });
  } catch (error) {
    console.log('Share error:', error);
  }
}

function cutoffDate(range: string): Date | null {
  const d = new Date();
  if (range === '1y') d.setFullYear(d.getFullYear() - 1);
  else if (range === '3m') d.setMonth(d.getMonth() - 3);
  else if (range === '1m') d.setMonth(d.getMonth() - 1);
  else return null;
  return d;
}

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

function TCNBarChart({ totals }: { totals: { T: number; C: number; N: number } }) {
  const total = totals.T + totals.C + totals.N;
  const tWidth = total === 0 ? 0 : (totals.T / total) * 100;
  const cWidth = total === 0 ? 0 : (totals.C / total) * 100;
  const nWidth = total === 0 ? 0 : (totals.N / total) * 100;

  return (
    <View style={styles.tcnCard}>
      <View style={styles.tcnBar}>
        {totals.T > 0 && (
          <View style={[styles.tcnSegment, { width: `${tWidth}%`, backgroundColor: '#3FB98A' }]} />
        )}
        {totals.C > 0 && (
          <View style={[styles.tcnSegment, { width: `${cWidth}%`, backgroundColor: '#E8A93B' }]} />
        )}
        {totals.N > 0 && (
          <View style={[styles.tcnSegment, { width: `${nWidth}%`, backgroundColor: '#D6524F' }]} />
        )}
      </View>

      <View style={styles.tcnStatsRow}>
        <View style={styles.tcnStatItem}>
          <Text style={[styles.tcnStatNumber, { color: '#3FB98A' }]}>{totals.T}</Text>
          <Text style={styles.tcnStatLabel}>T</Text>
          <Text style={styles.tcnStatPct}>{Math.round(tWidth)}%</Text>
        </View>
        <View style={styles.tcnStatItem}>
          <Text style={[styles.tcnStatNumber, { color: '#E8A93B' }]}>{totals.C}</Text>
          <Text style={styles.tcnStatLabel}>C</Text>
          <Text style={styles.tcnStatPct}>{Math.round(cWidth)}%</Text>
        </View>
        <View style={styles.tcnStatItem}>
          <Text style={[styles.tcnStatNumber, { color: '#D6524F' }]}>{totals.N}</Text>
          <Text style={styles.tcnStatLabel}>N</Text>
          <Text style={styles.tcnStatPct}>{Math.round(nWidth)}%</Text>
        </View>
      </View>
    </View>
  );
}

export default function AthleteHomeScreen() {
  const { id, name } = useLocalSearchParams();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('all-time');
  const [activeType, setActiveType] = useState<'bullpen' | 'workouts' | 'games'>('bullpen');
  const [canLogSessions, setCanLogSessions] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Athlete profile data + edit state
  const [athleteData, setAthleteData] = useState<AthleteData | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBirthdate, setEditBirthdate] = useState<Date | null>(null);
  const [showBirthdatePicker, setShowBirthdatePicker] = useState(false);
  const [editThrowingHand, setEditThrowingHand] = useState<'R' | 'L' | null>(null);
  const [editSport, setEditSport] = useState<'baseball' | 'softball'>('baseball');
  const [editTeamName, setEditTeamName] = useState('');
  const [editOwnerRole, setEditOwnerRole] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // People (access) list
  const [people, setPeople] = useState<PersonRow[]>([]);

  // Workouts analytics
  const [workoutsForAnalytics, setWorkoutsForAnalytics] = useState<Workout[]>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<number | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sessions')
      .select('*, pitches(outcome)')
      .eq('athlete_id', id)
      .eq('session_type', 'bullpen')
      .order('session_date', { ascending: false });

    if (error) {
      console.log('Error fetching sessions:', error.message);
    } else {
      setSessions(data as Session[]);
    }
    setLoading(false);
  }, [id]);

  const fetchAthleteData = useCallback(async () => {
    const { data, error } = await supabase
      .from('athletes')
      .select('user_id, name, birthdate, throwing_hand, sport, team_name, owner_relationship_label')
      .eq('id', id)
      .single();

    if (error) {
      console.log('Error fetching athlete:', error.message);
    } else if (data) {
      setAthleteData(data as AthleteData);
    }
  }, [id]);

  const fetchPeople = useCallback(async () => {
    const { data: athlete } = await supabase
      .from('athletes')
      .select('user_id, owner_relationship_label')
      .eq('id', id)
      .single();
    if (!athlete) return;

    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', athlete.user_id)
      .single();

    const { data: grants } = await supabase
      .from('athlete_access')
      .select('granted_to_user_id, relationship_label, access_level, invited_email')
      .eq('athlete_id', id)
      .eq('status', 'active');

    const grantUserIds = (grants ?? [])
      .map((g) => g.granted_to_user_id)
      .filter((x): x is string => x !== null);

    const nameMap: Record<string, string> = {};
    if (grantUserIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', grantUserIds);
      profiles?.forEach((p) => {
        if (p.name) nameMap[p.id] = p.name;
      });
    }

    const rows: PersonRow[] = [
      {
        key: 'owner',
        name: ownerProfile?.name ?? 'Owner',
        relationshipLabel: athlete.owner_relationship_label,
        accessLevel: 'owner',
      },
      ...(grants ?? []).map((g, i) => ({
        key: `grant-${i}`,
        name: (g.granted_to_user_id && nameMap[g.granted_to_user_id]) || g.invited_email,
        relationshipLabel: g.relationship_label,
        accessLevel: g.access_level as 'full' | 'view',
      })),
    ];
    setPeople(rows);
  }, [id]);

  const fetchWorkoutsForAnalytics = useCallback(async () => {
    const { data } = await supabase
      .from('workouts')
      .select('*, workout_exercises(*, exercises(*))')
      .eq('athlete_id', id)
      .order('scheduled_date', { ascending: true });
    if (data) {
      const rows = data as unknown as Workout[];
      rows.forEach((w) => w.workout_exercises.sort((a, b) => a.order_index - b.order_index));
      setWorkoutsForAnalytics(rows);
    }
  }, [id]);

  const fetchUnreadMessages = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: view } = await supabase
      .from('message_views')
      .select('last_viewed_at')
      .eq('user_id', user.id)
      .eq('athlete_id', id)
      .maybeSingle();

    let query = supabase.from('messages').select('id', { count: 'exact', head: true }).eq('athlete_id', id);
    if (view) query = query.gt('created_at', view.last_viewed_at);
    const { count } = await query;
    setUnreadMessages(count ?? 0);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchSessions();
    }, [fetchSessions])
  );

  useFocusEffect(
    useCallback(() => {
      fetchAthleteData();
    }, [fetchAthleteData])
  );

  useFocusEffect(
    useCallback(() => {
      fetchPeople();
    }, [fetchPeople])
  );

  useFocusEffect(
    useCallback(() => {
      fetchWorkoutsForAnalytics();
    }, [fetchWorkoutsForAnalytics])
  );

  useFocusEffect(
    useCallback(() => {
      fetchUnreadMessages();
    }, [fetchUnreadMessages])
  );

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: athlete } = await supabase
          .from('athletes')
          .select('user_id')
          .eq('id', id)
          .single();

        if (athlete?.user_id === user.id) {
          setIsOwner(true);
          setCanLogSessions(true);
          return;
        }
        setIsOwner(false);

        const { data: access } = await supabase
          .from('athlete_access')
          .select('access_level')
          .eq('athlete_id', id)
          .eq('granted_to_user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();

        setCanLogSessions(access?.access_level === 'full');
      })();
    }, [id])
  );

  const openEditModal = () => {
    if (!athleteData) return;
    setEditName(athleteData.name);
    setEditBirthdate(athleteData.birthdate ? new Date(athleteData.birthdate + 'T00:00:00') : null);
    setEditThrowingHand((athleteData.throwing_hand as 'R' | 'L' | null) ?? null);
    setEditSport((athleteData.sport as 'baseball' | 'softball') ?? 'baseball');
    setEditTeamName(athleteData.team_name ?? '');
    setEditOwnerRole(athleteData.owner_relationship_label);
    setEditModalVisible(true);
  };

  const saveAthleteEdit = async () => {
    if (!editName.trim()) {
      Alert.alert('Missing name', 'Athlete name cannot be empty.');
      return;
    }
    setSavingEdit(true);

    const { error } = await supabase
      .from('athletes')
      .update({
        name: editName.trim(),
        birthdate: editBirthdate ? editBirthdate.toISOString().split('T')[0] : null,
        throwing_hand: editThrowingHand,
        sport: editSport,
        team_name: editTeamName.trim() || null,
        owner_relationship_label: editOwnerRole,
      })
      .eq('id', id);

    setSavingEdit(false);

    if (error) {
      Alert.alert('Error saving changes', error.message);
      return;
    }

    setEditModalVisible(false);
    fetchAthleteData();
    fetchPeople();
  };

  const filteredSessions = useMemo(() => {
    const cutoff = cutoffDate(dateRange);
    return sessions.filter((s) => {
      if (cutoff) {
        const d = new Date(s.session_date + 'T00:00:00');
        if (d < cutoff) return false;
      }
      return true;
    });
  }, [sessions, dateRange]);

  const granularity = dateRange === '1m' || dateRange === '3m' ? 'session' : 'week';

  const dataPoints = useMemo(() => {
    const chronological = [...filteredSessions].sort((a, b) =>
      a.session_date.localeCompare(b.session_date)
    );

    if (granularity === 'session') {
      return chronological.map((s) => {
        const sum = summarize(s.pitches);
        const d = new Date(s.session_date + 'T00:00:00');
        return {
          label: `${d.getMonth() + 1}/${d.getDate()}`,
          targetPct: sum.targetPct,
        };
      });
    }

    const buckets = new Map<string, any>();
    chronological.forEach((s) => {
      const d = new Date(s.session_date + 'T00:00:00');
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      const sum = summarize(s.pitches);

      if (!buckets.has(key)) {
        buckets.set(key, { weekStart, T: 0, total: 0 });
      }
      const b = buckets.get(key);
      b.T += sum.counts.T;
      b.total += sum.total;
    });

    return Array.from(buckets.values())
      .sort((a, b) => a.weekStart - b.weekStart)
      .map((b) => ({
        label: `${b.weekStart.getMonth() + 1}/${b.weekStart.getDate()}`,
        targetPct: b.total === 0 ? 0 : Math.round((b.T / b.total) * 100),
      }));
  }, [filteredSessions, granularity]);

  const tcnTotals = useMemo(() => {
    return filteredSessions.reduce(
      (acc, s) => {
        const sum = summarize(s.pitches);
        acc.T += sum.counts.T;
        acc.C += sum.counts.C;
        acc.N += sum.counts.N;
        return acc;
      },
      { T: 0, C: 0, N: 0 }
    );
  }, [filteredSessions]);

  const battersFacedTotals = useMemo(() => {
    const totals = filteredSessions.reduce(
      (acc, s) => {
        const sum = summarize(s.pitches);
        acc.k += sum.k;
        acc.bb += sum.bb;
        return acc;
      },
      { k: 0, bb: 0, hits: 0 }
    );
    const battersFaced = totals.k + totals.bb + totals.hits;
    return {
      battersFaced,
      k: totals.k,
      bb: totals.bb,
      hits: totals.hits,
      kPct: battersFaced === 0 ? 0 : Math.round((totals.k / battersFaced) * 100),
      bbPct: battersFaced === 0 ? 0 : Math.round((totals.bb / battersFaced) * 100),
      hitsPct: battersFaced === 0 ? 0 : Math.round((totals.hits / battersFaced) * 100),
    };
  }, [filteredSessions]);

  const filteredWorkouts = useMemo(() => {
    const cutoff = cutoffDate(dateRange);
    if (!cutoff) return workoutsForAnalytics;
    return workoutsForAnalytics.filter((w) => new Date(w.scheduled_date + 'T00:00:00') >= cutoff);
  }, [workoutsForAnalytics, dateRange]);

  const complianceTotals = useMemo(() => {
    const total = filteredWorkouts.length;
    const completed = filteredWorkouts.filter((w) => w.status === 'completed').length;
    const missed = filteredWorkouts.filter((w) => w.status === 'missed').length;
    const scheduled = filteredWorkouts.filter((w) => w.status === 'scheduled').length;
    const reasonCounts: Record<string, number> = {};
    filteredWorkouts
      .filter((w) => w.status === 'missed')
      .forEach((w) => {
        const chip = MISSED_REASON_CHIPS.find((c) => w.missed_reason?.startsWith(c)) ?? 'Other';
        reasonCounts[chip] = (reasonCounts[chip] ?? 0) + 1;
      });
    return { total, completed, missed, scheduled, reasonCounts };
  }, [filteredWorkouts]);

  const loggedExercises = useMemo(() => {
    const map = new Map<number, string>();
    filteredWorkouts.forEach((w) => {
      w.workout_exercises.forEach((we) => {
        if (primaryMetric(we)) map.set(we.exercise_id, we.exercises.name);
      });
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [filteredWorkouts]);

  const progressData = useMemo(() => {
    if (!selectedExerciseId) return { label: '', points: [] as { date: string; value: number }[] };
    const byDate = new Map<string, number>();
    let unitLabel = '';
    filteredWorkouts.forEach((w) => {
      w.workout_exercises
        .filter((we) => we.exercise_id === selectedExerciseId)
        .forEach((we) => {
          const m = primaryMetric(we);
          if (!m) return;
          unitLabel = m.label;
          const existing = byDate.get(w.scheduled_date);
          if (existing === undefined || m.value > existing) byDate.set(w.scheduled_date, m.value);
        });
    });
    const points = Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
    return { label: unitLabel, points };
  }, [filteredWorkouts, selectedExerciseId]);

  const screenWidth = Dimensions.get('window').width - 40;

  const chartConfig = {
    backgroundColor: '#fff',
    backgroundGradientFrom: '#fff',
    backgroundGradientTo: '#fff',
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(76, 155, 232, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(100, 100, 100, ${opacity})`,
    barPercentage: 0.6,
  };

  const displayName = athleteData?.name ?? name;
  const age = athleteData ? calculateAge(athleteData.birthdate) : null;

  return (
    <View style={styles.container}>
      <FlatList
        data={activeType === 'bullpen' ? sessions : []}
        keyExtractor={(item) => item.id.toString()}
        ListHeaderComponent={
          <>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{displayName}</Text>
              {isOwner && (
                <Pressable onPress={openEditModal} style={styles.editPencil}>
                  <PencilIcon color="#888" size={16} />
                </Pressable>
              )}
            </View>

            {athleteData && (
              <View style={styles.metaRow}>
                {age !== null && <Text style={styles.metaText}>Age {age}</Text>}
                {athleteData.throwing_hand && (
                  <Text style={styles.metaText}>{athleteData.throwing_hand}HP</Text>
                )}
                <Text style={styles.metaText}>
                  {athleteData.sport === 'softball' ? 'Softball' : 'Baseball'}
                </Text>
                {athleteData.team_name && (
                  <Text style={styles.metaText}>{athleteData.team_name}</Text>
                )}
              </View>
            )}

            {people.length > 0 && (
              <View style={styles.peopleCard}>
                {people.map((p) => (
                  <View key={p.key} style={styles.personRow}>
                    <View style={[styles.avatar, { backgroundColor: roleColor(p.relationshipLabel) }]}>
                      <Text style={styles.avatarText}>{p.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personName}>{p.name}</Text>
                      <Text style={styles.personRole}>
                        {p.relationshipLabel ?? 'No role set'} ·{' '}
                        {p.accessLevel === 'owner' ? 'Owner' : p.accessLevel === 'full' ? 'Full access' : 'View access'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <Pressable
              style={styles.manageAccessLink}
              onPress={() =>
                router.push({ pathname: '/athlete-access', params: { athleteId: id, athleteName: name } })
              }
            >
              <Text style={styles.manageAccessLinkText}>Manage Access</Text>
            </Pressable>

            <Pressable
              style={styles.messageButton}
              onPress={() =>
                router.push({ pathname: '/messages', params: { athleteId: id, athleteName: name } })
              }
            >
              <ChatIcon color="#4C9BE8" size={16} />
              <Text style={styles.messageButtonText}>Message</Text>
              {unreadMessages > 0 && (
                <View style={styles.messageBadge}>
                  <Text style={styles.messageBadgeText}>{unreadMessages}</Text>
                </View>
              )}
            </Pressable>

            {canLogSessions && (
              <Pressable
                style={styles.button}
                onPress={() =>
                  router.push({ pathname: '/bullpen-setup', params: { athleteId: id, athleteName: name } })
                }
              >
                <Text style={styles.buttonText}>Start Bullpen Session</Text>
              </Pressable>
            )}

            <Pressable
              style={styles.secondaryButton}
              onPress={() =>
                router.push({ pathname: '/workouts', params: { athleteId: id, athleteName: name } })
              }
            >
              <Text style={styles.secondaryButtonText}>Workouts</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>Analytics</Text>

            <View style={styles.filterRow}>
              {ANALYTICS_TYPES.map((t) => (
                <Pressable
                  key={t.key}
                  style={[
                    styles.typePill,
                    activeType === t.key && styles.typePillActive,
                    t.key === 'games' && styles.typePillDisabled,
                  ]}
                  onPress={() => t.key !== 'games' && setActiveType(t.key)}
                >
                  <Text
                    style={[
                      styles.typePillText,
                      activeType === t.key && styles.typePillTextActive,
                      t.key === 'games' && styles.typePillTextDisabled,
                    ]}
                  >
                    {t.label}
                    {t.key === 'games' ? ' · Soon' : ''}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.filterRow}>
              {DATE_RANGES.map((r) => (
                <Pressable
                  key={r.key}
                  style={[styles.filterPill, dateRange === r.key && styles.filterPillActive]}
                  onPress={() => setDateRange(r.key)}
                >
                  <Text style={[styles.filterPillText, dateRange === r.key && styles.filterPillTextActive]}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {activeType === 'bullpen' &&
              (loading ? (
                <ActivityIndicator style={{ marginVertical: 20 }} />
              ) : filteredSessions.length === 0 ? (
                <Text style={styles.emptyText}>No sessions in this range.</Text>
              ) : (
                <>
                  <Text style={styles.chartTitle}>Target % Trend</Text>
                  <LineChart
                    data={{
                      labels: dataPoints.map((d) => d.label),
                      datasets: [{ data: dataPoints.map((d) => d.targetPct) }],
                    }}
                    width={screenWidth}
                    height={180}
                    yAxisSuffix="%"
                    chartConfig={chartConfig}
                    bezier
                    style={styles.chart}
                  />
                  <Text style={styles.chartTitle}>T / C / N Breakdown</Text>
                  <TCNBarChart totals={tcnTotals} />
                  <Text style={styles.chartTitle}>Simulated Batters Faced</Text>
                  <View style={styles.statCard}>
                    {battersFacedTotals.battersFaced === 0 && tcnTotals.T + tcnTotals.C + tcnTotals.N > 0 ? (
                      <>
                        <Text style={styles.statCardTotal}>—</Text>
                        <Text style={styles.statCardTotalLabel}>No Simulated At-Bats Yet</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.statCardTotal}>{battersFacedTotals.battersFaced}</Text>
                        <Text style={styles.statCardTotalLabel}>Simulated Batters Faced</Text>

                        <View style={styles.statCardRow}>
                          <View style={styles.statCardItem}>
                            <Text style={[styles.statCardNumber, { color: '#3FB98A' }]}>
                              {battersFacedTotals.k}
                            </Text>
                            <Text style={styles.statCardLabel}>Ks</Text>
                            <Text style={styles.statCardSubtext}>{battersFacedTotals.kPct}%</Text>
                          </View>

                          <View style={styles.statCardItem}>
                            <Text style={[styles.statCardNumber, { color: '#D6524F' }]}>
                              {battersFacedTotals.bb}
                            </Text>
                            <Text style={styles.statCardLabel}>BB</Text>
                            <Text style={styles.statCardSubtext}>{battersFacedTotals.bbPct}%</Text>
                          </View>
                        </View>
                      </>
                    )}

                    <View style={styles.statCardCNote}>
                      <Text style={styles.statCardCNoteText}>
                        <Text style={styles.statCardCNoteNumber}>{tcnTotals.C}</Text> Competitive
                        pitch{tcnTotals.C === 1 ? '' : 'es'} thrown — close misses, neutral in this
                        model (don't count toward K/BB)
                      </Text>
                    </View>
                  </View>
                </>
              ))}

            {activeType === 'workouts' && (
              <>
                <Text style={styles.chartTitle}>Compliance</Text>
                <View style={styles.statCard}>
                  <Text style={styles.statCardTotal}>{complianceTotals.total}</Text>
                  <Text style={styles.statCardTotalLabel}>Workouts in Range</Text>
                  <View style={styles.statCardRow}>
                    <View style={styles.statCardItem}>
                      <Text style={[styles.statCardNumber, { color: '#3FB98A' }]}>
                        {complianceTotals.completed}
                      </Text>
                      <Text style={styles.statCardLabel}>Completed</Text>
                    </View>
                    <View style={styles.statCardItem}>
                      <Text style={[styles.statCardNumber, { color: '#D6524F' }]}>
                        {complianceTotals.missed}
                      </Text>
                      <Text style={styles.statCardLabel}>Missed</Text>
                    </View>
                    <View style={styles.statCardItem}>
                      <Text style={[styles.statCardNumber, { color: '#4C9BE8' }]}>
                        {complianceTotals.scheduled}
                      </Text>
                      <Text style={styles.statCardLabel}>Scheduled</Text>
                    </View>
                  </View>
                  {complianceTotals.missed > 0 && (
                    <View style={styles.statCardCNote}>
                      <Text style={styles.statCardCNoteText}>
                        Missed reasons:{' '}
                        {Object.entries(complianceTotals.reasonCounts)
                          .map(([reason, count]) => `${reason} (${count})`)
                          .join('  ·  ')}
                      </Text>
                    </View>
                  )}
                </View>

                <Text style={styles.chartTitle}>Exercise Progress</Text>
                {loggedExercises.length === 0 ? (
                  <Text style={styles.emptyText}>Log actual values on some exercises to see progress here.</Text>
                ) : (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
                      {loggedExercises.map((e) => (
                        <Pressable
                          key={e.id}
                          style={[styles.categoryPill, selectedExerciseId === e.id && styles.filterPillActive]}
                          onPress={() => setSelectedExerciseId(e.id)}
                        >
                          <Text
                            style={[
                              styles.filterPillText,
                              selectedExerciseId === e.id && styles.filterPillTextActive,
                            ]}
                          >
                            {e.name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>

                    {selectedExerciseId && progressData.points.length > 0 && (
                      <LineChart
                        data={{
                          labels: progressData.points.map((p) => {
                            const d = new Date(p.date + 'T00:00:00');
                            return `${d.getMonth() + 1}/${d.getDate()}`;
                          }),
                          datasets: [{ data: progressData.points.map((p) => p.value) }],
                        }}
                        width={screenWidth}
                        height={180}
                        yAxisSuffix={` ${progressData.label}`}
                        chartConfig={chartConfig}
                        bezier
                        style={styles.chart}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {activeType === 'games' && (
              <Text style={styles.emptyText}>Game tracking is coming soon.</Text>
            )}

            {activeType === 'bullpen' && <Text style={styles.sectionTitle}>Past Sessions</Text>}
          </>
        }
        renderItem={({ item }) => {
          const s = summarize(item.pitches);
          return (
            <View style={styles.sessionRow}>
              <View style={styles.sessionHeader}>
                <Text style={styles.sessionDate}>{item.session_date}</Text>
                <View style={styles.headerRight}>
                  <Text style={styles.targetPct}>{s.targetPct}% T</Text>
                  <Text style={styles.pitchTotal}>{s.total} pitches</Text>
                </View>
              </View>
              <Pressable style={styles.shareButton} onPress={() => shareSession(item)}>
                <Text style={styles.shareButtonText}>Share Results</Text>
              </Pressable>
              <Text style={styles.sessionType}>
                {item.session_type} {item.bullpen_subtype ? `· ${item.bullpen_subtype}` : ''}
              </Text>
              <View style={styles.statsRow}>
                <Text style={styles.statText}>T: {s.counts.T}</Text>
                <Text style={styles.statText}>C: {s.counts.C}</Text>
                <Text style={styles.statText}>N: {s.counts.N}</Text>
                <Text style={styles.statDivider}>|</Text>
                <Text style={styles.statText}>    Batters Faced: {s.k + s.bb}</Text>
                <Text style={styles.statText}>K: {s.k}</Text>
                <Text style={styles.statText}>BB: {s.bb}</Text>
              </View>
              {item.notes ? <Text style={styles.sessionNotes}>{item.notes}</Text> : null}
            </View>
          );
        }}
        ListEmptyComponent={
          activeType === 'bullpen' && !loading ? <Text style={styles.emptyText}>No sessions logged yet.</Text> : null
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />

      <Modal visible={editModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Athlete</Text>

            <TextInput
              style={styles.input}
              placeholder="Athlete name"
              value={editName}
              onChangeText={setEditName}
            />

            <Pressable style={styles.input} onPress={() => setShowBirthdatePicker(true)}>
              <Text style={{ color: editBirthdate ? '#000' : '#999' }}>
                {editBirthdate ? editBirthdate.toLocaleDateString() : 'Birthdate (optional)'}
              </Text>
            </Pressable>

            {showBirthdatePicker && (
              <DateTimePicker
                value={editBirthdate ?? new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selectedDate) => {
                  setShowBirthdatePicker(false);
                  if (selectedDate) setEditBirthdate(selectedDate);
                }}
              />
            )}

            <Text style={styles.smallLabel}>Throwing Hand</Text>
            <View style={styles.toggleRow}>
              <Pressable
                style={[styles.togglePill, editThrowingHand === 'R' && styles.togglePillActive]}
                onPress={() => setEditThrowingHand('R')}
              >
                <Text style={[styles.toggleText, editThrowingHand === 'R' && styles.toggleTextActive]}>
                  Right
                </Text>
              </Pressable>
              <Pressable
                style={[styles.togglePill, editThrowingHand === 'L' && styles.togglePillActive]}
                onPress={() => setEditThrowingHand('L')}
              >
                <Text style={[styles.toggleText, editThrowingHand === 'L' && styles.toggleTextActive]}>
                  Left
                </Text>
              </Pressable>
            </View>

            <Text style={styles.smallLabel}>Sport</Text>
            <View style={styles.toggleRow}>
              <Pressable
                style={[styles.togglePill, editSport === 'baseball' && styles.togglePillActive]}
                onPress={() => setEditSport('baseball')}
              >
                <Text style={[styles.toggleText, editSport === 'baseball' && styles.toggleTextActive]}>
                  Baseball
                </Text>
              </Pressable>
              <Pressable
                style={[styles.togglePill, editSport === 'softball' && styles.togglePillActive]}
                onPress={() => setEditSport('softball')}
              >
                <Text style={[styles.toggleText, editSport === 'softball' && styles.toggleTextActive]}>
                  Softball
                </Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Team name (optional)"
              value={editTeamName}
              onChangeText={setEditTeamName}
            />

            <Text style={styles.smallLabel}>Your Role</Text>
            <View style={styles.toggleRow}>
              {RELATIONSHIP_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.togglePill, editOwnerRole === option && styles.togglePillActive]}
                  onPress={() => setEditOwnerRole(option)}
                >
                  <Text style={[styles.toggleText, editOwnerRole === option && styles.toggleTextActive]}>
                    {option}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.saveButton]}
                onPress={saveAthleteEdit}
                disabled={savingEdit}
              >
                <Text style={styles.saveButtonText}>{savingEdit ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  title: { fontSize: 28, fontWeight: 'bold' },
  editPencil: { padding: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  metaText: { fontSize: 13, color: '#888' },

  peopleCard: { backgroundColor: '#f7f8fa', borderRadius: 14, borderWidth: 1, borderColor: '#eee', padding: 6, marginBottom: 8 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  personName: { fontSize: 14, fontWeight: '600', color: '#222' },
  personRole: { fontSize: 11, color: '#999', marginTop: 1 },

  manageAccessLink: { alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 18 },
  manageAccessLinkText: { fontSize: 12, color: '#4C9BE8', fontWeight: '600' },

  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#4C9BE8',
    borderRadius: 10,
    padding: 13,
    marginBottom: 14,
  },
  messageButtonText: { fontSize: 14, color: '#4C9BE8', fontWeight: '600' },
  messageBadge: {
    backgroundColor: '#D6524F',
    borderRadius: 9,
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    alignItems: 'center',
  },
  messageBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  button: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 14 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: '#4C9BE8', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 30 },
  secondaryButtonText: { color: '#4C9BE8', fontSize: 14, fontWeight: '600' },
  sectionTitle: {
    fontSize: 13,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 12,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#ddd' },
  filterPillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  filterPillText: { fontSize: 12, color: '#444' },
  filterPillTextActive: { color: '#fff', fontWeight: '600' },

  typePill: { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  typePillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  typePillDisabled: { backgroundColor: '#fafafa', borderColor: '#eee' },
  typePillText: { fontSize: 13, color: '#444' },
  typePillTextActive: { color: '#fff', fontWeight: '600' },
  typePillTextDisabled: { color: '#bbb' },

  chartTitle: { fontSize: 13, fontWeight: '600', color: '#333', marginTop: 14, marginBottom: 8 },
  chart: { borderRadius: 12, borderWidth: 1, borderColor: '#eee' },

  tcnCard: { backgroundColor: '#f7f8fa', borderRadius: 14, borderWidth: 1, borderColor: '#eee', padding: 18, marginBottom: 10 },
  tcnBar: { flexDirection: 'row', height: 36, borderRadius: 8, overflow: 'hidden', marginBottom: 16 },
  tcnSegment: { height: '100%' },
  tcnStatsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  tcnStatItem: { alignItems: 'center' },
  tcnStatNumber: { fontSize: 24, fontWeight: 'bold' },
  tcnStatLabel: { fontSize: 12, color: '#666', marginTop: 2 },
  tcnStatPct: { fontSize: 12, color: '#999', marginTop: 2 },

  statCard: { backgroundColor: '#f7f8fa', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 10 },
  statCardTotal: { fontSize: 32, fontWeight: 'bold', color: '#333' },
  statCardTotalLabel: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  statCardRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%' },
  statCardItem: { alignItems: 'center' },
  statCardNumber: { fontSize: 24, fontWeight: 'bold' },
  statCardLabel: { fontSize: 12, color: '#666', marginTop: 2 },
  statCardSubtext: { fontSize: 12, color: '#999', marginTop: 2 },
  statCardCNote: {
    width: '100%',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  statCardCNoteText: { fontSize: 12, color: '#888', textAlign: 'center', lineHeight: 17 },
  statCardCNoteNumber: { color: '#E8A93B', fontWeight: '700' },

  categoryScroll: { marginBottom: 12, flexGrow: 0 },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    marginRight: 8,
  },

  sessionRow: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 14, marginBottom: 10 },
  shareButton: { alignSelf: 'flex-start', marginTop: 8, marginBottom: 4 },
  shareButtonText: { fontSize: 12, color: '#4C9BE8', fontWeight: '600' },
  sessionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerRight: { alignItems: 'flex-end' },
  sessionDate: { fontSize: 16, fontWeight: '600' },
  targetPct: { fontSize: 15, fontWeight: '700', color: '#3FB98A' },
  pitchTotal: { fontSize: 12, color: '#888' },
  sessionType: { fontSize: 13, color: '#666', marginTop: 2, textTransform: 'capitalize' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  statText: { fontSize: 13, fontWeight: '600', color: '#444' },
  statDivider: { fontSize: 13, color: '#ccc' },
  sessionNotes: { fontSize: 13, color: '#888', marginTop: 6, fontStyle: 'italic' },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginVertical: 20 },

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
    maxHeight: '85%',
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
    marginBottom: 16,
  },
  smallLabel: { fontSize: 11, color: '#888', marginBottom: 6, textTransform: 'uppercase' },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  togglePill: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  togglePillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  toggleText: { fontSize: 14, color: '#444' },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
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
