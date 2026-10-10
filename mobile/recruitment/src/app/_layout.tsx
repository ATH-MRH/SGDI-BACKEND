import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Arimo_400Regular, Arimo_700Bold } from '@expo-google-fonts/arimo';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CandidateSessionProvider } from '../lib/candidate-session';
import { FavoritesProvider } from '../lib/favorites';
import { ServerProvider } from '../lib/server';
import { PushProvider } from '../lib/push';
import { SessionProvider } from '../lib/session';
import { SummaryProvider } from '../lib/summary';
import { stackOptions } from '../components/tab-stack';
import { colors } from '../components/ui';

// Aperçu web : les deux graisses d'Arial du poste, sous les noms utilisés par les styles.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('app-arial')) {
  const style = document.createElement('style');
  style.id = 'app-arial';
  style.textContent = '@font-face{font-family:"AppArial";src:local("Arial"),local("ArialMT")}@font-face{font-family:"AppArialBold";src:local("Arial Bold"),local("Arial-BoldMT")}';
  document.head.appendChild(style);
}

export default function Layout() {
  // Arial vient du système sur iOS. Sur Android, où elle n'existe pas, Arimo (licence libre, mêmes largeurs) est chargée.
  const [ready, failed] = useFonts(Platform.OS === 'android' ? { Arimo_400Regular, Arimo_700Bold } : {});
  if (!ready && !failed) return <View style={{ flex: 1, backgroundColor: colors.white }} />;
  return (
    <SafeAreaProvider>
      <ServerProvider>
        <SessionProvider>
          <CandidateSessionProvider>
            <FavoritesProvider>
              <SummaryProvider>
                <PushProvider>
                  <StatusBar style="dark" />
                  <Stack screenOptions={stackOptions}>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="login" options={{ title: 'Accès administration' }} />
                    <Stack.Screen name="staff" options={{ title: 'Espace RH' }} />
                  </Stack>
                </PushProvider>
              </SummaryProvider>
            </FavoritesProvider>
          </CandidateSessionProvider>
        </SessionProvider>
      </ServerProvider>
    </SafeAreaProvider>
  );
}
