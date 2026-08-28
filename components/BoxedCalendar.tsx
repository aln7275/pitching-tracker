import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type DayEvent = {
  type: 'workout' | 'bullpen' | 'game';
  label: string; // short chip letter, e.g. 'W'
  color: string;
  detail: string; // full text shown in the day-detail list
  athleteId: number;
};

function toYMD(d: Date) {
  return d.toISOString().split('T')[0];
}

function buildGrid(monthCursor: Date) {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const gridStart = new Date(year, month, 1 - startOffset);
  const days: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push({ date: d, inMonth: d.getMonth() === month });
  }
  return days;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function BoxedCalendar({
  markedEvents,
  onDayPress,
  selectedDate,
}: {
  markedEvents: Record<string, DayEvent[]>;
  onDayPress: (dateStr: string) => void;
  selectedDate: string | null;
}) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const days = buildGrid(monthCursor);
  const monthLabel = monthCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = toYMD(new Date());

  const goPrev = () => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const goNext = () => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));

  const weeks: { date: Date; inMonth: boolean }[][] = [];
  for (let i = 0; i < 6; i++) weeks.push(days.slice(i * 7, i * 7 + 7));

  return (
    <View>
      <View style={styles.header}>
        <Pressable onPress={goPrev} style={styles.navButton} hitSlop={8}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable onPress={goNext} style={styles.navButton} hitSlop={8}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={i} style={styles.weekdayLabel}>
            {w}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map(({ date, inMonth }) => {
            const dateStr = toYMD(date);
            const events = markedEvents[dateStr] ?? [];
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            return (
              <Pressable
                key={dateStr}
                style={[
                  styles.dayBox,
                  !inMonth && styles.dayBoxOutside,
                  isToday && styles.dayBoxToday,
                  isSelected && styles.dayBoxSelected,
                ]}
                onPress={() => onDayPress(dateStr)}
              >
                <Text style={[styles.dayNumber, !inMonth && styles.dayNumberOutside]}>{date.getDate()}</Text>
                <View style={styles.chipRow}>
                  {events.slice(0, 3).map((e, i) => (
                    <View key={i} style={[styles.chip, { backgroundColor: e.color }]}>
                      <Text style={styles.chipText}>{e.label}</Text>
                    </View>
                  ))}
                  {events.length > 3 && <Text style={styles.moreText}>+{events.length - 3}</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navButton: { padding: 8 },
  navText: { fontSize: 20, color: '#4C9BE8', fontWeight: '600' },
  monthLabel: { fontSize: 15, fontWeight: '700', color: '#222' },
  weekdayRow: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 11, color: '#999', fontWeight: '600', marginBottom: 4 },
  weekRow: { flexDirection: 'row' },
  dayBox: {
    flex: 1,
    aspectRatio: 0.85,
    borderWidth: 1,
    borderColor: '#eee',
    padding: 3,
    margin: 1,
    borderRadius: 6,
  },
  dayBoxOutside: { backgroundColor: '#fafafa' },
  dayBoxToday: { borderColor: '#4C9BE8', borderWidth: 1.5 },
  dayBoxSelected: { backgroundColor: '#EAF3FD' },
  dayNumber: { fontSize: 11, color: '#333', fontWeight: '600' },
  dayNumberOutside: { color: '#ccc' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginTop: 2 },
  chip: { borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1, minWidth: 14, alignItems: 'center' },
  chipText: { fontSize: 8, color: '#fff', fontWeight: '700' },
  moreText: { fontSize: 8, color: '#999' },
});
