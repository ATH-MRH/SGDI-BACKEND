import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { AppText } from './AppText';

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <AppText variant="bodyStrong" color={colors.onPrimary}>
        {initialsOf(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
});
