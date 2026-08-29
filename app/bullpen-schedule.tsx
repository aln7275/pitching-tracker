import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HomeButton } from '../components/HomeButton';
import { supabase } from '../supabase';

export default function BullpenScheduleScreen() {
  const { athleteId, athleteName, date: dateParam } = useLocalSearchParams<{
    athleteId: string;
    athleteName: string;
    date?: string;
  }>();
  const router = useRouter();

  const [date, setDate] = useState(dateParam ? new Date(dateParam + 'T00:00:00') : new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [targetPitches, setTargetPitches] = useState('');
  const [notes, setNotes] = useState('');
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
      session_type: 'bullpen',
      bullpen_subtype: 'TCN',
      session_date: date.toISOString().split('T')[0],
      target_pitches: targetPitches.trim() ? parseInt(targetPitches, 10) : null,
      notes: notes.trim() || null,
      status: 'scheduled',
    });

    setSaving(false);
    if (error) {
      Alert.alert('Error scheduling bullpen', error.message);
      return;
    }
    router.push('/home');
  };

  return (
    <View style={styles.container}>
      <HomeButton />
      <Text style={styles.title}>Schedule Bullpen</Text>
      <Text style={styles.athleteName}>{athleteName}</Text>

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

      <Text style={styles.label}>Target Pitches (optional)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder="e.g. 30"
        value={targetPitches}
        onChangeText={setTargetPitches}
      />

      <Text style={styles.label}>Coach Notes (optional)</Text>
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="e.g. focus on changeup command"
        multiline
      />

      <Pressable style={styles.button} onPress={handleSchedule} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Scheduling...' : 'Schedule Bullpen'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold' },
  athleteName: { fontSize: 18, color: '#4C9BE8', marginBottom: 30 },
  label: { fontSize: 13, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  dateButton: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, marginBottom: 20 },
  dateText: { fontSize: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 20 },
  notesInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 30,
  },
  button: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
