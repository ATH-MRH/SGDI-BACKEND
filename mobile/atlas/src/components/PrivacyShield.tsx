import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { isFeatureEnabled } from '@/config/env';
import { t } from '@/i18n';
import { colors, radius } from '@/theme/tokens';

import { AppText } from './ui';

/**
 * Masque le contenu dès que l'application quitte le premier plan, pour que
 * l'aperçu du sélecteur de tâches ne montre aucune donnée ATLAS.
 *
 * Efficace sur iOS (l'aperçu est pris à l'état « inactif »). Sur Android,
 * l'aperçu peut être capturé avant ce masquage : la fonction `secureScreen` pose
 * alors le drapeau natif FLAG_SECURE, qui masque l'aperçu ET bloque les captures
 * d'écran (sur iOS, elle masque le contenu dans les enregistrements d'écran).
 */
const CAPTURE_KEY = 'atlas-privacy';

export function PrivacyShield({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(AppState.currentState !== 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setHidden(next !== 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isFeatureEnabled('secureScreen')) return undefined;
    void ScreenCapture.preventScreenCaptureAsync(CAPTURE_KEY).catch(() => undefined);
    return () => void ScreenCapture.allowScreenCaptureAsync(CAPTURE_KEY).catch(() => undefined);
  }, []);

  return (
    <View style={styles.fill}>
      {children}
      {hidden ? (
        <View style={styles.shield} testID="privacy-shield" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.mark}>
            <AppText variant="title" color={colors.onPrimary}>
              A
            </AppText>
          </View>
          <AppText variant="heading" color={colors.onPrimary}>
            {t('app.name')}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shield: { ...StyleSheet.absoluteFill, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', gap: 16 },
  mark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
