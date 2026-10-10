import * as Application from 'expo-application';
import Constants from 'expo-constants';

export type AppVersion = { version: string; build: string };

/**
 * Version marketing et numéro de build réellement installés
 * (CFBundleShortVersionString / CFBundleVersion, versionName / versionCode).
 */
export function getAppVersion(): AppVersion {
  return {
    version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0',
    build: Application.nativeBuildVersion ?? '0',
  };
}
