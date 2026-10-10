import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CVField } from '../../../components/cv-field';
import { Icon } from '../../../components/icon';
import { SessionGate } from '../../../components/session-gate';
import { Card, colors, ErrorState, ErrorText, fonts, Loading, Row, Screen, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { CVUpload, useDocuments } from '../../../lib/documents';
import { Account, initials, profileCompleteness } from '../../../lib/emploi';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

export default function Profile() {
  return (
    <SessionGate title="Mon profil" next="profile" reason="Votre profil et vos documents sont enregistrés une fois, puis réutilisés à chaque candidature.">
      <Space />
    </SessionGate>
  );
}

const count = (value: unknown, one: string, many: string, none: string) => {
  const n = Array.isArray(value) ? value.length : 0;
  return n === 0 ? none : `${n} ${n > 1 ? many : one}`;
};

function Space() {
  const { call } = useCandidateSession();
  const { summary } = useSummary();
  const { saveCv } = useDocuments();
  const account = useLoad(signal => call<Account>('/public/emploi/me', { signal }), 'me');
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const { reload, setData } = account;
  // Le premier affichage charge déjà les données ; seuls les retours sur l'onglet les relisent.
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) first.current = false; else reload(); }, [reload]));

  async function changeCv(value: CVUpload | null) {
    setSaving(true); setError('');
    try { const cv = await saveCv(value); setData(previous => previous ? { ...previous, cv } : previous); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  }

  const data = account.data;
  if (!data) return <Screen><Text accessibilityRole="header" style={styles.title}>Mon profil</Text>{account.loading ? <Loading /> : <ErrorState message={account.error} onRetry={account.reload} />}</Screen>;
  const percent = profileCompleteness(data), profile = data.profile;
  const section = (name: string) => router.push({ pathname: '/profile/section', params: { section: name } });
  const job = typeof profile.desired_position === 'string' && profile.desired_position ? profile.desired_position : 'Métier non renseigné';
  return (
    <Screen onRefresh={account.refresh} refreshing={account.refreshing}>
      <Pressable accessibilityRole="button" accessibilityLabel="Paramètres" hitSlop={12} onPress={() => router.push('/profile/settings')} style={page.gear}><Icon name="settings" size={24} color={colors.navy} /></Pressable>
      <View style={page.identity}>
        <View accessibilityLabel={`${data.first_name} ${data.last_name}`} style={page.avatar}><Text style={page.avatarText}>{initials(`${data.first_name} ${data.last_name}`)}</Text></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={page.name}>{data.first_name} {data.last_name}</Text>
          <Text style={styles.subtitle}>{job}</Text>
        </View>
      </View>
      <Card style={{ gap: 10 }}>
        <View accessibilityRole="progressbar" accessibilityLabel={`Profil complété à ${percent} %`} accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ gap: 10 }}>
          <Text style={styles.label}>Profil complété à {percent} %</Text>
          <View style={page.progress}><View style={page.track}><View style={[page.bar, { width: `${percent}%` }]} /></View><Text style={page.percent}>{percent} %</Text></View>
        </View>
      </Card>
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        <Row icon="briefcase" title="Expériences" subtitle={count(profile.experience, 'expérience ajoutée', 'expériences ajoutées', 'Aucune expérience ajoutée')} onPress={() => section('experience')} />
        <View style={styles.divider} />
        <Row icon="star" title="Compétences" subtitle={count(profile.skills, 'compétence', 'compétences', 'Aucune compétence ajoutée')} onPress={() => section('skills')} />
        <View style={styles.divider} />
        <Row icon="graduation" title="Études et formations" subtitle={count(profile.education, 'formation ajoutée', 'formations ajoutées', 'Aucune formation ajoutée')} onPress={() => section('education')} />
        <View style={styles.divider} />
        <Row icon="globe" title="Langues" subtitle={Array.isArray(profile.languages) && profile.languages.length ? (profile.languages as string[]).join(', ') : 'Aucune langue renseignée'} onPress={() => section('languages')} />
        <View style={styles.divider} />
        <Row icon="calendar" title="Disponibilité" subtitle={typeof profile.availability === 'string' && profile.availability ? profile.availability : 'Non renseignée'} onPress={() => section('availability')} />
        <View style={styles.divider} />
        <Row icon="user" title="Modifier mon profil" subtitle="Informations personnelles" onPress={() => router.push('/profile/edit')} />
      </Card>
      <Card>
        <CVField value={undefined} existing={data.cv || undefined} onChange={changeCv} onError={setError} disabled={saving} />
        {saving && <Text style={styles.subtitle}>Enregistrement…</Text>}
        <ErrorText message={error} />
        <Text style={page.note}>Ce CV est proposé pour vos prochaines candidatures. Le remplacer ne modifie pas les candidatures déjà envoyées.</Text>
      </Card>
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        <Row icon="bookmark" title="Mes opportunités" subtitle="Offres enregistrées et alertes" onPress={() => router.push('/offers/opportunities')} />
        <View style={styles.divider} />
        <Row icon="calendar" title="Mes entretiens" subtitle={summary.upcoming_interviews ? `${summary.upcoming_interviews} à venir` : 'Aucun entretien à venir'} onPress={() => router.push('/applications/interviews')} />
        <View style={styles.divider} />
        <Row icon="bell" title="Notifications et conseils" subtitle={summary.unread_notifications ? `${summary.unread_notifications} non lue${summary.unread_notifications > 1 ? 's' : ''}` : 'Votre espace emploi'} onPress={() => router.push('/espace')} />
      </Card>
    </Screen>
  );
}

const page = StyleSheet.create({
  gear: { alignSelf: 'flex-end', minWidth: 44, minHeight: 36, alignItems: 'flex-end', justifyContent: 'center', marginBottom: -8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#4A6FA5', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: colors.white, fontSize: 30, fontFamily: fonts.semi },
  name: { fontSize: 23.5, lineHeight: 29, fontFamily: fonts.serif, color: colors.ink },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12 }, track: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  bar: { height: 7, borderRadius: 4, backgroundColor: colors.green }, percent: { fontSize: 14.5, fontFamily: fonts.medium, color: colors.ink, minWidth: 40, textAlign: 'right' },
  note: { fontSize: 13.5, lineHeight: 20, fontFamily: fonts.sans, color: colors.muted },
});
