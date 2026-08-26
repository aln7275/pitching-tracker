import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackArrowIcon, SendIcon } from '../components/Icons';
import { supabase } from '../supabase';

type Message = {
  id: number;
  athlete_id: number;
  sender_id: string;
  body: string;
  created_at: string;
};

type Participant = { name: string; role: string | null };

function roleColor(role: string | null): string {
  if (role === 'Coach') return '#4C9BE8';
  if (role === 'Athlete') return '#3FB98A';
  if (role === 'Parent') return '#E8A93B';
  return '#999';
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

export default function MessagesScreen() {
  const { athleteId, athleteName } = useLocalSearchParams<{ athleteId: string; athleteName: string }>();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Record<string, Participant>>({});
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  const fetchParticipants = useCallback(async () => {
    const { data: athlete } = await supabase
      .from('athletes')
      .select('user_id, owner_relationship_label')
      .eq('id', athleteId)
      .single();
    if (!athlete) return;

    const { data: grants } = await supabase
      .from('athlete_access')
      .select('granted_to_user_id, relationship_label')
      .eq('athlete_id', athleteId)
      .eq('status', 'active');

    const userIds = [
      athlete.user_id,
      ...(grants ?? []).map((g) => g.granted_to_user_id).filter((x): x is string => x !== null),
    ];
    const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', userIds);
    const nameMap = new Map<string, string>((profiles ?? []).map((p) => [p.id, p.name ?? 'Someone']));

    const map: Record<string, Participant> = {
      [athlete.user_id]: {
        name: nameMap.get(athlete.user_id) ?? 'Owner',
        role: athlete.owner_relationship_label,
      },
    };
    (grants ?? []).forEach((g) => {
      if (!g.granted_to_user_id) return;
      map[g.granted_to_user_id] = {
        name: nameMap.get(g.granted_to_user_id) ?? 'Someone',
        role: g.relationship_label,
      };
    });
    setParticipants(map);
  }, [athleteId]);

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: true });
    if (error) console.log('Error fetching messages:', error.message);
    else setMessages(data as Message[]);
  }, [athleteId]);

  useFocusEffect(
    useCallback(() => {
      fetchParticipants();
      fetchMessages();
    }, [fetchParticipants, fetchMessages])
  );

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        setCurrentUserId(user.id);
        await supabase
          .from('message_views')
          .upsert({ user_id: user.id, athlete_id: athleteId, last_viewed_at: new Date().toISOString() });
      })();
    }, [athleteId])
  );

  useFocusEffect(
    useCallback(() => {
      const channel = supabase
        .channel(`messages-${athleteId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `athlete_id=eq.${athleteId}` },
          (payload) => {
            const newMessage = payload.new as Message;
            setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]));
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [athleteId])
  );

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const sendMessage = async () => {
    const body = input.trim();
    if (!body || !currentUserId) return;
    setInput('');
    setSending(true);

    const tempId = -Date.now();
    setMessages((prev) => [
      ...prev,
      { id: tempId, athlete_id: Number(athleteId), sender_id: currentUserId, body, created_at: new Date().toISOString() },
    ]);

    const { data, error } = await supabase
      .from('messages')
      .insert({ athlete_id: athleteId, sender_id: currentUserId, body })
      .select()
      .single();

    setSending(false);
    if (error || !data) {
      Alert.alert('Error sending message', error?.message ?? 'Unknown error');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === tempId ? (data as Message) : m)));
  };

  const participantNames = Object.values(participants).map((p) => p.name).join(', ');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={10}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <BackArrowIcon color="#333" size={20} />
        </Pressable>
        <View>
          <Text style={styles.headerName}>{athleteName}</Text>
          {participantNames.length > 0 && <Text style={styles.headerParticipants}>{participantNames}</Text>}
        </View>
      </View>

      <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={styles.threadContent}>
        {messages.length === 0 ? (
          <Text style={styles.emptyText}>No messages yet — say hello.</Text>
        ) : (
          messages.map((m) => {
            const p = participants[m.sender_id];
            const name = p?.name ?? 'Someone';
            const role = p?.role ?? null;
            return (
              <View key={m.id} style={styles.messageRow}>
                <View style={[styles.avatar, { backgroundColor: roleColor(role) }]}>
                  <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.messageMeta}>
                    <Text style={styles.senderName}>{name}</Text>
                    {role && <Text style={styles.senderRole}>{role}</Text>}
                    <Text style={styles.timestamp}>{formatTimestamp(m.created_at)}</Text>
                  </View>
                  <Text style={styles.messageBody}>{m.body}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={[styles.inputRow, { paddingBottom: Math.max(16, insets.bottom + 10) }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message..."
          multiline
        />
        <Pressable style={styles.sendButton} onPress={sendMessage} disabled={sending || !input.trim()}>
          <SendIcon color="#fff" size={16} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: { padding: 2 },
  headerName: { fontSize: 18, fontWeight: 'bold', color: '#111' },
  headerParticipants: { fontSize: 11, color: '#999', marginTop: 1 },

  thread: { flex: 1 },
  threadContent: { padding: 20, gap: 16 },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', marginTop: 40 },

  messageRow: { flexDirection: 'row', gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  messageMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  senderName: { fontSize: 13, fontWeight: '600', color: '#222' },
  senderRole: { fontSize: 10, color: '#999' },
  timestamp: { fontSize: 10, color: '#bbb', marginLeft: 'auto' },
  messageBody: { fontSize: 14, color: '#333', marginTop: 2, lineHeight: 19 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4C9BE8',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
