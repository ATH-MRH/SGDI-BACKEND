import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, elevation, radius, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import { Chip } from './Chip';
import { EmployeePhoto } from './EmployeePhoto';

type Props = {
  employeeId: number | null;
  name: string;
  code?: string | null;
  position?: string | null;
  society?: string | null;
  site?: string | null;
  status?: ReactNode;
  actions?: ReactNode;
  testID?: string;
};

/** Bloc d'identité d'une fiche employé : grande photo, nom, matricule, fonction, statut, affectation. */
export function EmployeeHeader({ employeeId, name, code, position, society, site, status, actions, testID }: Props) {
  return (
    <View testID={testID} style={[styles.card, elevation.card]}>
      <View style={styles.top}>
        <EmployeePhoto employeeId={employeeId} name={name} size={96} square testID="employee-photo" />
        <View style={styles.texts}>
          <AppText variant="title" color={colors.navy} accessibilityRole="header" numberOfLines={2} testID="employee-name-heading">
            {name}
          </AppText>
          {code ? (
            <AppText variant="label" color={colors.textMuted} style={styles.code}>
              {code}
            </AppText>
          ) : null}
          {position ? (
            <AppText color={colors.textSecondary} numberOfLines={2}>
              {position}
            </AppText>
          ) : null}
          {status}
        </View>
      </View>
      {society || site ? (
        <View style={styles.chips}>
          {society ? <Chip icon="briefcase-outline" label={society} /> : null}
          {site ? <Chip icon="location-outline" label={site} /> : null}
        </View>
      ) : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  top: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  texts: { flex: 1, gap: spacing.xs },
  code: { fontVariant: ['tabular-nums'], letterSpacing: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
