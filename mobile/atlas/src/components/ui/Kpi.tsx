import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing, toneColors, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';

type Props = { label: string; value: string | number; tone?: Tone; testID?: string };

export function Kpi({ label, value, tone = 'neutral', testID }: Props) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${label} : ${value}`}
      style={styles.kpi}>
      <AppText variant="title" color={tone === 'neutral' ? colors.text : toneColors[tone].fg} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  kpi: {
    flex: 1,
    minWidth: 96,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
});
