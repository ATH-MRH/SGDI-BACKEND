import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { t } from '@/i18n';
import { colors, radius, spacing, touchTarget, typography } from '@/theme/tokens';

type Props = { value: string; onChangeText: (text: string) => void; placeholder: string; testID?: string };

export function SearchBar({ value, onChangeText, placeholder, testID }: Props) {
  return (
    <View style={styles.bar}>
      <Ionicons name="search" size={18} color={colors.textMuted} />
      <TextInput
        testID={testID}
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={styles.input}
      />
      {value ? (
        <Pressable
          testID={testID ? `${testID}-clear` : undefined}
          accessibilityRole="button"
          accessibilityLabel={t('common.clear')}
          hitSlop={12}
          onPress={() => onChangeText('')}>
          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
  input: { ...typography.body, flex: 1, color: colors.text, paddingVertical: spacing.sm },
});
