import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HEADER_HEIGHT } from '../../../components/tab-stack';
import { Icon } from '../../../components/icon';
import { colors, EmptyState, ErrorState, fonts, Loading, Monogram, styles } from '../../../components/ui';
import { useCandidateSession } from '../../../lib/candidate-session';
import { ChatMessage, messageTime, newRequestId, Thread } from '../../../lib/emploi';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

// Message en cours d'envoi ou en échec : il garde son identifiant, donc un nouvel essai ne crée pas de doublon.
type Outgoing = { client_id: string; body: string; failed: boolean };

export default function ThreadScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { call, session, ready } = useCandidateSession();
  const { refresh } = useSummary();
  const insets = useSafeAreaInsets();
  const thread = useLoad(signal => call<Thread>(`/public/emploi/applications/${id}/messages`, { signal }), `thread:${id}`, !!session && Number.isFinite(id));
  const [draft, setDraft] = useState(''), [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const list = useRef<FlatList<ChatMessage | Outgoing>>(null);
  const [today] = useState(() => new Date(Date.now() + 3600000).toISOString().slice(0, 10));
  const { reload, setData } = thread;
  // Relecture régulière tant que la conversation est ouverte (pas de push dans cette version).
  useEffect(() => { const timer = setInterval(reload, 20000); return () => clearInterval(timer); }, [reload]);
  useEffect(() => { if (thread.data) refresh(); }, [thread.data, refresh]);

  if (!ready) return <Loading />;

  if (ready && !session) return <Redirect href={{ pathname: '/identify', params: { next: 'messages' } }} />;
  if (!thread.data) {
    return thread.loading ? <Loading /> : thread.status === 404
      ? <View style={{ padding: 18 }}><EmptyState icon="chat" title="Conversation introuvable" text="Cette candidature n’est plus enregistrée." /></View>
      : <ErrorState message={thread.error} onRetry={thread.reload} />;
  }
  const data = thread.data;

  async function deliver(message: Outgoing) {
    setOutgoing(previous => previous.map(item => item.client_id === message.client_id ? { ...item, failed: false } : item));
    try {
      const saved = await call<ChatMessage>(`/public/emploi/applications/${id}/messages`, { body: { body: message.body, client_id: message.client_id } });
      setOutgoing(previous => previous.filter(item => item.client_id !== message.client_id));
      setData(previous => previous && !previous.items.some(item => item.id === saved.id) ? { ...previous, items: [...previous.items, saved] } : previous);
    } catch { setOutgoing(previous => previous.map(item => item.client_id === message.client_id ? { ...item, failed: true } : item)); }
  }
  function send() {
    const body = draft.trim();
    if (!body) return;
    const message = { client_id: newRequestId(), body, failed: false };
    setDraft(''); setOutgoing(previous => [...previous, message]); deliver(message);
  }

  const rows: (ChatMessage | Outgoing)[] = [...data.items, ...outgoing];
  return (
    <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ headerTitle: () => (
        <View style={chat.header}>
          <Monogram name={data.company?.name || 'IRON Emploi'} size={34} round />
          <View style={{ flexShrink: 1 }}><Text style={chat.headerTitle} numberOfLines={1}>Équipe recrutement</Text><Text style={chat.headerSub} numberOfLines={1}>{data.title}</Text></View>
        </View>
      ) }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + HEADER_HEIGHT + 8 : 0}>
        <FlatList ref={list} data={rows} keyExtractor={item => 'id' in item ? `m${item.id}` : `o${item.client_id}`} contentContainerStyle={chat.list}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState icon="chat" title="Aucun message" text="Écrivez au service recrutement au sujet de cette candidature. La réponse arrive ici." />}
          renderItem={({ item }) => {
            const mine = !('id' in item) || item.sender === 'candidate', pending = !('id' in item);
            return (
              <View style={[chat.bubble, mine ? chat.mine : chat.theirs]}>
                <Text style={[chat.text, mine && { color: colors.white }]}>{item.body}</Text>
                {pending ? (item.failed
                  ? <Pressable accessibilityRole="button" accessibilityLabel="Message non envoyé. Réessayer" onPress={() => deliver(item)} hitSlop={8}><Text style={chat.retry}>Non envoyé · Réessayer</Text></Pressable>
                  : <Text style={[chat.time, { color: '#C9D3E3' }]}>Envoi…</Text>)
                  : <Text style={[chat.time, mine && { color: '#C9D3E3' }]}>{messageTime(item.created_at, today)}{mine ? (item.read ? ' · Lu' : ' · Envoyé') : ''}</Text>}
              </View>
            );
          }} />
        <View style={chat.compose}>
          <TextInput accessibilityLabel="Votre message" value={draft} onChangeText={setDraft} placeholder="Votre message…" placeholderTextColor={colors.soft} multiline maxLength={2000} style={chat.input} />
          <Pressable accessibilityRole="button" accessibilityLabel="Envoyer le message" accessibilityState={{ disabled: !draft.trim() }} disabled={!draft.trim()} onPress={send}
            style={({ pressed }) => [chat.send, !draft.trim() && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
            <Icon name="send" size={19} color={colors.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const chat = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 250 }, headerTitle: { fontSize: 17.5, fontFamily: fonts.bold, color: colors.ink }, headerSub: { fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted },
  list: { padding: 16, gap: 10, flexGrow: 1 }, bubble: { maxWidth: '82%', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 13, gap: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderTopLeftRadius: 4 }, mine: { alignSelf: 'flex-end', backgroundColor: colors.navy, borderTopRightRadius: 4 },
  text: { fontSize: 16, lineHeight: 23.5, fontFamily: fonts.sans, color: colors.ink }, time: { fontSize: 12, fontFamily: fonts.sans, color: colors.muted, alignSelf: 'flex-end' },
  retry: { fontSize: 13.5, fontFamily: fonts.semi, color: '#FFD9A0', alignSelf: 'flex-end', textDecorationLine: 'underline' },
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 17, fontFamily: fonts.sans, color: colors.ink },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
});
