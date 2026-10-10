import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '../../../components/icon';
import { Button, Card, colors, EmptyState, ErrorState, fonts, Loading, shadow, styles } from '../../../components/ui';
import { request } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { AppNotification, formatDateTime, notificationLabel, notificationTarget, parseTipBody } from '../../../lib/emploi';
import { useServer } from '../../../lib/server';
import { useSummary } from '../../../lib/summary';
import { loadTips, Tip, TIPS } from '../../../lib/tips';
import { useLoad } from '../../../lib/use-load';

// Couleur et icône par famille de notification, comme sur la planche (entretien en vert, offre en bleu).
const KINDS: Record<AppNotification['kind'], { icon: IconName; tint: string; soft: string }> = {
  interview: { icon: 'calendar', tint: colors.green, soft: colors.greenSoft }, offer: { icon: 'briefcase', tint: colors.blue, soft: colors.blueSoft },
  message: { icon: 'chat', tint: colors.navy, soft: colors.surface }, application: { icon: 'file', tint: colors.gold, soft: colors.goldSoft },
};
const TIP_ICON: Record<string, IconName> = { cv: 'paper', entretien: 'users', candidature: 'send' };

export default function Espace() {
  const { mode } = useServer();
  const { session, call } = useCandidateSession();
  const { refresh } = useSummary();
  const enabled = !!session && mode === 'emploi';
  const notifications = useLoad(signal => call<{ items: AppNotification[]; unread: number }>('/public/emploi/notifications', { signal }), 'notifications', enabled);
  const [tips, setTips] = useState<Tip[]>(TIPS);
  useEffect(() => { let active = true; if (mode === 'emploi') loadTips(() => request('/public/emploi/tips'), parseTipBody).then(items => { if (active) setTips(items); }); return () => { active = false; }; }, [mode]);
  const { reload, setData } = notifications, first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) first.current = false; else reload(); }, [reload]));

  // Les cartes restent courtes : le texte complet se lit à l'ouverture, avec l'accès à l'écran concerné.
  const [opened, setOpened] = useState<AppNotification | null>(null), [all, setAll] = useState(false);
  function open(item: AppNotification) {
    setOpened(item);
    if (!item.read) {
      // Marquée lue sur le serveur ; l'affichage suit sans attendre, la navigation aussi.
      setData(previous => previous ? { unread: Math.max(0, previous.unread - 1), items: previous.items.map(row => row.id === item.id ? { ...row, read: true } : row) } : previous);
      call(`/public/emploi/notifications/${item.id}/read`, { method: 'POST' }).then(refresh).catch(() => {});
    }
  }
  function follow(item: AppNotification) { setOpened(null); router.push(notificationTarget(item) as never); }
  async function readAll() {
    try { await call('/public/emploi/notifications/read-all', { method: 'POST' }); setData(previous => previous ? { unread: 0, items: previous.items.map(row => ({ ...row, read: true })) } : previous); refresh(); } catch { /* relu au prochain affichage */ }
  }

  const items = notifications.data?.items || [], unread = notifications.data?.unread || 0, shown = all ? items : items.slice(0, PREVIEW);
  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: 8 }]}>
      <Stack.Screen options={{ title: 'Votre espace emploi', headerRight: () => (
        <View accessibilityLabel={unread ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}` : 'Aucune notification non lue'} style={{ padding: 6 }}><Icon name="bell" size={24} color={colors.navy} />{unread > 0 && <View style={page.dot} />}</View>
      ) }} />

      {!enabled ? (
        <Card><EmptyState icon="bell" title="Vos notifications" text={mode === 'emploi' ? 'Identifiez-vous pour suivre vos candidatures, vos messages et vos entretiens.' : 'Les notifications ouvriront avec le service des annonces.'}
          action={mode === 'emploi' ? 'M’identifier' : undefined} onAction={() => router.push({ pathname: '/identify', params: { next: 'espace' } })} /></Card>
      ) : notifications.loading && !notifications.data ? <Loading />
        : !notifications.data ? <ErrorState message={notifications.error} onRetry={notifications.reload} />
        : !items.length ? <Card><EmptyState icon="bell" title="Aucune notification" text="Vous serez prévenu ici de l’avancement de vos candidatures, des messages du recrutement, des entretiens et des offres correspondant à vos alertes." /></Card>
        : <>
          {unread > 0 && <Pressable accessibilityRole="button" onPress={readAll} hitSlop={8} style={{ alignSelf: 'flex-end', minHeight: 30, justifyContent: 'center', marginVertical: -6 }}><Text style={styles.link}>Tout marquer comme lu</Text></Pressable>}
          {shown.map(item => {
            const kind = KINDS[item.kind] || KINDS.application;
            return (
              <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.read ? '' : 'Non lue. '}${item.title}. ${item.body}`} accessibilityHint="Ouvre le détail" onPress={() => open(item)}
                style={({ pressed }) => [page.notification, { backgroundColor: kind.soft }, pressed && { opacity: 0.85 }]}>
                <View style={[page.kind, { backgroundColor: kind.tint }]}><Icon name={kind.icon} size={20} color={colors.white} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[page.notificationTitle, !item.read && { fontFamily: fonts.bold }]} numberOfLines={1}>{item.title}</Text>
                  <Text style={page.notificationBody} numberOfLines={2}>{item.body}</Text>
                </View>
                {!item.read && <View style={page.unread} />}
                <Icon name="chevronRight" size={18} color={colors.muted} />
              </Pressable>
            );
          })}
          {items.length > PREVIEW && (
            <Pressable accessibilityRole="button" onPress={() => setAll(!all)} hitSlop={8} style={{ alignSelf: 'center', minHeight: 36, justifyContent: 'center' }}>
              <Text style={styles.link}>{all ? 'Réduire' : `Voir les ${items.length} notifications`}</Text>
            </Pressable>
          )}
        </>}

      <Text accessibilityRole="header" style={styles.heading}>Nos conseils pour réussir</Text>
      <Text style={[styles.eyebrow, { marginTop: -10 }]}>CONTENU ÉDITORIAL</Text>
      {tips.map(tip => (
        <Pressable key={tip.id} accessibilityRole="button" accessibilityLabel={`Conseil : ${tip.title}. ${tip.summary}`} onPress={() => router.push({ pathname: '/tips/[id]', params: { id: tip.id } })}
          style={({ pressed }) => [page.tip, pressed && { opacity: 0.85 }]}>
          <View style={page.tipArt}><Icon name={TIP_ICON[tip.category || ''] || 'bulb'} size={34} color={colors.navy} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={page.tipTitle}>{tip.title}</Text>
            <Text style={page.tipText} numberOfLines={3}>{tip.summary}</Text>
          </View>
          <Icon name="chevronRight" size={18} color={colors.soft} />
        </Pressable>
      ))}
      <NotificationSheet item={opened} onClose={() => setOpened(null)} onFollow={follow} />
    </ScrollView>
  );
}

function NotificationSheet({ item, onClose, onFollow }: { item: AppNotification | null; onClose: () => void; onFollow: (item: AppNotification) => void }) {
  const insets = useSafeAreaInsets();
  const kind = item ? KINDS[item.kind] || KINDS.application : KINDS.application;
  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Fermer le détail" onPress={onClose} style={page.backdrop} />
      {item && (
        <View accessibilityViewIsModal style={[page.sheet, { paddingBottom: 18 + insets.bottom }]}>
          <View style={page.sheetTop}>
            <View style={[page.kind, { backgroundColor: kind.tint }]}><Icon name={kind.icon} size={20} color={colors.white} /></View>
            <Text accessibilityRole="header" style={[styles.heading, { flex: 1 }]}>{item.title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} hitSlop={10} style={page.close}><Icon name="close" size={20} color={colors.navy} /></Pressable>
          </View>
          <Text style={styles.text}>{item.body}</Text>
          <Text style={page.when}>{item.created_at ? formatDateTime(item.created_at) : ''}</Text>
          <Button title={notificationLabel(item)} onPress={() => onFollow(item)} />
        </View>
      )}
    </Modal>
  );
}

const PREVIEW = 3;

const page = StyleSheet.create({
  dot: { position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.gold },
  notification: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, minHeight: 64 },
  kind: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  notificationTitle: { fontSize: 16, fontFamily: fonts.semi, color: colors.ink }, notificationBody: { fontSize: 14, lineHeight: 19, fontFamily: fonts.sans, color: colors.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(12,28,54,0.45)' }, sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, gap: 14 },
  sheetTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  when: { fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, ...shadow },
  tipArt: { width: 72, height: 64, borderRadius: 10, backgroundColor: colors.blueSoft, alignItems: 'center', justifyContent: 'center' },
  tipTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink }, tipText: { fontSize: 14.5, lineHeight: 20, fontFamily: fonts.sans, color: colors.muted },
});
