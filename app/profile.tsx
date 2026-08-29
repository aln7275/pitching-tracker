import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { HomeButton } from '../components/HomeButton';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  const [currentEmail, setCurrentEmail] = useState('');
  const [profileName, setProfileName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentEmail(user.email ?? '');
      const { data } = await supabase.from('profiles').select('name').eq('id', user.id).single();
      if (data?.name) setProfileName(data.name);
    })();
  }, []);

  const saveName = async () => {
    setSavingName(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSavingName(false);
      return;
    }
    const { error } = await supabase.from('profiles').upsert({ id: user.id, name: profileName.trim() });
    setSavingName(false);
    if (error) Alert.alert('Error saving name', error.message);
  };

  const saveEmail = async () => {
    if (!newEmail.trim()) {
      Alert.alert('Missing email', 'Enter a new email address.');
      return;
    }
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setSavingEmail(false);
    if (error) {
      Alert.alert('Error updating email', error.message);
      return;
    }
    Alert.alert(
      'Confirm your new email',
      `A confirmation link was sent to ${newEmail.trim()}. Your email won't change until you click it.`
    );
    setNewEmail('');
  };

  const savePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Missing info', 'Enter your current password and a new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Passwords don't match", 'Re-enter your new password.');
      return;
    }
    setSavingPassword(true);

    // Supabase's updateUser doesn't itself verify the current password, so
    // re-authenticate with it first as an explicit check before changing anything.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });
    if (reauthError) {
      setSavingPassword(false);
      Alert.alert('Incorrect password', 'Your current password is wrong.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      Alert.alert('Error updating password', error.message);
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    Alert.alert('Password updated');
  };

  return (
    <View style={styles.container}>
      <HomeButton />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile & Settings</Text>

        <Text style={styles.sectionLabel}>Your Name</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={profileName}
            onChangeText={setProfileName}
            placeholder="Your name"
          />
          <Pressable style={styles.saveButton} onPress={saveName} disabled={savingName}>
            <Text style={styles.saveButtonText}>{savingName ? 'Saving...' : 'Save'}</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>This name is shown to every athlete you have access to.</Text>

        <Text style={styles.sectionLabel}>Email</Text>
        <Text style={styles.currentValue}>{currentEmail}</Text>
        <TextInput
          style={styles.input}
          value={newEmail}
          onChangeText={setNewEmail}
          placeholder="New email address"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Pressable style={styles.actionButton} onPress={saveEmail} disabled={savingEmail}>
          <Text style={styles.actionButtonText}>{savingEmail ? 'Sending...' : 'Update Email'}</Text>
        </Pressable>
        <Text style={styles.hint}>You'll need to confirm the change from a link sent to the new address.</Text>

        <Text style={styles.sectionLabel}>Password</Text>
        <TextInput
          style={styles.input}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Current password"
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="New password"
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm new password"
          secureTextEntry
        />
        <Pressable style={styles.actionButton} onPress={savePassword} disabled={savingPassword}>
          <Text style={styles.actionButtonText}>{savingPassword ? 'Updating...' : 'Update Password'}</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>Subscription</Text>
        <Text style={styles.hint}>Nothing to manage yet — this is where payment/subscription settings will live.</Text>

        <Pressable
          style={styles.logoutButton}
          onPress={async () => {
            await signOut();
            router.replace('/');
          }}
        >
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  sectionLabel: { fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 10 },
  currentValue: { fontSize: 15, color: '#333', marginBottom: 10 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 10 },
  hint: { fontSize: 12, color: '#999', marginTop: -4 },
  saveButton: { backgroundColor: '#4C9BE8', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14 },
  saveButtonText: { color: '#fff', fontWeight: '600' },
  actionButton: { backgroundColor: '#4C9BE8', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 6 },
  actionButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  logoutButton: { borderWidth: 1, borderColor: '#D6524F', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 40 },
  logoutButtonText: { color: '#D6524F', fontSize: 15, fontWeight: '600' },
});
