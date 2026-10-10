import { StyleSheet, View } from 'react-native';

import { env } from '@/config/env';
import { getAppVersion } from '@/config/version';
import { t } from '@/i18n';
import { colors } from '@/theme/tokens';

import { AppText, Badge } from './ui';

/** « ATLAS MOBILE · Version 1.0.0 · Build 14 », avec l'environnement hors production. */
export function VersionLabel() {
  const { version, build } = getAppVersion();
  return (
    <View style={styles.block} testID="version-label">
      <AppText variant="caption" color={colors.textMuted}>
        {t('app.name')}
      </AppText>
      <AppText variant="caption" color={colors.textMuted}>
        {t('app.version', { version })} · {t('app.build', { build })}
      </AppText>
      {env.variant !== 'production' ? (
        <Badge tone="warning" label={t(`app.environment.${env.variant}`)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: 'center', gap: 4 },
});
