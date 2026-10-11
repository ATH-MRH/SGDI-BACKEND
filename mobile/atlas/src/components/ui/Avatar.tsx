import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { AppText } from './AppText';

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

type Props = { name: string; size?: number; square?: boolean };

export function Avatar({ name, size = 48, square = false }: Props) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.avatar, { width: size, height: size, borderRadius: square ? Math.round(size * 0.22) : size / 2 }]}>
      <AppText color={colors.navy} style={{ fontSize: Math.max(12, Math.round(size * 0.36)), fontWeight: '700' }}>
        {initialsOf(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
