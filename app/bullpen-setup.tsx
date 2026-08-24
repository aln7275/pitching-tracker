import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

export default function BullpenSetupScreen() {
  const { athleteId, athleteName } = useLocalSearchParams();
  const router = useRouter();
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);

  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const handleBegin = () => {
    router.push({
      pathname: '/bullpen-entry',
      params: {
        athleteId,
        athleteName,
        sessionDate: date.toISOString().split('T')[0], // YYYY-MM-DD
      },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bullpen Session</Text>
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

      <Pressable style={styles.button} onPress={handleBegin}>
        <Text style={styles.buttonText}>Begin Session</Text>
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
  dateButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    marginBottom: 30,
  },
  dateText: {
    fontSize: 16,
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
