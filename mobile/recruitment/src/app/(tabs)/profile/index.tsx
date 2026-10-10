import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CvCard } from '../../../components/cv-card';
import { Icon } from '../../../components/icon';
import { consentMissing, consentPayload, PrivacyConsent } from '../../../components/privacy-consent';
import { SessionGate } from '../../../components/session-gate';
import { Button, Card, colors, ErrorState, ErrorText, fonts, Loading, Row, Screen, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { CVUpload, useDocuments } from '../../../lib/documents';
import { Account, initials, PrivacyState, Profile as ProfileData, profileCompleteness, profileHint } from '../../../lib/emploi';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

export default function Profile() {
  return (
    <SessionGate title="Mon espace" next="profile" reason="Votre profil et vos documents sont enregistrés une fois, puis réutilisés à chaque candidature.">
      <Space />
    </SessionGate>
  );
}

const count = (value: unknown, one: string, many: string) => { const n = Array.isArray(value) ? value.length : 0; return n === 0 ? '' : `${n} ${n > 1 ? many : one}`; };
const text = (profile: ProfileData, key: string) => (typeof profile[key] === 'string' ? profile[key] as string : '');
const join = (parts: (string | false | null | undefined)[], empty: string) => parts.filter(Boolean).join(' · ') || empty;

function Space() {
  const { call } = useCandidateSession();
  const { summary } = useSummary();
  const { saveCv, loadPhoto } = useDocuments();
  const account = useLoad(signal => call<Account>('/public/emploi/me', { signal }), 'me');
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [photo, setPhoto] = useState('');
  const [consent, setConsent] = useState(false), [consenting, setConsenting] = useState(false);
  const { reload, setData } = account;
  // Le premier affichage charge déjà les données ; seuls les retours sur l'onglet les relisent.
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) first.current = false; else reload(); }, [reload]));
  const hasPhoto = !!account.data?.has_photo;
  useEffect(() => {
    if (!hasPhoto) return;
    const controller = new AbortController();
    loadPhoto(controller.signal).then(setPhoto).catch(() => {});
    return () => controller.abort();
  }, [hasPhoto, loadPhoto]);

  async function changeCv(value: CVUpload | null) {
    setSaving(true); setError('');
    try { const cv = await saveCv(value); setData(previous => previous ? { ...previous, cv } : previous); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  }
  // Consentement jamais donné : il s'enregistre ici avec le profil tel qu'il est, sans rien envoyer d'autre.
  async function saveConsent(data: Account) {
    setConsenting(true); setError('');
    try {
      const result = await call<{ privacy: PrivacyState }>('/public/emploi/me/profile', { method: 'PUT', body: { ...data.profile, ...consentPayload(data.privacy, consent) } });
      setData(previous => previous ? { ...previous, privacy: result.privacy } : previous);
    } catch (e) { setError(errorMessage(e)); } finally { setConsenting(false); }
  }

  const data = account.data;
  if (!data) return <Screen><Text accessibilityRole="header" style={styles.title}>Mon espace</Text>{account.loading ? <Loading /> : <ErrorState message={account.error} onRetry={account.reload} />}</Screen>;
  const percent = profileCompleteness(data), profile = data.profile, hint = profileHint(data);
  const section = (name: string) => router.push({ pathname: '/profile/section', params: { section: name } });
  const edit = (part: string) => router.push({ pathname: '/profile/edit', params: { part } });
  const place = [text(profile, 'commune'), text(profile, 'wilaya')].filter(Boolean).join(', ');
  const languages = [...(Array.isArray(profile.languages) ? profile.languages : []), ...(Array.isArray(profile.written_languages) ? profile.written_languages : [])];
  return (
    <Screen onRefresh={account.refresh} refreshing={account.refreshing}>
      <View style={page.top}>
        <Text accessibilityRole="header" style={[styles.title, { flex: 1 }]}>Mon espace</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Paramètres" onPress={() => router.push('/profile/settings')} style={page.gear}><Icon name="settings" size={24} color={colors.navy} /></Pressable>
      </View>
      <View style={page.identity}>
        {/* Photo réelle du candidat si elle existe, sinon un avatar neutre à ses initiales. */}
        {photo ? <Image accessibilityLabel={`Photo de ${data.first_name} ${data.last_name}`} source={{ uri: photo }} style={page.avatar} />
          : <View accessibilityLabel={`${data.first_name} ${data.last_name}`} style={[page.avatar, page.neutral]}><Text style={page.avatarText}>{initials(`${data.first_name} ${data.last_name}`)}</Text></View>}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={page.name}>{data.first_name} {data.last_name}</Text>
          <View style={page.place}><Icon name="pin" size={16} color={colors.muted} /><Text style={styles.subtitle}>{place || 'Localisation non renseignée'}</Text></View>
        </View>
      </View>
      <Card style={{ gap: 10 }}>
        <View accessibilityRole="progressbar" accessibilityLabel={`Votre profil est prêt à ${percent} %`} accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ gap: 10 }}>
          <Text style={page.ready}>Votre profil est prêt à {percent} %</Text>
          <View style={page.track}><View style={[page.bar, { width: `${percent}%` }]} /></View>
        </View>
        <Text style={styles.subtitle}>{hint || 'Votre profil contient l’essentiel pour postuler.'}</Text>
      </Card>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <Row icon="user" title="Identité et coordonnées" subtitle={join([text(profile, 'birth_date') && 'Naissance renseignée', place, text(profile, 'email')], 'À compléter')} onPress={() => edit('identity')} />
        <View style={styles.divider} />
        <Row icon="briefcase" title="Expérience professionnelle" subtitle={count(profile.experience, 'expérience', 'expériences') || 'Aucune expérience ajoutée'} onPress={() => section('experience')} />
        <View style={styles.divider} />
        <Row icon="graduation" title="Études et formations" subtitle={count(profile.education, 'formation', 'formations') || 'Aucune formation ajoutée'} onPress={() => section('education')} />
        <View style={styles.divider} />
        <Row icon="globe" title="Compétences et langues" subtitle={join([count(profile.skills, 'compétence', 'compétences'), count([...new Set(languages)], 'langue', 'langues')], 'À compléter')} onPress={() => section('skills')} />
        <View style={styles.divider} />
        <Row icon="calendar" title="Disponibilité et poste souhaité" subtitle={join([text(profile, 'desired_position'), text(profile, 'availability')], 'À compléter')} onPress={() => edit('job')} />
      </Card>
      <Card>
        <Text accessibilityRole="header" style={styles.heading}>CV et documents</Text>
        <CvCard value={undefined} existing={data.cv} onChange={changeCv} onError={setError} disabled={saving} />
        {saving && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>Enregistrement du CV…</Text>}
        <Text style={page.note}>Ce CV est proposé pour vos prochaines candidatures. Le remplacer ne modifie pas les pièces déjà transmises avec une candidature.</Text>
      </Card>
      <Card>
        <PrivacyConsent privacy={data.privacy} value={consent} onChange={setConsent} />
        {!data.privacy?.current && <Button title="Enregistrer mon profil" busy={consenting} disabled={consentMissing(data.privacy, consent)} onPress={() => saveConsent(data)} />}
      </Card>
      <ErrorText message={error} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
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
  top: { flexDirection: 'row', alignItems: 'center' }, gear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surface }, neutral: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontSize: 26, fontFamily: fonts.bold }, name: { fontSize: 20, lineHeight: 25, fontFamily: fonts.bold, color: colors.ink },
  place: { flexDirection: 'row', alignItems: 'center', gap: 6 }, ready: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.surface, overflow: 'hidden' }, bar: { height: 10, borderRadius: 5, backgroundColor: colors.gold },
  note: { fontSize: 13, lineHeight: 19, fontFamily: fonts.sans, color: colors.muted },
});
