import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.irongs.pointeur',
  appName: 'Pointeur ATLAS',
  webDir: 'www',
  server: {
    url: 'https://pointage.irongs.com',
    cleartext: false,
  },
};

export default config;
