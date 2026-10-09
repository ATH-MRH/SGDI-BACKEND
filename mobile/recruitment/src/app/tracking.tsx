import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Button, Card, ErrorText, Field, Page, styles } from '../components/ui';
import { CandidateStatus, errorMessage, request } from '../lib/api';
export default function Tracking() {
  const params = useLocalSearchParams<{reference?: string}>();
  const [reference, setReference] = useState(params.reference || ''), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<CandidateStatus | null>(null);
  async function submit() { setBusy(true); setError(''); setResult(null); try { setResult(await request<CandidateStatus>('/public/candidates/status', {body: {reference: reference.trim().toUpperCase(), last_name: name.trim()}})); } catch(e) {setError(errorMessage(e));} finally {setBusy(false);} }
  return <Page title="Ma candidature" subtitle="Saisissez la référence reçue lors du dépôt et votre nom de famille."><Card><Field label="Référence" placeholder="CAND-2026-000001" value={reference} onChangeText={v => {setReference(v); setResult(null);}} autoCapitalize="characters"/><Field label="Nom de famille" value={name} onChangeText={v => {setName(v); setResult(null);}}/><ErrorText message={error}/><Button title="Consulter le suivi" busy={busy} disabled={!reference.trim() || name.trim().length < 2} onPress={submit}/></Card>{result && <Card><Text style={styles.badge}>{result.label}</Text><Text style={styles.heading}>{result.position}</Text><Text style={styles.subtitle}>{result.message}</Text>{result.convocation && <Text style={styles.subtitle}>Convocation : {result.convocation.date} à {result.convocation.heure}{'\n'}{result.convocation.lieu}</Text>}</Card>}</Page>;
}
