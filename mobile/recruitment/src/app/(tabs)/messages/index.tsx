import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SessionGate } from '../../../components/session-gate';
import { Card, colors, EmptyState, ErrorState, fonts, Loading, Monogram, Screen, shadow, styles } from '../../../components/ui';
import { useCandidateSession } from '../../../lib/candidate-session';
import { Conversation, logoUri, messageTime } from '../../../lib/emploi';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

export default function Messages() {
  return (
    <SessionGate title="Messages" next="messages" reason="Échangez avec le service recrutement au sujet de vos candidatures.">
      <List />
    </SessionGate>
  );
}

function List() {
  const { call } = useCandidateSession();
  const { refresh } = useSummary();
  const conversations = useLoad(signal => call<{ items: Conversation[] }>('/public/emploi/conversations', { signal }), 'conversations');
  const { reload } = conversations, first = useRef(true);
  useFocusEffect(useCallback(() => { refresh(); if (first.current) first.current = false; else reload(); }, [reload, refresh]));
  const items = conversations.data?.items;
  const [today] = useState(() => new Date(Date.now() + 3600000).toISOString().slice(0, 10));
  return (
    <Screen onRefresh={conversations.refresh} refreshing={conversations.refreshing}>
      <Text accessibilityRole="header" style={styles.title}>Messages</Text>
      {!items ? (conversations.loading ? <Loading /> : <ErrorState message={conversations.error} onRetry={conversations.reload} />)
        : !items.length ? <Card><EmptyState icon="chat" title="Aucune conversation" text="Une conversation s’ouvre pour chacune de vos candidatures. Postulez à une offre pour échanger avec le recrutement." action="Explorer les offres" onAction={() => router.navigate('/offers')} /></Card>
        : items.map(item => {
          const last = item.last_message;
          return (
            <Pressable key={item.application_id} accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.unread ? `, ${item.unread} message${item.unread > 1 ? 's' : ''} non lu${item.unread > 1 ? 's' : ''}` : ''}`}
              onPress={() => router.push({ pathname: '/messages/[id]', params: { id: String(item.application_id) } })} style={({ pressed }) => [row.box, pressed && { opacity: 0.85 }]}>
              <Monogram name={item.company?.name || 'IRON Emploi'} uri={item.company ? logoUri(item.company) : null} size={46} round />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={row.head}>
                  <Text style={[row.title, item.unread > 0 && { fontFamily: fonts.bold }]} numberOfLines={1}>{item.title}</Text>
                  {!!last?.created_at && <Text style={row.time}>{messageTime(last.created_at, today)}</Text>}
                </View>
                <Text style={row.meta} numberOfLines={1}>{item.company ? item.company.name : 'Candidature spontanée'}</Text>
                <Text style={[row.preview, item.unread > 0 && { color: colors.ink, fontFamily: fonts.semi }]} numberOfLines={1}>
                  {last ? `${last.sender === 'candidate' ? 'Vous : ' : ''}${last.body}` : 'Aucun message pour le moment.'}
                </Text>
              </View>
              {item.unread > 0 && <View style={row.unread}><Text style={row.unreadText}>{item.unread}</Text></View>}
            </Pressable>
          );
        })}
    </Screen>
  );
}

const row = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, ...shadow },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, fontSize: 17, fontFamily: fonts.semi, color: colors.ink },
  time: { fontSize: 13, fontFamily: fonts.sans, color: colors.muted }, meta: { fontSize: 14, fontFamily: fonts.sans, color: colors.muted },
  preview: { fontSize: 15, fontFamily: fonts.sans, color: colors.muted },
  unread: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }, unreadText: { fontSize: 13, fontFamily: fonts.bold, color: colors.white },
});
