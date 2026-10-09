import { ReactNode } from 'react';
import { router } from 'expo-router';
import { Card, EmptyState, Loading, Screen, styles } from './ui';
import { Text } from 'react-native';
import { useCandidateSession } from '../lib/candidate-session';
import { useServer } from '../lib/server';

export type Next = 'apply' | 'applications' | 'profile';

/** Écran personnel : n'affiche son contenu qu'avec une session candidat ouverte par SMS. */
export function SessionGate({ title, reason, next, children }: { title: string; reason: string; next: Next; children: ReactNode }) {
  const { mode, retry } = useServer();
  const { ready, session, expired } = useCandidateSession();
  if (session && mode === 'emploi') return <>{children}</>;
  return (
    <Screen>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {!ready || mode === 'loading' ? <Loading />
        : mode === 'offline' ? <Card><EmptyState icon="alert" title="Connexion indisponible" text="Vérifiez votre réseau puis réessayez." action="Réessayer" onAction={retry} /></Card>
        : mode === 'legacy' ? (
          <Card><EmptyState icon="clock" title="Bientôt disponible" text="Cet espace ouvrira avec le service des annonces. Si vous avez déjà déposé une candidature, vous pouvez la suivre avec sa référence."
            action="Suivre une candidature par référence" onAction={() => router.push('/tracking')} /></Card>
        ) : (
          <Card><EmptyState icon="phone" title={expired ? 'Votre session a expiré' : 'Identifiez-vous par SMS'}
            text={expired ? 'Pour protéger vos informations, identifiez-vous à nouveau avec votre numéro de téléphone.' : reason}
            action="M’identifier" onAction={() => router.push({ pathname: '/identify', params: { next } })} /></Card>
        )}
    </Screen>
  );
}
