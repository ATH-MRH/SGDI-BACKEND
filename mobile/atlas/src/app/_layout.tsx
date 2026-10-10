import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '@/api/errors';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { BootstrapScreen } from '@/components/BootstrapScreen';
import { LockScreen } from '@/components/LockScreen';
import { ErrorState, Screen } from '@/components/ui';
import { PrivacyShield } from '@/components/PrivacyShield';
import { MaintenanceScreen, UpdateRequiredScreen } from '@/components/UpdateRequiredScreen';
import { env } from '@/config/env';
import { EmployeeProvider, useEmployee } from '@/employee/EmployeeProvider';
import { t } from '@/i18n';
import { LockProvider } from '@/lock/LockProvider';
import { OfflineProvider } from '@/offline/OfflineProvider';
import { PushProvider } from '@/push/PushProvider';
import { ScopeProvider } from '@/scope/ScopeProvider';
import { UpdateGate } from '@/update/UpdateGate';

void SplashScreen.preventAutoHideAsync();

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Inutile de réessayer un refus d'accès ou une erreur de saisie.
        retry: (failureCount, error) =>
          failureCount < 2 &&
          error instanceof ApiError &&
          (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server'),
      },
      mutations: { retry: false },
    },
  });
}

function RootNavigator() {
  const { state, retry, signOut } = useAuth();
  const employee = useEmployee();

  // Tant que la session n'est pas validée par le backend, aucun écran protégé n'est monté.
  if (state.status === 'loading' || employee.state.status === 'loading') return <BootstrapScreen />;
  if (state.status === 'unavailable') {
    return (
      <Screen scroll={false} edges={['top', 'bottom', 'left', 'right']} testID="session-unavailable">
        <ErrorState
          error={state.error}
          title={t('session.unavailable.title')}
          onRetry={() => void retry()}
          onSignIn={() => void signOut()}
        />
      </Screen>
    );
  }

  const signedIn = state.status === 'signedIn';
  // Session employé : un espace à part, sans aucun écran ni jeton staff.
  const employeeIn = !signedIn && employee.state.status === 'signedIn';
  return (
    <LockProvider lockScreen={<LockScreen />} loadingScreen={<BootstrapScreen />}>
      <ScopeProvider>
        <OfflineProvider>
        <PushProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="scope" options={{ presentation: 'modal' }} />
            <Stack.Screen name="module/[key]" />
            <Stack.Screen name="alerts/[id]" />
            <Stack.Screen name="ops/sites/index" />
            <Stack.Screen name="ops/sites/[id]" />
            <Stack.Screen name="attendance" />
            <Stack.Screen name="attendance-correct" />
            <Stack.Screen name="abandons/index" />
            <Stack.Screen name="abandons/new" />
            <Stack.Screen name="incidents/index" />
            <Stack.Screen name="incidents/new" />
            <Stack.Screen name="brq" />
            <Stack.Screen name="drh/employees/index" />
            <Stack.Screen name="drh/employees/[id]" />
            <Stack.Screen name="drh/leaves" />
            <Stack.Screen name="drh/leave-request" />
            <Stack.Screen name="recruitment" />
          </Stack.Protected>
          <Stack.Protected guard={employeeIn}>
            <Stack.Screen name="employee" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn && !employeeIn}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
        </PushProvider>
        </OfflineProvider>
      </ScopeProvider>
    </LockProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  if (!env.apiUrl) {
    return (
      <SafeAreaProvider>
        <Screen scroll={false} edges={['top', 'bottom', 'left', 'right']}>
          <ErrorState error={new ApiError({ kind: 'config' })} title={t('app.name')} />
        </Screen>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <PrivacyShield>
          <UpdateGate
            renderUpdate={(storeUrl) => <UpdateRequiredScreen serverStoreUrl={storeUrl} />}
            renderMaintenance={(message, retry) => <MaintenanceScreen message={message} onRetry={retry} />}>
            <AuthProvider>
              <EmployeeProvider>
                <RootNavigator />
              </EmployeeProvider>
            </AuthProvider>
          </UpdateGate>
        </PrivacyShield>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
