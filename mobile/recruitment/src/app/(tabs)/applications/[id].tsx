import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { StateBadge, Stepper } from '../../../components/application-state';
import { CvCard } from '../../../components/cv-card';
import { Icon } from '../../../components/icon';
import { Button, Card, colors, EmptyState, ErrorState, ErrorText, fonts, Loading, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { confirm } from '../../../lib/confirm';
import { Application, DocumentRequest, fileSize, formatDate, stateScope } from '../../../lib/emploi';
import { useLoad } from '../../../lib/use-load';

export default function ApplicationScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { call, session, ready } = useCandidateSession();
  const application = useLoad(signal => call<Application>(`/public/emploi/applications/${id}`, { signal }), `application:${id}`, !!session && Number.isFinite(id));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!ready) return <Loading />;
  if (ready && !session) return <Redirect href={{ pathname: '/identify', params: { next: 'applications' } }} />;
  if (!application.data) {
    return application.loading ? <Loading />
      : application.status === 404 ? <View style={{ padding: 18 }}><Card><EmptyState icon="file" title="Candidature introuvable" text="Elle n’est plus enregistrée auprès du service recrutement." /></Card></View>
      : <ErrorState message={application.error} onRetry={application.reload} />;
  }
  const data = application.data, convocation = data.state.convocation, scope = stateScope(data);

  async function withdraw() {
    setBusy(true); setError('');
    try { await call(`/public/emploi/applications/${id}/withdraw`, { method: 'POST' }); application.reload(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{data.kind === 'offer' ? 'CANDIDATURE À UNE OFFRE' : 'CANDIDATURE SPONTANÉE'}</Text>
      <Text accessibilityRole="header" style={[styles.title, { marginTop: -8 }]}>{data.offer?.title || data.position}</Text>
      {!!data.offer && <Text style={[styles.subtitle, { marginTop: -8 }]}>{[data.offer.company.name, data.offer.wilaya, data.offer.contract_type].filter(Boolean).join(' · ')}</Text>}
      <Card>
        <Fact label="Référence" value={data.reference} selectable />
        <Fact label="Envoyée le" value={formatDate(data.submitted_at)} />
      </Card>
      <Card>
        <Text accessibilityRole="header" style={styles.heading}>{scope.heading}</Text>
        <StateBadge state={data.state} />
        {data.kind === 'offer' && <Stepper status={data.state.status} />}
        <Text style={styles.text}>{data.state.message}</Text>
        {!!convocation && (
          <View style={page.convocation}>
            <Icon name="calendar" size={20} color={colors.gold} />
            <Text style={page.convocationText}>
              Convocation liée à votre dossier{'\n'}
              {[convocation.date ? formatDate(convocation.date) : '', convocation.heure ? `à ${convocation.heure}` : ''].filter(Boolean).join(' ')}
              {convocation.lieu ? `\n${convocation.lieu}` : ''}
            </Text>
          </View>
        )}
        {!!data.state.updated_at && <Text style={page.note}>Dernière mise à jour le {formatDate(data.state.updated_at)}.</Text>}
        <Text style={page.note}>{scope.note}</Text>
      </Card>
      {data.document_requests.some(request => request.status === 'requested') && (
        <Card>
          <Text accessibilityRole="header" style={styles.heading}>Pièces demandées</Text>
          {data.document_requests.filter(request => request.status === 'requested').map(request => <Requested key={request.id} request={request} onSent={application.reload} />)}
        </Card>
      )}
      {(data.documents.length > 0 || !!data.message) && (
        <Card>
          <Text accessibilityRole="header" style={styles.heading}>Ce que vous avez transmis</Text>
          {data.documents.map((document, index) => (
            <View key={index} style={page.document}>
              <Icon name="paper" size={20} color={colors.navy} />
              <View style={{ flex: 1 }}><Text style={page.documentName}>{document.label}</Text><Text style={page.note}>{document.name} · {fileSize(document.size)}{document.received_at ? ` · ${formatDate(document.received_at)}` : ''}</Text></View>
            </View>
          ))}
          {!!data.message && <Text style={page.quote}>{data.message}</Text>}
        </Card>
      )}
      {!!data.contract && (
        <Card>
          <Text accessibilityRole="header" style={styles.heading}>Votre contrat</Text>
          <Fact label="Poste" value={data.contract.position} /><Fact label="Type" value={data.contract.contract_type} />
          <Fact label="Début prévu" value={formatDate(data.contract.start_date)} /><Fact label="Avancement" value={data.contract.state_label} />
          <Fact label="Signé le" value={formatDate(data.contract.signed_on)} />
          <Text style={page.note}>Informations partagées par le service recrutement. La signature se fait auprès de lui.</Text>
        </Card>
      )}
      <Button title="Écrire au recrutement" icon="chat" secondary onPress={() => router.push({ pathname: '/messages/[id]', params: { id: String(id) } })} />
      {!!data.offer && data.offer.open && <Button title="Revoir l’annonce" secondary onPress={() => router.push({ pathname: '/offers/[id]', params: { id: String(data.offer!.id) } })} />}
      {!!data.offer && !data.offer.open && <Text style={[page.note, { textAlign: 'center' }]}>Cette annonce est clôturée. Votre candidature reste enregistrée.</Text>}
      <ErrorText message={error} />
      {data.can_withdraw && <Button title="Retirer ma candidature" danger busy={busy}
        onPress={() => confirm('Retirer cette candidature ?', 'Le service recrutement en sera informé et son traitement s’arrêtera. Vos autres candidatures ne changent pas.', 'Retirer', withdraw, true)} />}
    </ScrollView>
  );
}

function Requested({ request, onSent }: { request: DocumentRequest; onSent: () => void }) {
  const { call } = useCandidateSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return (
    <View style={{ gap: 8 }}>
      <Text style={page.documentName}>{request.label}</Text>
      {(!!request.note || !!request.due) && <Text style={page.note}>{[request.note, request.due ? `À transmettre avant le ${formatDate(request.due)}` : ''].filter(Boolean).join(' · ')}</Text>}
      <CvCard value={null} disabled={busy} onError={setError} onChange={async file => {
        if (!file) return;
        setBusy(true); setError('');
        try { await call(`/public/emploi/document-requests/${request.id}`, { method: 'PUT', body: { name: file.name, mime_type: file.mime_type, data_base64: file.data_base64 } }); onSent(); }
        catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
      }} />
      <ErrorText message={error} />
    </View>
  );
}

function Fact({ label, value, selectable = false }: { label: string; value: string; selectable?: boolean }) {
  return value ? <View style={page.fact}><Text style={page.factLabel}>{label}</Text><Text selectable={selectable} style={page.factValue}>{value}</Text></View> : null;
}

const page = StyleSheet.create({
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, factLabel: { fontSize: 15.5, fontFamily: fonts.sans, color: colors.muted },
  factValue: { fontSize: 15.5, fontFamily: fonts.bold, color: colors.ink, flexShrink: 1, textAlign: 'right' }, note: { fontSize: 13.5, lineHeight: 20, fontFamily: fonts.sans, color: colors.muted },
  convocation: { flexDirection: 'row', gap: 10, backgroundColor: colors.goldSoft, borderRadius: 12, padding: 12, alignItems: 'flex-start' },
  convocationText: { flex: 1, fontSize: 15.5, lineHeight: 23.5, fontFamily: fonts.medium, color: colors.ink },
  document: { flexDirection: 'row', gap: 10, alignItems: 'center' }, documentName: { fontSize: 16, fontFamily: fonts.semi, color: colors.ink },
  quote: { fontSize: 15.5, lineHeight: 23.5, fontFamily: fonts.sans, color: colors.ink, backgroundColor: colors.surface, borderRadius: 10, padding: 12 },
});
