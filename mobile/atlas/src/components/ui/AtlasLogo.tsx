import { Image, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { colors, radius } from '@/theme/tokens';

import { AppText } from './AppText';

const ICON = require('@/assets/images/icon.png');

type Props = { size?: number; testID?: string };

/** Marque ATLAS Mobile : l'icône de l'application et le nom, comme sur l'écran d'accueil du web. */
export function AtlasLogo({ size = 30, testID }: Props) {
  return (
    <View style={styles.row} testID={testID} accessible accessibilityRole="image" accessibilityLabel={t('app.name')}>
      <Image source={ICON} style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} />
      <AppText style={[styles.word, { fontSize: Math.round(size * 0.62), lineHeight: Math.round(size * 0.8) }]} color={colors.navy}>
        ATLAS
        <AppText style={[styles.light, { fontSize: Math.round(size * 0.62) }]} color={colors.navy}>
          {' Mobile'}
        </AppText>
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.sm },
  word: { fontWeight: '800', letterSpacing: 0.2 },
  light: { fontWeight: '400', letterSpacing: 0 },
});
