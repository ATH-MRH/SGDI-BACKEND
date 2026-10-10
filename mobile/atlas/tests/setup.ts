// Keychain / Keystore simulé en mémoire pour les tests.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    __store: store,
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'fr', languageTag: 'fr-FR' }],
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '14',
}));

// Biométrie simulée : disponible et configurée par défaut, réussite par défaut.
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

// Notifications simulées : appareil réel, autorisation non encore demandée.
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abcdefghijklmnopqrstuv]' })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => undefined),
  allowScreenCaptureAsync: jest.fn(async () => undefined),
}));
