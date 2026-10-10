import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Icon } from '../../../components/icon';
import { OfferMeta } from '../../../components/offer-card';
import { Button, Card, colors, EmptyState, ErrorState, ErrorText, fonts, JobIcon, Loading, shadow, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { alertLabel, JobAlert, jobIcon } from '../../../lib/emploi';
import { useFavorites } from '../../../lib/favorites';
import { useServer } from '../../../lib/server';
import { useLoad } from '../../../lib/use-load';

export default function Opportunities() {
  const { items, remove } = useFavorites();
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: '' }} />
      <Text accessibilityRole="header" style={styles.title}>Mes opportunités</Text>
      <Text accessibilityRole="header" style={styles.heading}>{`Offres enregistrées (${items.length})`}</Text>
      {!items.length ? <Card><EmptyState icon="bookmark" title="Aucune offre enregistrée" text="Touchez le signet d’une offre pour la retrouver ici. Vos favoris restent sur ce téléphone." action="Explorer les offres" onAction={() => router.navigate('/offers')} /></Card>
        : items.map(item => (
          // Deux zones tactiles côte à côte : ouvrir l'offre, retirer le favori.
          <View key={item.id} style={row.box}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.company}`} onPress={() => router.push({ pathname: '/offers/[id]', params: { id: String(item.id) } })}
              style={({ pressed }) => [row.main, pressed && { opacity: 0.7 }]}>
              <JobIcon name={jobIcon({ title: item.title })} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={row.title} numberOfLines={2}>{item.title}</Text>
                <Text style={row.meta} numberOfLines={1}>{item.company}</Text>
                <OfferMeta wilaya={item.wilaya} contract={item.contract_type} />
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${item.title} des favoris`} onPress={() => remove(item.id)} style={row.bookmark}>
              <Icon name="bookmark" size={21} color={colors.gold} filled />
            </Pressable>
          </View>
        ))}
      <Alerts />
    </ScrollView>
  );
}

function Alerts() {
  const { mode } = useServer();
  const { session, call } = useCandidateSession();
  const enabled = !!session && mode === 'emploi';
  const alerts = useLoad(signal => call<{ items: JobAlert[] }>('/public/emploi/alerts', { signal }), 'alerts', enabled);
  const [error, setError] = useState(''), [busy, setBusy] = useState<number | null>(null);
  const { reload, setData } = alerts, first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) first.current = false; else reload(); }, [reload]));

  async function toggle(alert: JobAlert, active: boolean) {
    setBusy(alert.id); setError('');
    // L'interrupteur n'est validé qu'une fois la réponse du serveur reçue.
    try {
      const saved = await call<JobAlert>(`/public/emploi/alerts/${alert.id}`, { method: 'PUT', body: { wilaya: alert.wilaya, profession: alert.profession, contract_type: alert.contract_type, company_id: alert.company_id, active } });
      setData(previous => previous ? { items: previous.items.map(item => item.id === saved.id ? saved : item) } : previous);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  const items = alerts.data?.items || [];
  return (
    <>
      <Text accessibilityRole="header" style={styles.heading}>{`Mes alertes${enabled && alerts.data ? ` (${items.length})` : ''}`}</Text>
      {mode !== 'emploi' ? <Card><EmptyState icon="bell" title="Alertes indisponibles" text="Les alertes ouvriront avec le service des annonces." /></Card>
        : !session ? <Card><EmptyState icon="bell" title="Recevez les nouvelles offres" text="Identifiez-vous pour enregistrer des critères : vous serez prévenu dans l’application quand une offre correspond." action="M’identifier" onAction={() => router.push({ pathname: '/identify', params: { next: 'opportunities' } })} /></Card>
        : alerts.loading && !alerts.data ? <Loading />
        : !alerts.data ? <ErrorState message={alerts.error} onRetry={alerts.reload} />
        : items.map(alert => (
          <View key={alert.id} style={row.box}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Modifier l’alerte ${alertLabel(alert)}`} onPress={() => router.push({ pathname: '/offers/alert-edit', params: { id: String(alert.id) } })}
              style={({ pressed }) => [row.main, pressed && { opacity: 0.7 }]}>
              <Icon name="bell" size={24} color={colors.gold} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={row.title}>{alertLabel(alert)}</Text>
                <Text style={row.meta}>{alert.active ? 'Vous êtes prévenu des nouvelles offres correspondantes.' : 'Alerte en pause.'}</Text>
              </View>
            </Pressable>
            <View style={{ paddingRight: 12, alignSelf: 'center' }}>
              <Switch accessibilityLabel={`Alerte ${alertLabel(alert)}`} value={alert.active} disabled={busy === alert.id} onValueChange={value => toggle(alert, value)}
                trackColor={{ true: colors.green, false: colors.border }} thumbColor={colors.white} />
            </View>
          </View>
        ))}
      <ErrorText message={error} />
      {enabled && !!alerts.data && <Button title="Créer une alerte" icon="plus" secondary onPress={() => router.push('/offers/alert-edit')} />}
      {enabled && <Text style={row.note}>Les alertes créent une notification dans l’application. Elles n’envoient ni SMS ni e-mail.</Text>}
    </>
  );
}

const row = StyleSheet.create({
  box: { flexDirection: 'row', borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'flex-start', ...shadow },
  main: { flex: 1, flexDirection: 'row', gap: 12, padding: 13, alignItems: 'center' }, bookmark: { minWidth: 46, minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  title: { fontSize: 17.5, fontFamily: fonts.bold, color: colors.ink, lineHeight: 22.5 }, meta: { fontSize: 14.5, lineHeight: 20, fontFamily: fonts.sans, color: colors.muted },
  note: { fontSize: 13.5, lineHeight: 19, fontFamily: fonts.sans, color: colors.muted, textAlign: 'center' },
});
