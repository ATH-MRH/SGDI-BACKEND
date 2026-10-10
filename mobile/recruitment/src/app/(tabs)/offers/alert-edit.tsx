import { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { Button, Card, Chip, ErrorState, ErrorText, Loading, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { confirm } from '../../../lib/confirm';
import { Facets, fetchOffers, JobAlert } from '../../../lib/emploi';
import { useLoad } from '../../../lib/use-load';

type Draft = { wilaya?: string; profession?: string; contract_type?: string; company_id?: number };

export default function AlertEdit() {
  const id = useLocalSearchParams<{ id?: string }>().id;
  const { session, ready, call } = useCandidateSession();
  // Les critères proposés sont ceux des offres réellement publiées, plus ceux déjà enregistrés dans l'alerte.
  const facets = useLoad(signal => fetchOffers({}, 1, signal, 1).then(page => page.facets), 'alert-facets');
  const alerts = useLoad(signal => call<{ items: JobAlert[] }>('/public/emploi/alerts', { signal }), 'alerts-edit', !!session && !!id);
  if (!ready) return <Loading />;
  if (ready && !session) return <Redirect href={{ pathname: '/identify', params: { next: 'opportunities' } }} />;
  if ((facets.loading && !facets.data) || (id && alerts.loading && !alerts.data)) return <Loading />;
  if (!facets.data) return <ErrorState message={facets.error} onRetry={facets.reload} />;
  const existing = id ? alerts.data?.items.find(item => String(item.id) === id) : undefined;
  if (id && !existing) return <ErrorState message={alerts.error || 'Cette alerte n’existe plus.'} onRetry={alerts.error ? alerts.reload : undefined} />;
  return <Editor facets={facets.data} existing={existing} />;
}

function Editor({ facets, existing }: { facets: Facets; existing?: JobAlert }) {
  const { call } = useCandidateSession();
  const [draft, setDraft] = useState<Draft>({ wilaya: existing?.wilaya || undefined, profession: existing?.profession || undefined,
    contract_type: existing?.contract_type || undefined, company_id: existing?.company_id || undefined });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const guard = useRef(false);
  const pick = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [key]: previous[key] === value ? undefined : value }));
  const withSaved = (values: string[], saved?: string | null) => saved && !values.includes(saved) ? [saved, ...values] : values;
  const companies = existing?.company_id && existing.company && !facets.companies.some(c => c.id === existing.company_id)
    ? [{ id: existing.company_id, name: existing.company }, ...facets.companies] : facets.companies;
  const groups: { title: string; key: keyof Draft; options: { value: string | number; label: string }[] }[] = [
    { title: 'Wilaya', key: 'wilaya', options: withSaved(facets.wilayas, existing?.wilaya).map(v => ({ value: v, label: v })) },
    { title: 'Métier', key: 'profession', options: withSaved(facets.professions, existing?.profession).map(v => ({ value: v, label: v })) },
    { title: 'Type de contrat', key: 'contract_type', options: withSaved(facets.contract_types, existing?.contract_type).map(v => ({ value: v, label: v })) },
    { title: 'Entreprise', key: 'company_id', options: companies.map(c => ({ value: c.id, label: c.name })) },
  ];

  async function run(action: () => Promise<unknown>) {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try { await action(); router.back(); } catch (e) { setError(errorMessage(e)); } finally { guard.current = false; setBusy(false); }
  }
  const save = () => {
    if (!Object.values(draft).some(Boolean)) { setError('Choisissez au moins un critère.'); return; }
    const body = { wilaya: draft.wilaya || null, profession: draft.profession || null, contract_type: draft.contract_type || null, company_id: draft.company_id || null, active: existing ? existing.active : true };
    run(() => call(existing ? `/public/emploi/alerts/${existing.id}` : '/public/emploi/alerts', { method: existing ? 'PUT' : 'POST', body }));
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Modifier l’alerte' : 'Créer une alerte' }} />
      <Text style={styles.subtitle}>Vous recevez une notification dans l’application lorsqu’une nouvelle offre correspond à tous les critères choisis.</Text>
      {groups.map(group => (
        <View key={group.key} style={{ gap: 10 }}>
          <Text style={styles.label}>{group.title}</Text>
          {group.options.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {group.options.map(option => <Chip key={String(option.value)} label={option.label} selected={draft[group.key] === option.value} onPress={() => pick(group.key, option.value as never)} />)}
            </View>
          ) : <Text style={styles.subtitle}>Aucun choix parmi les offres publiées pour le moment.</Text>}
        </View>
      ))}
      <Card>
        <ErrorText message={error} />
        <Button title={existing ? 'Enregistrer l’alerte' : 'Créer l’alerte'} busy={busy} onPress={save} />
        {existing && <Button title="Supprimer cette alerte" icon="trash" danger disabled={busy}
          onPress={() => confirm('Supprimer cette alerte ?', 'Vous ne serez plus prévenu des offres correspondantes.', 'Supprimer', () => run(() => call(`/public/emploi/alerts/${existing.id}`, { method: 'DELETE' })), true)} />}
      </Card>
    </ScrollView>
  );
}
