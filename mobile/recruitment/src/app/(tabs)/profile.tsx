import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CVField } from '../../components/cv-field';
import { Icon } from '../../components/icon';
import { SessionGate } from '../../components/session-gate';
import { Card, colors, ErrorState, ErrorText, Loading, Monogram, Row, Screen, styles } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useCandidateSession } from '../../lib/candidate-session';
import { CVUpload, useDocuments } from '../../lib/documents';
import { Account, profileCompleteness } from '../../lib/emploi';
import { useLoad } from '../../lib/use-load';

export default function Profile() {
  return (
    <SessionGate title="Mon profil" next="profile" reason="Votre profil et vos documents sont enregistrés une fois, puis réutilisés à chaque candidature.">
      <Space />
    </SessionGate>
  );
}

function Space() {
  const { call } = useCandidateSession();
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
  const percent = data ? profileCompleteness(data) : 0;
  return (
    <Screen onRefresh={account.refresh} refreshing={account.refreshing}>
      <View style={page.top}>
        <Text accessibilityRole="header" style={styles.title}>Mon profil</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Paramètres" hitSlop={12} onPress={() => router.push('/settings')}><Icon name="settings" size={24} color={colors.navy} /></Pressable>
      </View>
      {!data && account.loading ? <Loading /> : !data ? <ErrorState message={account.error} onRetry={account.reload} /> : (
        <>
          <Card>
            <View style={page.identity}>
              <Monogram name={`${data.first_name} ${data.last_name}`} size={60} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={page.name}>{data.first_name} {data.last_name}</Text>
                <Text style={styles.subtitle}>{data.phone}</Text>
              </View>
            </View>
            <View accessibilityRole="progressbar" accessibilityLabel={`Profil complété à ${percent} %`} accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ gap: 8 }}>
              <View style={page.progressHead}><Text style={styles.label}>Profil complété à {percent} %</Text></View>
              <View style={page.track}><View style={[page.bar, { width: `${percent}%` }]} /></View>
            </View>
          </Card>
          <Card style={{ gap: 4 }}>
            <Row icon="user" title="Mes informations" subtitle="État civil, coordonnées, expériences" onPress={() => router.push('/profile-edit')} />
            <View style={styles.divider} />
            <Row icon="file" title="Mes candidatures" subtitle="Suivi de vos envois" onPress={() => router.navigate('/applications')} />
          </Card>
          <Card>
            <CVField value={undefined} existing={data.cv || undefined} onChange={changeCv} onError={setError} disabled={saving} />
            {saving && <Text style={styles.subtitle}>Enregistrement…</Text>}
            <ErrorText message={error} />
            <Text style={page.note}>Votre CV est joint automatiquement à vos prochaines candidatures.</Text>
          </Card>
          <Card style={{ gap: 4 }}>
            <Row icon="bulb" title="Conseils emploi" subtitle="CV, entretien, candidature" onPress={() => router.push('/tips')} />
            <View style={styles.divider} />
            <Row icon="settings" title="Paramètres" subtitle="Session, favoris, données" onPress={() => router.push('/settings')} />
          </Card>
        </>
      )}
    </Screen>
  );
}

const page = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontSize: 20, fontWeight: '700', color: colors.ink }, progressHead: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.blueSoft, overflow: 'hidden' }, bar: { height: 8, borderRadius: 4, backgroundColor: colors.green },
  note: { fontSize: 12, lineHeight: 18, color: colors.muted },
});
