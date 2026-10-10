import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { StateBadge, Stepper } from '../../../components/application-state';
import { Icon } from '../../../components/icon';
import { SessionGate } from '../../../components/session-gate';
import { Button, Card, colors, EmptyState, ErrorState, ErrorText, fonts, Loading, Monogram, Screen, Segmented, shadow, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { Application, ApplicationList, Interview, InterviewList, isClosed, logoUri, nextInterview, shortDateTime, sinceLabel } from '../../../lib/emploi';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

type Filter = 'active' | 'all';

export default function Applications() {
  return (
    <SessionGate title="Mes candidatures" next="applications" reason="Votre numéro de téléphone protège le suivi de vos candidatures.">
      <List />
    </SessionGate>
  );
}

function List() {
  const { call } = useCandidateSession();
  const { refresh: refreshSummary } = useSummary();
  const [filter, setFilter] = useState<Filter>('active'), [now] = useState(() => new Date());
  const applications = useLoad(signal => call<ApplicationList>('/public/emploi/applications', { signal }), 'applications');
  const interviews = useLoad(signal => call<InterviewList>('/public/emploi/interviews', { signal }), 'applications-interviews');
  const [confirming, setConfirming] = useState<number | null>(null), [error, setError] = useState('');
  const { reload } = applications, { reload: reloadInterviews } = interviews;
  // Le premier affichage charge déjà les données ; seuls les retours sur l'onglet les relisent.
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) first.current = false; else { reload(); reloadInterviews(); } }, [reload, reloadInterviews]));

  async function confirm(interview: Interview) {
    if (confirming !== null || interview.id === null) return;
    setConfirming(interview.id); setError('');
    try { await call(`/public/emploi/interviews/${interview.id}/confirm`, { method: 'POST' }); reloadInterviews(); refreshSummary(); }
    catch (e) { setError(errorMessage(e)); } finally { setConfirming(null); }
  }

  const all = applications.data?.items;
  const active = (all || []).filter(item => !isClosed(item));
  const shown = filter === 'active' ? active : all || [];
  return (
    <Screen onRefresh={() => { applications.refresh(); reloadInterviews(); }} refreshing={applications.refreshing}>
      <Text accessibilityRole="header" style={styles.title}>Mes candidatures</Text>
      {!all ? (applications.loading ? <Loading /> : <ErrorState message={applications.error} onRetry={applications.reload} />) : (
        <>
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'active', label: 'En cours' }, { value: 'all', label: 'Toutes' }]} />
          <Text style={list.count}>{filter === 'active' ? `${active.length} candidature${active.length > 1 ? 's' : ''} en cours` : `${all.length} candidature${all.length > 1 ? 's' : ''}`}</Text>
          <ErrorText message={error} />
          {!all.length ? <Card><EmptyState icon="file" title="Aucune candidature" text="Vos candidatures envoyées apparaîtront ici, chacune avec son état." action="Explorer les offres" onAction={() => router.navigate('/offers')} /></Card>
            : !shown.length ? <Card><EmptyState icon="file" title="Aucune candidature en cours" text="Vos candidatures terminées restent visibles dans « Toutes »." action="Voir toutes mes candidatures" onAction={() => setFilter('all')} /></Card>
            : shown.map(item => <Item key={item.id} item={item} interview={nextInterview(interviews.data?.items, item.id)} now={now} confirming={confirming} onConfirm={confirm} />)}
        </>
      )}
    </Screen>
  );
}

function Item({ item, interview, now, confirming, onConfirm }: { item: Application; interview: Interview | null; now: Date; confirming: number | null; onConfirm: (interview: Interview) => void }) {
  const open = () => router.push({ pathname: '/applications/[id]', params: { id: String(item.id) } });
  const title = item.offer?.title || item.position, updated = sinceLabel(item.state.updated_at || item.submitted_at, now);
  return (
    <View style={list.box}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Voir le suivi : ${title}, ${item.kind === 'offer' ? 'état' : 'état du dossier'} ${item.state.label}`} onPress={open} style={({ pressed }) => [list.main, pressed && { opacity: 0.8 }]}>
        <View style={list.top}>
          <Monogram name={item.offer?.company.name || 'IRON Emploi'} uri={logoUri(item.offer?.company)} size={46} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={list.title} numberOfLines={2}>{title}</Text>
            <Text style={list.meta} numberOfLines={2}>{item.offer ? [item.offer.company.name, item.offer.wilaya].filter(Boolean).join(' · ') : 'Candidature spontanée · sans annonce'}</Text>
          </View>
        </View>
        <StateBadge state={item.state} />
        {/* La progression ne vaut que pour une candidature à une annonce ; une candidature spontanée suit l'état du dossier. */}
        {item.kind === 'offer' ? <Stepper status={item.state.status} /> : <Text style={list.note}>État du dossier, commun à vos candidatures sans annonce.</Text>}
      </Pressable>
      {interview && (
        <View style={list.next}>
          <View style={list.nextTop}>
            <Icon name="calendar" size={22} color={colors.navy} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={list.nextLabel}>Votre prochaine étape</Text>
              <Text style={list.nextTitle}>{`Entretien · ${shortDateTime(interview.starts_at)}`}</Text>
              <View style={list.place}><Icon name="pin" size={14} color={colors.muted} /><Text style={list.meta}>{interview.location}</Text></View>
            </View>
          </View>
          {interview.status === 'proposed' && interview.id !== null
            ? <Button title="Confirmer ma présence" busy={confirming === interview.id} disabled={confirming !== null && confirming !== interview.id} onPress={() => onConfirm(interview)} />
            : <View style={list.confirmed}><Icon name="tick" size={16} color={colors.green} /><Text style={list.confirmedText}>Présence confirmée</Text></View>}
        </View>
      )}
      <Pressable accessibilityRole="link" accessibilityLabel={`Voir le suivi de ${title}`} onPress={open} style={list.foot}>
        <Text style={list.since} numberOfLines={1}>{updated ? `Mise à jour : ${updated.toLowerCase()}` : ''}</Text>
        <View style={list.see}><Text style={list.seeText}>Voir le suivi</Text><Icon name="arrowRight" size={16} color={colors.navy} /></View>
      </Pressable>
    </View>
  );
}

const list = StyleSheet.create({
  count: { fontSize: 14, fontFamily: fonts.sans, color: colors.muted, marginTop: -4 },
  box: { borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12, ...shadow },
  main: { gap: 12 }, top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, title: { fontSize: 16, lineHeight: 21, fontFamily: fonts.bold, color: colors.ink },
  meta: { fontSize: 13.5, lineHeight: 19, fontFamily: fonts.sans, color: colors.muted, flexShrink: 1 }, note: { fontSize: 13, fontFamily: fonts.sans, color: colors.muted },
  next: { gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.background }, nextTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  nextLabel: { fontSize: 12.5, fontFamily: fonts.sans, color: colors.muted }, nextTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.ink }, place: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  confirmed: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 }, confirmedText: { fontSize: 14, fontFamily: fonts.semi, color: colors.green },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44, marginVertical: -8 }, since: { flex: 1, fontSize: 12.5, fontFamily: fonts.sans, color: colors.muted },
  see: { flexDirection: 'row', alignItems: 'center', gap: 6 }, seeText: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.navy },
});
