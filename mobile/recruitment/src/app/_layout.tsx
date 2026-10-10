import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { NotoSans_400Regular, NotoSans_500Medium, NotoSans_600SemiBold, NotoSans_700Bold } from '@expo-google-fonts/noto-sans';
import { SourceSerif4_600SemiBold, SourceSerif4_700Bold } from '@expo-google-fonts/source-serif-4';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CandidateSessionProvider } from '../lib/candidate-session';
import { FavoritesProvider } from '../lib/favorites';
import { ServerProvider } from '../lib/server';
import { PushProvider } from '../lib/push';
import { SessionProvider } from '../lib/session';
import { SummaryProvider } from '../lib/summary';
import { stackOptions } from '../components/tab-stack';
import { colors } from '../components/ui';

export default function Layout() {
  // Polices embarquées dans l'application (licence SIL OFL) : identiques sur iOS et Android.
  const [ready, failed] = useFonts({ NotoSans_400Regular, NotoSans_500Medium, NotoSans_600SemiBold, NotoSans_700Bold, SourceSerif4_600SemiBold, SourceSerif4_700Bold });
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
