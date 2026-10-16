import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';
import { Button } from './Button';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Bouton principal en pied de feuille (« Appliquer »). */
  actionLabel?: string;
  onAction?: () => void;
  /** Lien secondaire à gauche du titre (« Réinitialiser »). */
  resetLabel?: string;
  onReset?: () => void;
  testID?: string;
};

/** Feuille basse : filtres et choix courts, sans quitter l'écran. Le fond assombri la ferme. */
export function BottomSheet({ visible, title, onClose, children, actionLabel, onAction, resetLabel, onReset, testID }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} testID={testID ? `${testID}-backdrop` : undefined} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} testID={testID} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <AppText variant="heading" color={colors.navy} accessibilityRole="header" style={styles.title} numberOfLines={1}>
              {title}
            </AppText>
            {resetLabel && onReset ? (
              <Pressable accessibilityRole="button" accessibilityLabel={resetLabel} hitSlop={10} onPress={onReset} testID={testID ? `${testID}-reset` : undefined}>
                <AppText variant="label" color={colors.primary}>
                  {resetLabel}
                </AppText>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={10} onPress={onClose} style={styles.close} testID={testID ? `${testID}-close` : undefined}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {actionLabel && onAction ? <Button testID={testID ? `${testID}-apply` : undefined} label={actionLabel} onPress={onAction} /> : null}
        </View>
      </View>
    </Modal>
  );
}

type ChoiceProps<T extends string | number> = {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
};

/** Groupe de choix exclusifs en pastilles, pour une feuille de filtres. */
export function ChoiceGroup<T extends string | number>({ label, options, value, onChange, testID }: ChoiceProps<T>) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <AppText variant="overline" color={colors.textSecondary}>
        {label}
      </AppText>
      <View style={styles.choices}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              testID={testID ? `${testID}-${option.value}` : undefined}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={[styles.choice, selected && styles.choiceOn]}>
              {selected ? <Ionicons name="checkmark" size={14} color={colors.onNavy} /> : null}
              <AppText variant="label" color={selected ? colors.onNavy : colors.text} numberOfLines={1} style={styles.choiceLabel}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginTop: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary },
  body: { gap: spacing.lg, paddingBottom: spacing.sm },
  group: { gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: touchTarget - 10,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  choiceLabel: { flexShrink: 1 },
});
