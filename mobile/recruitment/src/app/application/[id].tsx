import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { StateBadge } from '../../components/application-state';
import { Icon } from '../../components/icon';
import { Button, Card, colors, EmptyState, ErrorState, Loading, styles } from '../../components/ui';
import { useCandidateSession } from '../../lib/candidate-session';
import { Application, formatDate } from '../../lib/emploi';
import { useLoad } from '../../lib/use-load';

export default function ApplicationScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { call, session, ready } = useCandidateSession();
  const application = useLoad(signal => call<Application>(`/public/emploi/applications/${id}`, { signal }), `application:${id}`, !!session && Number.isFinite(id));
  if (ready && !session) return <Redirect href={{ pathname: '/identify', params: { next: 'applications' } }} />;
  if (application.loading && !application.data) return <Loading />;
  if (!application.data) {
    return application.status === 404
      ? <View style={{ padding: 18 }}><Card><EmptyState icon="file" title="Candidature introuvable" text="Elle n’est plus enregistrée auprès du service recrutement." /></Card></View>
      : <ErrorState message={application.error} onRetry={application.reload} />;
  }
  const data = application.data, convocation = data.state.convocation;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.eyebrow}>{data.kind === 'offer' ? 'CANDIDATURE À UNE OFFRE' : 'CANDIDATURE SPONTANÉE'}</Text>
        <Text accessibilityRole="header" style={styles.title}>{data.offer?.title || data.position}</Text>
        {!!data.offer && <Text style={styles.subtitle}>{[data.offer.company.name, data.offer.wilaya, data.offer.contract_type].filter(Boolean).join(' · ')}</Text>}
        <View style={styles.divider} />
        <Fact label="Référence" value={data.reference} selectable />
        <Fact label="Envoyée le" value={formatDate(data.submitted_at)} />
      </Card>
      <Card>
        <Text accessibilityRole="header" style={styles.heading}>État de votre dossier</Text>
        <StateBadge state={data.state} />
        <Text style={page.message}>{data.state.message}</Text>
        {!!convocation && (
          <View style={page.convocation}>
            <Icon name="calendar" size={20} color={colors.goldDeep} />
            <Text style={page.convocationText}>
              {[convocation.date ? formatDate(convocation.date) : '', convocation.heure ? `à ${convocation.heure}` : ''].filter(Boolean).join(' ')}
              {convocation.lieu ? `\n${convocation.lieu}` : ''}
            </Text>
          </View>
        )}
        {!!data.state.updated_at && <Text style={page.note}>Dernière mise à jour le {formatDate(data.state.updated_at)}.</Text>}
        <Text style={page.note}>L’état est celui enregistré par le service recrutement pour l’ensemble de votre dossier.</Text>
      </Card>
      {!!data.offer && (data.offer.open
        ? <Button title="Revoir l’annonce" secondary onPress={() => router.push({ pathname: '/offer/[id]', params: { id: String(data.offer!.id) } })} />
        : <Text style={page.closed}>Cette annonce est clôturée. Votre candidature reste enregistrée.</Text>)}
    </ScrollView>
  );
}

function Fact({ label, value, selectable = false }: { label: string; value: string; selectable?: boolean }) {
  return value ? <View style={page.fact}><Text style={page.factLabel}>{label}</Text><Text selectable={selectable} style={page.factValue}>{value}</Text></View> : null;
}

const page = StyleSheet.create({
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, factLabel: { fontSize: 14, color: colors.muted }, factValue: { fontSize: 14, fontWeight: '700', color: colors.ink, flexShrink: 1, textAlign: 'right' },
  message: { fontSize: 15, lineHeight: 22, color: colors.ink }, note: { fontSize: 12, lineHeight: 18, color: colors.muted },
  convocation: { flexDirection: 'row', gap: 10, backgroundColor: colors.goldSoft, borderRadius: 12, padding: 12, alignItems: 'flex-start' },
  convocationText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.ink }, closed: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});
