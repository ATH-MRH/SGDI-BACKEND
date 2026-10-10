import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { Button, Card, colors, ErrorText, Loading, Row, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { confirm } from '../../../lib/confirm';
import { formatDate, PUSH_TEXT, PushSettings } from '../../../lib/emploi';
import { usePush } from '../../../lib/push';
import { useLoad } from '../../../lib/use-load';
import { useFavorites } from '../../../lib/favorites';
import { useServer } from '../../../lib/server';

export default function Settings() {
  const { mode } = useServer();
  const { session, signOut, forget, call } = useCandidateSession();
  const favorites = useFavorites(), push = usePush();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const home = () => { if (router.canDismiss()) router.dismissAll(); router.navigate('/'); };

  async function logout() { setBusy(true); try { await push.unregister(); await signOut(); home(); } finally { setBusy(false); } }
  async function deleteSpace() {
    setBusy(true); setError('');
    try { await call('/public/emploi/me', { method: 'DELETE' }); await forget(); home(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Paramètres' }} />
      <Card>
        <Text accessibilityRole="header" style={styles.heading}>Session</Text>
        {session ? (
          <>
            <Row icon="phone" title={`${session.identity.first_name} ${session.identity.last_name}`} subtitle={`${session.identity.phone} · session valable jusqu’au ${formatDate(new Date(session.expiresAt).toISOString())}`} />
            <Text style={styles.subtitle}>Votre session est conservée dans le stockage sécurisé de ce téléphone. Déconnectez-vous si vous le prêtez ou le changez.</Text>
            <Button title="Me déconnecter" icon="logout" secondary busy={busy} onPress={() => confirm('Se déconnecter ?', 'Vous devrez vous identifier à nouveau par SMS pour retrouver votre espace.', 'Me déconnecter', logout)} />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>Vous n’êtes pas identifié. Les offres restent consultables librement.</Text>
            {mode === 'emploi' && <Button title="M’identifier par SMS" icon="phone" onPress={() => router.push({ pathname: '/identify', params: { next: 'profile' } })} />}
          </>
        )}
      </Card>

      <Card>
        <Text accessibilityRole="header" style={styles.heading}>Favoris</Text>
        <Text style={styles.subtitle}>{favorites.items.length ? `${favorites.items.length} offre${favorites.items.length > 1 ? 's' : ''} enregistrée${favorites.items.length > 1 ? 's' : ''} sur ce téléphone.` : 'Aucune offre enregistrée sur ce téléphone.'}</Text>
        {favorites.items.length > 0 && <Button title="Effacer mes favoris" icon="trash" secondary onPress={() => confirm('Effacer les favoris ?', 'Les offres enregistrées sur ce téléphone seront retirées.', 'Effacer', favorites.clear, true)} />}
      </Card>

      {session && mode === 'emploi' && <Notifications />}

      <Card style={{ gap: 4 }}>
        <Row icon="search" title="Suivre une candidature par référence" subtitle="Avec la référence reçue et votre nom" onPress={() => router.push('/tracking')} />
        <View style={styles.divider} />
        <Row icon="bulb" title="Notifications et conseils" onPress={() => router.push('/espace')} />
      </Card>

      {session && (
        <Card>
          <Text accessibilityRole="header" style={styles.heading}>Mes données</Text>
          <Text style={styles.subtitle}>La suppression efface votre espace candidat : profil, CV, photo, alertes, notifications et accès à vos messages. Les candidatures déjà transmises, avec les pièces et les échanges qui les accompagnent, restent conservées par le service recrutement pour leur traitement.</Text>
          <ErrorText message={error} />
          <Button title="Supprimer mon espace candidat" icon="trash" danger busy={busy}
            onPress={() => confirm('Supprimer votre espace ?', 'Votre profil et vos documents seront définitivement effacés de cet espace. Cette action est irréversible.', 'Supprimer', deleteSpace, true)} />
        </Card>
      )}

      <Text style={[styles.subtitle, { textAlign: 'center', fontSize: 13.5 }]}>IRON Emploi · version {Constants.expoConfig?.version || '—'}</Text>
    </ScrollView>
  );
}

const FAMILIES: [keyof PushSettings['push'], string][] = [['applications', 'Avancement de mes candidatures'], ['messages', 'Messages du recrutement'], ['interviews', 'Entretiens'], ['offers', 'Offres correspondant à mes alertes']];

function Notifications() {
  const { call } = useCandidateSession(), push = usePush();
  const settings = useLoad(signal => call<PushSettings>('/public/emploi/me/settings', { signal }), 'settings');
  const [error, setError] = useState('');
  const { setData } = settings;
  async function toggle(key: keyof PushSettings['push'], value: boolean) {
    if (!settings.data) return;
    const push = { ...settings.data.push, [key]: value };
    setError('');
    try { const saved = await call<{ push: PushSettings['push'] }>('/public/emploi/me/settings', { method: 'PUT', body: { push } }); setData(previous => previous ? { ...previous, push: saved.push } : previous); }
    catch (e) { setError(errorMessage(e)); }
  }
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.heading}>Notifications</Text>
      {!settings.data ? (settings.loading ? <Loading /> : <ErrorText message={settings.error} />) : (
        <>
          <Text style={styles.subtitle}>Toutes vos notifications sont visibles dans l’application, rubrique « Votre espace emploi ».</Text>
          {FAMILIES.map(([key, label]) => (
            <View key={key} style={[styles.row, { justifyContent: 'space-between', minHeight: 44 }]}>
              <Text style={[styles.text, { flex: 1 }]}>{label}</Text>
              <Switch accessibilityLabel={`Notifications push : ${label}`} value={settings.data!.push[key]} onValueChange={value => toggle(key, value)} trackColor={{ true: colors.green, false: colors.border }} thumbColor={colors.white} />
            </View>
          ))}
          <Text style={[styles.subtitle, { fontSize: 14 }]}>{PUSH_TEXT[push.status]}{push.status === 'registered' && !settings.data.push_available ? ' L’envoi n’est pas encore ouvert côté serveur : vos préférences s’appliqueront à sa mise en service.' : ''}</Text>
          {push.status === 'idle' && <Button title="Activer les notifications sur ce téléphone" icon="bell" secondary busy={push.busy} onPress={push.enable} />}
        </>
      )}
      <ErrorText message={error} />
    </Card>
  );
}
