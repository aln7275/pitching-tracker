import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { supabase } from '../supabase';

type Session = {
  id: number;
  session_date: string;
  session_type: string;
  bullpen_subtype: string | null;
  notes: string | null;
  pitches: { outcome: string }[];
};

const DATE_RANGES = [
  { key: 'all-time', label: 'All Time' },
  { key: '1y', label: '1 Year' },
  { key: '3m', label: '3 Months' },
  { key: '1m', label: '1 Month' },
];

const SESSION_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'bullpen', label: 'Bullpen' },
  { key: 'game', label: 'Games' },
];

function summarize(pitches: { outcome: string }[]) {
  const counts = { T: 0, C: 0, N: 0 };
  pitches.forEach((p) => {
    if (p.outcome === 'T' || p.outcome === 'C' || p.outcome === 'N') counts[p.outcome]++;
  });
  const total = pitches.length;
  const targetPct = total === 0 ? 0 : Math.round((counts.T / total) * 100);

  let strikes = 0, balls = 0, k = 0, bb = 0;
  pitches.forEach((p) => {
    if (p.outcome === 'T' || p.outcome === 'C') strikes++;
    else balls++;
    if (strikes >= 3) { k++; strikes = 0; balls = 0; }
    else if (balls >= 4) { bb++; strikes = 0; balls = 0; }
  });

  return { counts, total, targetPct, k, bb };
}

function cutoffDate(range: string): Date | null {
  const d = new Date();
  if (range === '1y') d.setFullYear(d.getFullYear() - 1);
  else if (range === '3m') d.setMonth(d.getMonth() - 3);
  else if (range === '1m') d.setMonth(d.getMonth() - 1);
  else return null;
  return d;
}

function TCNBarChart({ dataPoints }: { dataPoints: { label: string; T: number; C: number; N: number }[] }) {
  const CHART_HEIGHT = 160;
  const maxTotal = Math.max(...dataPoints.map((d) => d.T + d.C + d.N), 1);

  return (
    <View>
      <View style={styles.customChartRow}>
        {dataPoints.map((d, i) => {
          const total = d.T + d.C + d.N;
          const scale = total === 0 ? 0 : CHART_HEIGHT / maxTotal;
          const tHeight = d.T * scale;
          const cHeight = d.C * scale;
          const nHeight = d.N * scale;

          return (
            <View key={i} style={styles.customBarColumn}>
              <View style={[styles.customBarStack, { height: CHART_HEIGHT }]}>
                {d.N > 0 && (
                  <View style={[styles.customSegment, { height: nHeight, backgroundColor: '#D6524F' }]}>
                    {nHeight > 16 && <Text style={styles.customSegmentText}>{d.N}</Text>}
                  </View>
                )}
                {d.C > 0 && (
                  <View style={[styles.customSegment, { height: cHeight, backgroundColor: '#E8A93B' }]}>
                    {cHeight > 16 && <Text style={styles.customSegmentText}>{d.C}</Text>}
                  </View>
                )}
                {d.T > 0 && (
                  <View style={[styles.customSegment, { height: tHeight, backgroundColor: '#3FB98A' }]}>
                    {tHeight > 16 && <Text style={styles.customSegmentText}>{d.T}</Text>}
                  </View>
                )}
              </View>
              <Text style={styles.customBarLabel}>{d.label}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#3FB98A' }]} />
          <Text style={styles.legendText}>T</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#E8A93B' }]} />
          <Text style={styles.legendText}>C</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#D6524F' }]} />
          <Text style={styles.legendText}>N</Text>
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
  const [sessionType, setSessionType] = useState('all');

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sessions')
      .select('*, pitches(outcome)')
      .eq('athlete_id', id)
      .order('session_date', { ascending: false });

    if (error) {
      console.log('Error fetching sessions:', error.message);
    } else {
      setSessions(data as Session[]);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchSessions();
    }, [fetchSessions])
  );

  const filteredSessions = useMemo(() => {
    const cutoff = cutoffDate(dateRange);
    return sessions.filter((s) => {
      if (sessionType !== 'all' && s.session_type !== sessionType) return false;
      if (cutoff) {
        const d = new Date(s.session_date + 'T00:00:00');
        if (d < cutoff) return false;
      }
      return true;
    });
  }, [sessions, dateRange, sessionType]);

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
          T: sum.counts.T,
          C: sum.counts.C,
          N: sum.counts.N,
          targetPct: sum.targetPct,
        };
      });
    }

    // Weekly buckets for longer ranges
    const buckets = new Map<string, any>();
    chronological.forEach((s) => {
      const d = new Date(s.session_date + 'T00:00:00');
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      const sum = summarize(s.pitches);

      if (!buckets.has(key)) {
        buckets.set(key, { weekStart, T: 0, C: 0, N: 0, total: 0 });
      }
      const b = buckets.get(key);
      b.T += sum.counts.T;
      b.C += sum.counts.C;
      b.N += sum.counts.N;
      b.total += sum.total;
    });

    return Array.from(buckets.values())
      .sort((a, b) => a.weekStart - b.weekStart)
      .map((b) => ({
        label: `${b.weekStart.getMonth() + 1}/${b.weekStart.getDate()}`,
        T: b.T,
        C: b.C,
        N: b.N,
        targetPct: b.total === 0 ? 0 : Math.round((b.T / b.total) * 100),
      }));
  }, [filteredSessions, granularity]);

  // Batters Faced totals — aggregated across the whole filtered range, not per data point
  const battersFacedTotals = useMemo(() => {
    const totals = filteredSessions.reduce(
      (acc, s) => {
        const sum = summarize(s.pitches);
        acc.k += sum.k;
        acc.bb += sum.bb;
        return acc;
      },
      { k: 0, bb: 0, hits: 0 } // hits stays 0 until Game tracking exists
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

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id.toString()}
        ListHeaderComponent={
          <>
            <Text style={styles.title}>{name}</Text>

            <Pressable
              style={styles.button}
              onPress={() =>
                router.push({ pathname: '/bullpen-setup', params: { athleteId: id, athleteName: name } })
              }
            >
              <Text style={styles.buttonText}>Start Bullpen Session</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>Analytics</Text>

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
            <View style={styles.filterRow}>
              {SESSION_TYPES.map((t) => (
                <Pressable
                  key={t.key}
                  style={[styles.filterPill, sessionType === t.key && styles.filterPillActive]}
                  onPress={() => setSessionType(t.key)}
                >
                  <Text style={[styles.filterPillText, sessionType === t.key && styles.filterPillTextActive]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {loading ? (
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
                <TCNBarChart dataPoints={dataPoints} />

                <Text style={styles.chartTitle}>Batters Faced Outcomes</Text>
                <View style={styles.statCard}>
                  <Text style={styles.statCardTotal}>{battersFacedTotals.battersFaced}</Text>
                  <Text style={styles.statCardTotalLabel}>Batters Faced</Text>

                  <View style={styles.statCardRow}>
                    <View style={styles.statCardItem}>
                      <Text style={[styles.statCardNumber, { color: '#3FB98A' }]}>
                        {battersFacedTotals.k}
                      </Text>
                      <Text style={styles.statCardLabel}>Ks</Text>
                      <Text style={styles.statCardSubtext}>{battersFacedTotals.kPct}%</Text>
                    </View>
                    <View style={styles.statCardItem}>
                      <Text style={[styles.statCardNumber, { color: '#94A3B8' }]}>
                        {battersFacedTotals.hits}
                      </Text>
                      <Text style={styles.statCardLabel}>Hits</Text>
                      <Text style={styles.statCardSubtext}>{battersFacedTotals.hitsPct}%</Text>
                    </View>
                    <View style={styles.statCardItem}>
                      <Text style={[styles.statCardNumber, { color: '#D6524F' }]}>
                        {battersFacedTotals.bb}
                      </Text>
                      <Text style={styles.statCardLabel}>BB</Text>
                      <Text style={styles.statCardSubtext}>{battersFacedTotals.bbPct}%</Text>
                    </View>
                  </View>
                </View>
              </>
            )}

            <Text style={styles.sectionTitle}>Past Sessions</Text>
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
              <Text style={styles.sessionType}>
                {item.session_type} {item.bullpen_subtype ? `· ${item.bullpen_subtype}` : ''}
              </Text>
              <View style={styles.statsRow}>
                <Text style={styles.statText}>T: {s.counts.T}</Text>
                <Text style={styles.statText}>C: {s.counts.C}</Text>
                <Text style={styles.statText}>N: {s.counts.N}</Text>
                <Text style={styles.statDivider}>|</Text>
                <Text style={styles.statText}>K: {s.k}</Text>
                <Text style={styles.statText}>BB: {s.bb}</Text>
              </View>
              {item.notes ? <Text style={styles.sessionNotes}>{item.notes}</Text> : null}
            </View>
          );
        }}
        ListEmptyComponent={!loading ? <Text style={styles.emptyText}>No sessions logged yet.</Text> : null}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 20 },
  button: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 30 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: {
    fontSize: 13,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 12,
  },
    customChartRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', marginBottom: 10 },
  customBarColumn: { alignItems: 'center', flex: 1 },
  customBarStack: { width: 32, justifyContent: 'flex-end' },
  customSegment: { width: '100%', justifyContent: 'center', alignItems: 'center' },
  customSegmentText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  customBarLabel: { fontSize: 11, color: '#888', marginTop: 6 },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: '#666' },
  
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#ddd' },
  filterPillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  filterPillText: { fontSize: 12, color: '#444' },
  filterPillTextActive: { color: '#fff', fontWeight: '600' },
  chartTitle: { fontSize: 13, fontWeight: '600', color: '#333', marginTop: 14, marginBottom: 8 },
  chart: { borderRadius: 12 },
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
  sessionRow: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 14, marginBottom: 10 },
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
});

