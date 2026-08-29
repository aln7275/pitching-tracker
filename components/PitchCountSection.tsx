import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../supabase';
import {
  DailyMaxGuideline,
  DayPitchCount,
  RestGuideline,
  addDays,
  calculateAge,
  computeSuggestedRest,
  countForMode,
  dailyMaxForAge,
  formatShortDate,
  mondayOfWeek,
  restDaysForCount,
  restTiersForAge,
  toYMD,
} from '../types/pitchCount';

type Mode = 'all' | 'games';

export function PitchCountSection({
  athleteId,
  birthdate,
  dailyPitchLimitOverride,
}: {
  athleteId: number;
  birthdate: string | null;
  dailyPitchLimitOverride: number | null;
}) {
  const [mode, setMode] = useState<Mode>('all');
  const [restGuidelines, setRestGuidelines] = useState<RestGuideline[]>([]);
  const [maxGuidelines, setMaxGuidelines] = useState<DailyMaxGuideline[]>([]);
  const [dailyCounts, setDailyCounts] = useState<Record<string, DayPitchCount>>({});
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => toYMD(new Date()), []);
  const weekStart = useMemo(() => mondayOfWeek(today), [today]);
  const windowStart = useMemo(() => {
    const lookback = addDays(today, -4);
    return lookback < weekStart ? lookback : weekStart;
  }, [today, weekStart]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: rest }, { data: max }] = await Promise.all([
        supabase.from('pitch_rest_guidelines').select('*'),
        supabase.from('pitch_daily_max_guidelines').select('*'),
      ]);
      setRestGuidelines((rest ?? []) as RestGuideline[]);
      setMaxGuidelines((max ?? []) as DailyMaxGuideline[]);

      const [{ data: bullpenSessions }, { data: gameSessions }] = await Promise.all([
        supabase
          .from('sessions')
          .select('session_date, pitches(id)')
          .eq('athlete_id', athleteId)
          .eq('session_type', 'bullpen')
          .gte('session_date', windowStart)
          .lte('session_date', today),
        supabase
          .from('sessions')
          .select('session_date, innings(game_pitches(id))')
          .eq('athlete_id', athleteId)
          .eq('session_type', 'game')
          .gte('session_date', windowStart)
          .lte('session_date', today),
      ]);

      const counts: Record<string, DayPitchCount> = {};
      (bullpenSessions ?? []).forEach((s: any) => {
        const n = (s.pitches ?? []).length;
        const entry = (counts[s.session_date] ??= { bullpen: 0, game: 0 });
        entry.bullpen += n;
      });
      (gameSessions ?? []).forEach((s: any) => {
        const n = (s.innings ?? []).reduce((sum: number, i: any) => sum + (i.game_pitches ?? []).length, 0);
        const entry = (counts[s.session_date] ??= { bullpen: 0, game: 0 });
        entry.game += n;
      });
      setDailyCounts(counts);
      setLoading(false);
    })();
  }, [athleteId, windowStart, today]);

  const age = calculateAge(birthdate);

  if (loading) return null;

  if (age === null) {
    return (
      <View style={styles.promptCard}>
        <Text style={styles.promptText}>Set a birthdate to see pitch count guidance for this athlete.</Text>
      </View>
    );
  }

  const tiers = restTiersForAge(restGuidelines, age);
  const dailyMax = dailyPitchLimitOverride ?? dailyMaxForAge(maxGuidelines, age) ?? 0;
  const tierLines = tiers.filter((t) => t.pitch_max !== null).map((t) => t.pitch_max as number);

  const todayCount = countForMode(dailyCounts[today], mode);
  const todayRestDays = restDaysForCount(tiers, todayCount);

  let weekCount = 0;
  for (let i = 0; i < 7; i++) {
    weekCount += countForMode(dailyCounts[addDays(weekStart, i)], mode);
  }
  const weekEnd = addDays(weekStart, 6);
  const weekBullpen = (() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += dailyCounts[addDays(weekStart, i)]?.bullpen ?? 0;
    return sum;
  })();
  const weekGame = (() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += dailyCounts[addDays(weekStart, i)]?.game ?? 0;
    return sum;
  })();
  const weekBullpenCount = mode === 'games' ? 0 : weekBullpen;
  const weekGameCount = weekGame;

  const suggestedRest = computeSuggestedRest(today, dailyCounts, tiers, mode);

  const scaleMax = Math.max(dailyMax, todayCount, 1);
  const pct = (n: number) => Math.min(100, (n / scaleMax) * 100);

  const todayDay = dailyCounts[today];
  const todayBullpenPct = mode === 'games' ? 0 : pct(todayDay?.bullpen ?? 0);
  const todayGamePct = pct(todayDay?.game ?? 0);

  const weekScale = Math.max(weekBullpenCount + weekGameCount, 1);
  const weekBullpenPct = (weekBullpenCount / weekScale) * 100;
  const weekGamePct = (weekGameCount / weekScale) * 100;

  return (
    <View>
      <View style={styles.restCard}>
        <View style={styles.restIcon}>
          <View style={styles.restIconDot} />
        </View>
        <Text style={styles.restText}>
          {suggestedRest.eligible
            ? 'Eligible to pitch today'
            : `Suggested rest: ${suggestedRest.daysRemaining} more day${suggestedRest.daysRemaining === 1 ? '' : 's'} (until ${formatShortDate(suggestedRest.nextEligibleDate)})`}
        </Text>
      </View>
      <Text style={styles.disclaimer}>
        Suggested based on MLB/USA Baseball guidelines — confirm with your league.
      </Text>

      <Text style={styles.sectionLabel}>Pitch Count</Text>

      <View style={styles.toggleRow}>
        <Pressable style={[styles.togglePill, mode === 'all' && styles.togglePillActive]} onPress={() => setMode('all')}>
          <Text style={[styles.toggleText, mode === 'all' && styles.toggleTextActive]}>All</Text>
        </Pressable>
        <Pressable
          style={[styles.togglePill, mode === 'games' && styles.togglePillActive]}
          onPress={() => setMode('games')}
        >
          <Text style={[styles.toggleText, mode === 'games' && styles.toggleTextActive]}>Games Only</Text>
        </Pressable>
      </View>

      <View style={styles.chartCard}>
        <Text style={styles.miniLabel}>Today &middot; {formatShortDate(today)}</Text>
        <View style={styles.tierLabelRow}>
          {tierLines.map((v) => (
            <Text key={v} style={[styles.tierLabelText, { left: `${pct(v)}%` }]}>
              {v}
            </Text>
          ))}
          <Text style={[styles.tierLabelText, styles.tierLabelMax, { left: `${pct(dailyMax)}%` }]}>
            {dailyMax} max
          </Text>
        </View>
        <View style={styles.barRow}>
          <View style={styles.barTrack}>
            {tierLines.map((v) => (
              <View key={v} style={[styles.tierLine, { left: `${pct(v)}%` }]} />
            ))}
            <View style={[styles.tierLine, styles.tierLineMax, { left: `${pct(dailyMax)}%` }]} />
            {mode === 'all' && <View style={[styles.barSegment, styles.barBullpen, { width: `${todayBullpenPct}%` }]} />}
            <View
              style={[
                styles.barSegment,
                styles.barGame,
                { left: mode === 'all' ? `${todayBullpenPct}%` : '0%', width: `${todayGamePct}%` },
              ]}
            />
          </View>
          <Text style={styles.barCount}>{todayCount}</Text>
        </View>
        {todayRestDays > 0 && (
          <Text style={styles.tierNote}>
            {todayCount} pitches — {todayRestDays} day{todayRestDays === 1 ? '' : 's'} rest suggested
          </Text>
        )}

        <View style={styles.divider} />

        <Text style={styles.miniLabel}>
          This Week &middot; {formatShortDate(weekStart)}&ndash;{formatShortDate(weekEnd)}
        </Text>
        <View style={styles.barRow}>
          <View style={styles.barTrack}>
            {weekGamePct > 0 && <View style={[styles.barSegment, styles.barGame, { width: `${weekGamePct}%` }]} />}
            {weekBullpenPct > 0 && (
              <View
                style={[
                  styles.barSegment,
                  styles.barBullpen,
                  { left: `${weekGamePct}%`, width: `${weekBullpenPct}%` },
                ]}
              />
            )}
          </View>
          <Text style={styles.barCount}>{weekBullpenCount + weekGameCount}</Text>
        </View>
        <Text style={styles.weekNote}>No official weekly cap — shown for context only.</Text>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#4C9BE8' }]} />
            <Text style={styles.legendText}>Bullpen</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#3FB98A' }]} />
            <Text style={styles.legendText}>Game</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  promptCard: { backgroundColor: '#f7f8fa', borderRadius: 12, padding: 14, marginBottom: 16 },
  promptText: { fontSize: 12, color: '#888' },

  restCard: { backgroundColor: '#FBF1DC', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  restIcon: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.8, borderColor: '#B4881A', alignItems: 'center', justifyContent: 'center' },
  restIconDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#B4881A' },
  restText: { fontSize: 14, fontWeight: '600', color: '#8A6D1A', flex: 1 },
  disclaimer: { fontSize: 11, color: '#999', marginTop: 6, marginBottom: 18 },

  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },

  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  togglePill: { borderWidth: 1, borderColor: '#ddd', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  togglePillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  toggleText: { fontSize: 12, color: '#444' },
  toggleTextActive: { color: '#fff', fontWeight: '600' },

  chartCard: { backgroundColor: '#f7f8fa', borderRadius: 14, padding: 16, marginBottom: 20 },
  miniLabel: { fontSize: 10, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  tierLabelRow: { position: 'relative', height: 14, marginBottom: 4 },
  tierLabelText: { position: 'absolute', fontSize: 10, color: '#aaa', transform: [{ translateX: -8 }] },
  tierLabelMax: { fontWeight: '700', color: '#666' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barTrack: { flex: 1, height: 20, backgroundColor: '#ececec', borderRadius: 4, position: 'relative', overflow: 'hidden' },
  barSegment: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  barBullpen: { backgroundColor: '#4C9BE8' },
  barGame: { backgroundColor: '#3FB98A' },
  tierLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#d5d5d5' },
  tierLineMax: { width: 1.5, backgroundColor: '#999' },
  barCount: { width: 26, flexShrink: 0, fontSize: 13, fontWeight: '700', color: '#333' },
  tierNote: { fontSize: 11, color: '#8A6D1A', marginTop: 6 },
  weekNote: { fontSize: 11, color: '#999', marginTop: 6 },
  divider: { height: 1, backgroundColor: '#e5e5e5', marginVertical: 16 },
  legendRow: { flexDirection: 'row', gap: 16, marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { fontSize: 11, color: '#666' },
});
