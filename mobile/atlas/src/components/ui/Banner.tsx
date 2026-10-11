import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { radius, spacing, toneColors, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';
import type { IconName } from './IconTile';

type Props = { message: string; title?: string; tone?: Tone; icon?: IconName; testID?: string };

const ICONS: Record<Tone, IconName> = {
  neutral: 'information-circle-outline',
  info: 'information-circle-outline',
  success: 'checkmark-circle-outline',
  warning: 'alert-circle-outline',
  danger: 'warning-outline',
};

/** Panneau d'alerte ou d'information affiché dans le flux de l'écran. */
export function Banner({ message, title, tone = 'info', icon, testID }: Props) {
  const palette = toneColors[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      style={[styles.banner, { backgroundColor: palette.bg, borderLeftColor: palette.fg }]}>
      <Ionicons name={icon ?? ICONS[tone]} size={20} color={palette.fg} />
      <View style={styles.texts} testID={testID}>
        {title ? (
          <AppText variant="label" color={palette.fg}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="caption" color={palette.fg} style={styles.message}>
          {message}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    padding: spacing.md,
  },
  texts: { flex: 1, gap: 2 },
  message: { fontWeight: '500' },
});
