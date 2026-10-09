import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { StateBadge } from '../../components/application-state';
import { Icon } from '../../components/icon';
import { SessionGate } from '../../components/session-gate';
import { Card, colors, EmptyState, ErrorState, Loading, Monogram, Screen, styles } from '../../components/ui';
import { useCandidateSession } from '../../lib/candidate-session';
import { ApplicationList, formatDate, logoUri } from '../../lib/emploi';
import { useLoad } from '../../lib/use-load';

export default function Applications() {
  return (
    <SessionGate title="Mes candidatures" next="applications" reason="Votre numéro de téléphone protège le suivi de vos candidatures.">
      <List />
    </SessionGate>
  );
}

function List() {
  const { call } = useCandidateSession();
  const applications = useLoad(signal => call<ApplicationList>('/public/emploi/applications', { signal }), 'applications');
  const { reload } = applications;
  // Retour sur l'onglet (après un envoi, par exemple) : la liste est relue.
  // Le premier affichage charge déjà les données ; seuls les retours sur l'onglet les relisent.
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) first.current = false; else reload(); }, [reload]));
  const items = applications.data?.items, convocation = applications.data?.dossier?.state.convocation;
  return (
    <Screen onRefresh={applications.refresh} refreshing={applications.refreshing}>
      <Text accessibilityRole="header" style={styles.title}>Mes candidatures</Text>
      {!items && applications.loading ? <Loading />
        : !items ? <ErrorState message={applications.error} onRetry={applications.reload} />
        : !items.length ? <Card><EmptyState icon="file" title="Aucune candidature" text="Vos candidatures envoyées apparaîtront ici, avec leur état." action="Explorer les offres" onAction={() => router.push('/offers')} /></Card>
        : <>
          {!!convocation && (
            <View accessibilityRole="summary" style={row.convocation}>
              <Icon name="calendar" size={20} color={colors.goldDeep} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={row.convocationTitle}>Convocation du service recrutement</Text>
                <Text style={row.convocationText}>
                  {[convocation.date ? formatDate(convocation.date) : '', convocation.heure ? `à ${convocation.heure}` : ''].filter(Boolean).join(' ')}
                  {convocation.lieu ? `\n${convocation.lieu}` : ''}
                </Text>
              </View>
            </View>
          )}
          {items.map(item => (
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.position}, ${item.state.label}`}
            onPress={() => router.push({ pathname: '/application/[id]', params: { id: String(item.id) } })} style={({ pressed }) => [row.box, pressed && { opacity: 0.85 }]}>
            <View style={row.top}>
              <Monogram name={item.offer?.company.name || 'IRON'} uri={item.offer ? logoUri(item.offer.company) : null} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={row.title} numberOfLines={2}>{item.offer?.title || item.position}</Text>
                <Text style={row.meta} numberOfLines={1}>{item.offer ? item.offer.company.name : 'Candidature spontanée'}</Text>
              </View>
              <Icon name="chevronRight" size={18} color={colors.muted} />
            </View>
            <View style={row.bottom}>
              <StateBadge state={item.state} />
              {!!item.submitted_at && <Text style={row.date}>Envoyée le {formatDate(item.submitted_at)}</Text>}
            </View>
          </Pressable>
          ))}
        </>}
    </Screen>
  );
}

const row = StyleSheet.create({
  box: { gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  top: { flexDirection: 'row', gap: 12, alignItems: 'center' }, bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink, lineHeight: 21 }, meta: { fontSize: 13, color: colors.muted }, date: { fontSize: 12, color: colors.muted },
  convocation: { flexDirection: 'row', gap: 10, backgroundColor: colors.goldSoft, borderRadius: 14, padding: 14, alignItems: 'flex-start' },
  convocationTitle: { fontSize: 13, fontWeight: '700', color: colors.goldDeep }, convocationText: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.ink },
});
