import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CandidateSessionProvider } from '../lib/candidate-session';
import { FavoritesProvider } from '../lib/favorites';
import { ServerProvider } from '../lib/server';
import { SessionProvider } from '../lib/session';
import { colors } from '../components/ui';

export default function Layout() {
  return (
    <SafeAreaProvider>
      <ServerProvider>
        <SessionProvider>
          <CandidateSessionProvider>
            <FavoritesProvider>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerTintColor: colors.navy, headerStyle: { backgroundColor: colors.white }, headerTitleStyle: { fontSize: 16 }, headerBackButtonDisplayMode: 'minimal', title: 'IRON Emploi', contentStyle: { backgroundColor: colors.background } }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="offer/[id]" options={{ title: 'Offre d’emploi' }} />
                <Stack.Screen name="company/[id]" options={{ title: 'Société' }} />
                <Stack.Screen name="identify" options={{ title: 'Identification' }} />
                <Stack.Screen name="verify" options={{ title: 'Identification' }} />
                <Stack.Screen name="apply" options={{ title: 'Ma candidature' }} />
                <Stack.Screen name="confirmation" options={{ title: 'Candidature envoyée', headerBackVisible: false, gestureEnabled: false }} />
                <Stack.Screen name="application/[id]" options={{ title: 'Suivi de candidature' }} />
                <Stack.Screen name="profile-edit" options={{ title: 'Mes informations' }} />
                <Stack.Screen name="tips/index" options={{ title: 'Conseils emploi' }} />
                <Stack.Screen name="tips/[id]" options={{ title: 'Conseil' }} />
                <Stack.Screen name="settings" options={{ title: 'Paramètres' }} />
                <Stack.Screen name="tracking" options={{ title: 'Suivi par référence' }} />
                <Stack.Screen name="login" options={{ title: 'Accès administration' }} />
                <Stack.Screen name="staff" options={{ title: 'Espace RH' }} />
              </Stack>
            </FavoritesProvider>
          </CandidateSessionProvider>
        </SessionProvider>
      </ServerProvider>
    </SafeAreaProvider>
  );
}
