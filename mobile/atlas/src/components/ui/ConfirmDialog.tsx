import { Modal, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { colors, radius, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import { Button } from './Button';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

/** Confirmation explicite avant une action qui écrit dans ATLAS. */
export function ConfirmDialog({ visible, title, message, confirmLabel, destructive, busy, onConfirm, onCancel, testID }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.dialog} testID={testID} accessibilityViewIsModal accessibilityRole="alert">
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          {message ? <AppText color={colors.textSecondary}>{message}</AppText> : null}
          <Button
            testID={testID ? `${testID}-confirm` : undefined}
            label={confirmLabel}
            variant={destructive ? 'danger' : 'primary'}
            loading={busy}
            onPress={onConfirm}
          />
          <Button
            testID={testID ? `${testID}-cancel` : undefined}
            label={t('common.cancel')}
            variant="secondary"
            disabled={busy}
            onPress={onCancel}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xxl },
  dialog: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
});
