import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Button, Card, ErrorText, Row, styles } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useCandidateSession } from '../lib/candidate-session';
import { confirm } from '../lib/confirm';
import { formatDate } from '../lib/emploi';
import { useFavorites } from '../lib/favorites';
import { useServer } from '../lib/server';

export default function Settings() {
  const { mode } = useServer();
  const { session, signOut, forget, call } = useCandidateSession();
  const favorites = useFavorites();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const home = () => { router.dismissAll(); router.navigate('/'); };

  async function logout() { setBusy(true); try { await signOut(); home(); } finally { setBusy(false); } }
  async function deleteSpace() {
    setBusy(true); setError('');
    try { await call('/public/emploi/me', { method: 'DELETE' }); await forget(); home(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
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

      <Card style={{ gap: 4 }}>
        <Row icon="search" title="Suivre une candidature par référence" subtitle="Avec la référence reçue et votre nom" onPress={() => router.push('/tracking')} />
        <View style={styles.divider} />
        <Row icon="bulb" title="Conseils emploi" onPress={() => router.push('/tips')} />
      </Card>

      {session && (
        <Card>
          <Text accessibilityRole="header" style={styles.heading}>Mes données</Text>
          <Text style={styles.subtitle}>La suppression efface votre espace candidat, votre profil, votre CV et votre photo. Les candidatures déjà transmises restent étudiées par le service recrutement.</Text>
          <ErrorText message={error} />
          <Button title="Supprimer mon espace candidat" icon="trash" danger busy={busy}
            onPress={() => confirm('Supprimer votre espace ?', 'Votre profil et vos documents seront définitivement effacés de cet espace. Cette action est irréversible.', 'Supprimer', deleteSpace, true)} />
        </Card>
      )}

      <Text style={[styles.subtitle, { textAlign: 'center', fontSize: 12 }]}>IRON Emploi · version {Constants.expoConfig?.version || '—'}</Text>
    </ScrollView>
  );
}
