import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, elevation, radius, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import type { PortraitIssue } from '@/features/employees/usePortrait';

import { EmployeePhoto } from './EmployeePhoto';

type Props = {
  employeeId: number | null;
  name: string;
  code?: string | null;
  position?: string | null;
  society?: string | null;
  site?: string | null;
  hasPhoto?: boolean;
  onPhotoUnavailable?: (issue: PortraitIssue) => void;
  status?: ReactNode;
  /** Boutons d'action compacts, alignés sous l'identité. */
  actions?: ReactNode;
  testID?: string;
};

function Meta({ icon, text }: { icon: 'briefcase-outline' | 'location-outline'; text: string }) {
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={13} color={colors.steel} />
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.metaText}>
        {text}
      </AppText>
    </View>
  );
}

/**
 * Bloc d'identité compact d'une fiche employé : portrait 3:4, nom sur deux lignes au plus,
 * matricule, fonction, statut, puis société et site sur une ligne discrète.
 */
export function EmployeeHeader({ employeeId, name, code, position, society, site, hasPhoto, onPhotoUnavailable, status, actions, testID }: Props) {
  return (
    <View testID={testID} style={[styles.card, elevation.card]}>
      <View style={styles.top}>
        <EmployeePhoto employeeId={employeeId} name={name} size={66} portrait hasPhoto={hasPhoto} onUnavailable={onPhotoUnavailable} testID="employee-photo" />
        <View style={styles.texts}>
          <AppText variant="heading" color={colors.navy} accessibilityRole="header" numberOfLines={2} testID="employee-name-heading" style={styles.name}>
            {name}
          </AppText>
          <View style={styles.line}>
            {code ? (
              <AppText variant="caption" color={colors.textMuted} numberOfLines={1} style={styles.code}>
                {code}
              </AppText>
            ) : null}
            {status}
          </View>
          {position ? (
            <AppText variant="label" color={colors.textSecondary} numberOfLines={2}>
              {position}
            </AppText>
          ) : null}
          {society ? <Meta icon="briefcase-outline" text={society} /> : null}
          {site ? <Meta icon="location-outline" text={site} /> : null}
        </View>
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  top: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  texts: { flex: 1, gap: 3 },
  name: { fontSize: 17, lineHeight: 22 },
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  code: { fontVariant: ['tabular-nums'], letterSpacing: 0.3, fontWeight: '600', flexShrink: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { flex: 1 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
});
