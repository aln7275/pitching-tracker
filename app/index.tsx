import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

// Temporary hardcoded data — this will come from Supabase once we connect it in Phase 2
const athletes = [
  { id: '1', name: 'Jack' },
];

export default function AthleteListScreen() {
    const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Athletes</Text>
      <FlatList
        data={athletes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.athleteRow}
            onPress={() => router.push({ pathname: '/athlete', params: { name: item.name } })}
          >
            <Text style={styles.athleteName}>{item.name}</Text>
          </Pressable>
        )}
      />
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
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  athleteRow: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 10,
  },
  athleteName: {
    fontSize: 18,
  },
});
