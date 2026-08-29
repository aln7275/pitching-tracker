import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HomeButton } from '../components/HomeButton';
import { supabase } from '../supabase';

function formatTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function GameScheduleScreen() {
  const { athleteId, athleteName, date: dateParam } = useLocalSearchParams<{
    athleteId: string;
    athleteName: string;
    date?: string;
  }>();
  const router = useRouter();

  const [date, setDate] = useState(dateParam ? new Date(dateParam + 'T00:00:00') : new Date());
  const [time, setTime] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [gameSubtype, setGameSubtype] = useState<'practice' | 'live'>('live');
  const [opponent, setOpponent] = useState('');
  const [saving, setSaving] = useState(false);

  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const handleSchedule = async () => {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Not logged in', 'Please log in again.');
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('sessions').insert({
      athlete_id: athleteId,
      user_id: user.id,
      session_type: 'game',
      game_subtype: gameSubtype,
      opponent: opponent.trim() || null,
      session_date: date.toISOString().split('T')[0],
      session_time: time
        ? `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
        : null,
      status: 'scheduled',
    });

    setSaving(false);
    if (error) {
      Alert.alert('Error scheduling game', error.message);
      return;
    }
    router.push('/home');
  };

  return (
    <View style={styles.container}>
      <HomeButton />
      <Text style={styles.title}>Schedule Game</Text>
      <Text style={styles.athleteName}>{athleteName}</Text>

      <Text style={styles.label}>Session Type</Text>
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.togglePill, gameSubtype === 'practice' && styles.togglePillActive]}
          onPress={() => setGameSubtype('practice')}
        >
          <Text style={[styles.toggleText, gameSubtype === 'practice' && styles.toggleTextActive]}>
            Practice / Scrimmage
          </Text>
        </Pressable>
        <Pressable
          style={[styles.togglePill, gameSubtype === 'live' && styles.togglePillActive]}
          onPress={() => setGameSubtype('live')}
        >
          <Text style={[styles.toggleText, gameSubtype === 'live' && styles.toggleTextActive]}>Live Game</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Date</Text>
      <Pressable style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
        <Text style={styles.dateText}>{formattedDate}</Text>
      </Pressable>
      {showDatePicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedDate) => {
            setShowDatePicker(false);
            if (selectedDate) setDate(selectedDate);
          }}
        />
      )}

      <Text style={styles.label}>Time (optional)</Text>
      <Pressable style={styles.dateButton} onPress={() => setShowTimePicker(true)}>
        <Text style={[styles.dateText, !time && { color: '#999' }]}>{time ? formatTime(time) : 'Not set'}</Text>
      </Pressable>
      {showTimePicker && (
        <DateTimePicker
          value={time ?? new Date()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedTime) => {
            setShowTimePicker(false);
            if (selectedTime) setTime(selectedTime);
          }}
        />
      )}

      <Text style={styles.label}>Opponent / Game Name (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. vs. Riverside Rockets"
        value={opponent}
        onChangeText={setOpponent}
      />

      <Pressable style={styles.button} onPress={handleSchedule} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Scheduling...' : 'Schedule Game'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold' },
  athleteName: { fontSize: 18, color: '#4C9BE8', marginBottom: 30 },
  label: { fontSize: 13, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  togglePill: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  togglePillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  toggleText: { fontSize: 13, color: '#444' },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  dateButton: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, marginBottom: 20 },
  dateText: { fontSize: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 30 },
  button: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
