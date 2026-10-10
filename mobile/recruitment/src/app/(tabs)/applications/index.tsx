import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { StateBadge, Stepper } from '../../../components/application-state';
import { Icon } from '../../../components/icon';
import { OfferMeta } from '../../../components/offer-card';
import { SessionGate } from '../../../components/session-gate';
import { Card, colors, EmptyState, ErrorState, fonts, JobIcon, Loading, Screen, Segmented, shadow, styles } from '../../../components/ui';
import { useCandidateSession } from '../../../lib/candidate-session';
import { ApplicationList, formatDate, isClosed, jobIcon } from '../../../lib/emploi';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

type Filter = 'all' | 'active' | 'closed';

export default function Applications() {
  return (
    <SessionGate title="Mes candidatures" next="applications" reason="Votre numéro de téléphone protège le suivi de vos candidatures.">
      <List />
    </SessionGate>
  );
}

function List() {
  const { call } = useCandidateSession();
  const { summary } = useSummary();
  const [filter, setFilter] = useState<Filter>('all');
  const applications = useLoad(signal => call<ApplicationList>('/public/emploi/applications', { signal }), 'applications');
  const { reload } = applications;
  // Le premier affichage charge déjà les données ; seuls les retours sur l'onglet les relisent.
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) first.current = false; else reload(); }, [reload]));
  const all = applications.data?.items;
  const active = (all || []).filter(item => !isClosed(item)), closed = (all || []).filter(isClosed);
  const shown = filter === 'active' ? active : filter === 'closed' ? closed : all || [];
  return (
    <Screen onRefresh={applications.refresh} refreshing={applications.refreshing}>
      <Text accessibilityRole="header" style={styles.title}>Mes candidatures</Text>
      {!all ? (applications.loading ? <Loading /> : <ErrorState message={applications.error} onRetry={applications.reload} />) : (
        <>
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: `Toutes (${all.length})` }, { value: 'active', label: `En cours (${active.length})` }, { value: 'closed', label: `Terminées (${closed.length})` }]} />
          {summary.upcoming_interviews > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Mes entretiens, ${summary.upcoming_interviews} à venir`} onPress={() => router.push('/applications/interviews')} style={row.interviews}>
              <Icon name="calendar" size={20} color={colors.gold} />
              <Text style={row.interviewsText}>{summary.upcoming_interviews} entretien{summary.upcoming_interviews > 1 ? 's' : ''} à venir</Text>
              <Icon name="chevronRight" size={18} color={colors.soft} />
            </Pressable>
          )}
          {!all.length ? <Card><EmptyState icon="file" title="Aucune candidature" text="Vos candidatures envoyées apparaîtront ici, chacune avec son état." action="Explorer les offres" onAction={() => router.navigate('/offers')} /></Card>
            : !shown.length ? <Card><EmptyState icon="file" title="Aucune candidature dans cette vue" text={filter === 'active' ? 'Aucune candidature en cours.' : 'Aucune candidature terminée.'} /></Card>
            : shown.map(item => (
              <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.offer?.title || item.position}, ${item.kind === 'offer' ? 'état' : 'état du dossier'} : ${item.state.label}`}
                onPress={() => router.push({ pathname: '/applications/[id]', params: { id: String(item.id) } })} style={({ pressed }) => [row.box, pressed && { opacity: 0.85 }]}>
                <View style={row.top}>
                  <JobIcon name={jobIcon({ title: item.offer?.title || item.position })} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={row.title} numberOfLines={2}>{item.offer?.title || item.position}</Text>
                    <Text style={row.meta} numberOfLines={1}>{item.offer ? item.offer.company.name : 'Candidature spontanée'}</Text>
                  </View>
                  <StateBadge state={item.state} />
                </View>
                <OfferMeta wilaya={item.offer?.wilaya} contract={item.offer?.contract_type} extra={item.submitted_at ? formatDate(item.submitted_at) : null} />
                {item.kind === 'offer' ? <Stepper status={item.state.status} /> : <Text style={row.dossier}>État du dossier, commun à vos candidatures sans annonce.</Text>}
              </Pressable>
            ))}
        </>
      )}
    </Screen>
  );
}

const row = StyleSheet.create({
  box: { gap: 10, padding: 14, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, ...shadow },
  top: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, title: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink, lineHeight: 22.5 },
  meta: { fontSize: 14.5, fontFamily: fonts.sans, color: colors.muted }, dossier: { fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted },
  interviews: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: 12, backgroundColor: colors.goldSoft, paddingHorizontal: 14 },
  interviewsText: { flex: 1, fontSize: 15.5, fontFamily: fonts.semi, color: colors.ink },
});
