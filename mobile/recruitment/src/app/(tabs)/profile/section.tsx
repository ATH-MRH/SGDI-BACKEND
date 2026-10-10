import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Icon } from '../../../components/icon';
import { Button, Card, Chip, colors, ErrorState, ErrorText, Field, Loading, Page, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { Account, Profile } from '../../../lib/emploi';
import schema from '../../../lib/form-schema.json';
import { useLoad } from '../../../lib/use-load';

type Rows = Record<string, string>[];
const LISTS = {
  experience: { title: 'Expériences', intro: 'Vos postes précédents, du plus récent au plus ancien.', add: 'Ajouter une expérience', max: 20,
    fields: [['position', 'Poste'], ['society', 'Employeur'], ['start_date', 'Du (AAAA-MM-JJ)'], ['end_date', 'Au (AAAA-MM-JJ)'], ['departure_reason', 'Motif du départ']] },
  education: { title: 'Études et formations', intro: 'Diplômes, formations et certificats.', add: 'Ajouter une formation', max: 20,
    fields: [['degree', 'Diplôme ou formation'], ['institution', 'Établissement'], ['specialty', 'Spécialité'], ['start_date', 'Du (AAAA-MM-JJ)'], ['end_date', 'Au (AAAA-MM-JJ)']] },
} as const;
const TAGS = {
  skills: { title: 'Compétences', intro: 'Ce que vous savez faire : habilitations, permis, logiciels, savoir-faire.', placeholder: 'Ex. Permis B, SSIAP 1…', max: 20, length: 60 },
  languages: { title: 'Langues', intro: 'Les langues que vous parlez.', placeholder: 'Ex. Arabe, Français…', max: 12, length: 60 },
} as const;
const isDate = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value);

export default function ProfileSection() {
  const section = useLocalSearchParams<{ section?: string }>().section || '';
  const { call, session, ready } = useCandidateSession();
  const account = useLoad(signal => call<Account>('/public/emploi/me', { signal }), 'me', !!session);
  if (!ready) return <Loading />;
  if (ready && !session) return <Redirect href={{ pathname: '/identify', params: { next: 'profile' } }} />;
  if (!account.data) return account.loading ? <Loading /> : <ErrorState message={account.error} onRetry={account.reload} />;
  const profile = account.data.profile;
  if (section in LISTS) return <ListEditor name={section as keyof typeof LISTS} profile={profile} />;
  if (section in TAGS) return <TagEditor name={section as keyof typeof TAGS} profile={profile} />;
  return <AvailabilityEditor profile={profile} />;
}

/** Enregistre le profil complet avec la rubrique modifiée : les autres rubriques sont renvoyées telles quelles. */
function useSave(profile: Profile) {
  const { call } = useCandidateSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const guard = useRef(false);
  async function save(change: Profile) {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try { await call('/public/emploi/me/profile', { method: 'PUT', body: { ...profile, ...change } }); router.back(); }
    catch (e) { setError(errorMessage(e)); } finally { guard.current = false; setBusy(false); }
  }
  return { save, busy, error, setError };
}

function ListEditor({ name, profile }: { name: keyof typeof LISTS; profile: Profile }) {
  const config = LISTS[name];
  const { save, busy, error, setError } = useSave(profile);
  const [rows, setRows] = useState<Rows>(() => (Array.isArray(profile[name]) ? profile[name] as Record<string, unknown>[] : []).map(row =>
    Object.fromEntries(config.fields.map(([key]) => [key, typeof row?.[key] === 'string' ? row[key] as string : '']))));
  const blank = () => Object.fromEntries(config.fields.map(([key]) => [key, '']));
  function submit() {
    const kept = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value.trim() || null]))).filter(row => Object.values(row).some(Boolean));
    if (rows.some(row => !isDate(row.start_date.trim()) || !isDate(row.end_date.trim()))) { setError('Renseignez les dates au format AAAA-MM-JJ.'); return; }
    save({ [name]: kept });
  }
  return (
    <Page title={config.title} subtitle={config.intro}>
      {rows.map((row, index) => (
        <Card key={index}>
          {config.fields.map(([key, label]) => <Field key={key} label={label} value={row[key]} maxLength={key.endsWith('_date') ? 10 : 150}
            onChangeText={value => setRows(rows.map((item, i) => i === index ? { ...item, [key]: value } : item))} />)}
          <Button title="Retirer" icon="trash" secondary onPress={() => setRows(rows.filter((_, i) => i !== index))} />
        </Card>
      ))}
      {rows.length === 0 && <Text style={styles.subtitle}>Aucun élément pour le moment.</Text>}
      <Button title={config.add} icon="plus" secondary disabled={rows.length >= config.max} onPress={() => setRows([...rows, blank()])} />
      <ErrorText message={error} />
      <Button title="Enregistrer" busy={busy} onPress={submit} />
    </Page>
  );
}

function TagEditor({ name, profile }: { name: keyof typeof TAGS; profile: Profile }) {
  const config = TAGS[name];
  const { save, busy, error } = useSave(profile);
  const [tags, setTags] = useState<string[]>(() => (Array.isArray(profile[name]) ? profile[name] as unknown[] : []).filter((tag): tag is string => typeof tag === 'string'));
  const [draft, setDraft] = useState('');
  function add() {
    const value = draft.trim();
    if (value && !tags.some(tag => tag.toLowerCase() === value.toLowerCase()) && tags.length < config.max) setTags([...tags, value]);
    setDraft('');
  }
  return (
    <Page title={config.title} subtitle={config.intro}>
      <Card>
        <Field label="Ajouter" value={draft} onChangeText={setDraft} placeholder={config.placeholder} maxLength={config.length} returnKeyType="done" onSubmitEditing={add} />
        <Button title="Ajouter à la liste" icon="plus" secondary disabled={!draft.trim() || tags.length >= config.max} onPress={add} />
        {tags.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {tags.map(tag => (
              <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Retirer ${tag}`} onPress={() => setTags(tags.filter(item => item !== tag))} hitSlop={4}>
                <View style={[styles.chip, { paddingRight: 9 }]}><Text style={styles.chipText}>{tag}</Text><Icon name="close" size={14} color={colors.muted} /></View>
              </Pressable>
            ))}
          </View>
        )}
        {tags.length === 0 && <Text style={styles.subtitle}>Aucun élément pour le moment.</Text>}
      </Card>
      <ErrorText message={error} />
      <Button title="Enregistrer" busy={busy} onPress={() => save({ [name]: tags })} />
    </Page>
  );
}

function AvailabilityEditor({ profile }: { profile: Profile }) {
  const { save, busy, error } = useSave(profile);
  // Mêmes choix que le formulaire de recrute.irongs.com.
  const options = (schema.flatMap(group => group.fields).find(field => field.key === 'availability')?.options || []).filter(option => option.value);
  const [value, setValue] = useState(typeof profile.availability === 'string' ? profile.availability : '');
  return (
    <Page title="Disponibilité" subtitle="À partir de quand pouvez-vous prendre un poste ?">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(option => <Chip key={option.value} label={option.label} selected={value === option.value} onPress={() => setValue(value === option.value ? '' : option.value)} />)}
      </View>
      <ErrorText message={error} />
      <Button title="Enregistrer" busy={busy} onPress={() => save({ availability: value || null })} />
    </Page>
  );
}
