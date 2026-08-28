import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { HomeIcon } from './Icons';

// Floating top-right icon, dropped into any authenticated screen so there's
// always a quick way back to Home instead of repeated back-navigation.
// Absolutely positioned to match the app's standard paddingTop:60 header
// convention without needing to touch each screen's own header layout.
export function HomeButton({ onPress }: { onPress?: () => void }) {
  const router = useRouter();
  return (
    <Pressable style={styles.button} onPress={onPress ?? (() => router.push('/home'))} hitSlop={10}>
      <HomeIcon color="#4C9BE8" size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 4,
  },
});
