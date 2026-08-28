import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HomeButton } from '../components/HomeButton';

export default function GameSetupScreen() {
  const { athleteId, athleteName } = useLocalSearchParams();
  const router = useRouter();
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [gameSubtype, setGameSubtype] = useState<'practice' | 'live'>('live');
  const [opponent, setOpponent] = useState('');

  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const handleBegin = () => {
    router.push({
      pathname: '/game-entry',
      params: {
        athleteId,
        athleteName,
        sessionDate: date.toISOString().split('T')[0],
        gameSubtype,
        opponent: opponent.trim(),
      },
    });
  };

  return (
    <View style={styles.container}>
      <HomeButton />
      <Text style={styles.title}>Game Tracking</Text>
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
      <Pressable style={styles.dateButton} onPress={() => setShowPicker(true)}>
        <Text style={styles.dateText}>{formattedDate}</Text>
      </Pressable>

      {showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedDate) => {
            setShowPicker(false);
            if (selectedDate) setDate(selectedDate);
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

      <Pressable style={styles.button} onPress={handleBegin}>
        <Text style={styles.buttonText}>Begin Game</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  athleteName: {
    fontSize: 18,
    color: '#4C9BE8',
    marginBottom: 30,
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 30 },
  togglePill: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  togglePillActive: { backgroundColor: '#4C9BE8', borderColor: '#4C9BE8' },
  toggleText: { fontSize: 13, color: '#444' },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  dateButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  dateText: {
    fontSize: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 30,
  },
  button: {
    backgroundColor: '#4C9BE8',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
