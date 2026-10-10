import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, elevation, radius, spacing, toneColors, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';
import { EmployeePhoto } from './EmployeePhoto';
import { IconTile, type IconName } from './IconTile';
import { ProgressBar } from './ProgressBar';

type RowShellProps = { onPress?: () => void; accessibilityLabel: string; testID?: string; children: ReactNode };

function RowShell({ onPress, accessibilityLabel, testID, children }: RowShellProps) {
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, elevation.card]}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, elevation.card, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

type EmployeeRowProps = {
  employeeId: number | null;
  name: string;
  /** Matricule. */
  code?: string | null;
  position?: string | null;
  /** Ligne d'information : site, horaires, heure d'arrivée. */
  detail?: string | null;
  badge?: ReactNode;
  /** false : la fiche n'a pas de photo, rien n'est demandé au serveur. */
  hasPhoto?: boolean;
  onPress?: () => void;
  testID?: string;
};

/** Ligne d'employé : photo, nom, matricule, fonction, et un statut à droite. */
export function EmployeeRow({ employeeId, name, code, position, detail, badge, hasPhoto, onPress, testID }: EmployeeRowProps) {
  return (
    <RowShell testID={testID} onPress={onPress} accessibilityLabel={[name, code, position, detail].filter(Boolean).join(', ')}>
      <EmployeePhoto employeeId={employeeId} name={name} size={46} hasPhoto={hasPhoto} />
      <View style={styles.texts}>
        <AppText variant="bodyStrong" color={colors.navy} numberOfLines={1}>
          {name}
        </AppText>
        {code ? (
          <AppText variant="caption" color={colors.textMuted} numberOfLines={1} style={styles.code}>
            {code}
          </AppText>
        ) : null}
        {position || detail ? (
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
            {[position, detail].filter(Boolean).join(' · ')}
          </AppText>
        ) : null}
      </View>
      <View style={styles.side}>
        {badge}
        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
      </View>
    </RowShell>
  );
}

type SiteRowProps = {
  name: string;
  /** Client, commune, wilaya. */
  detail?: string | null;
  society?: string | null;
  /** Effectif prévu au contrat ; null si inconnu. */
  staff?: number | null;
  staffLabel?: string;
  /** Taux 0–1 quand le backend le fournit ; sinon la barre n'est pas affichée. */
  ratio?: number | null;
  badge?: ReactNode;
  onPress?: () => void;
  testID?: string;
};

/** Ligne de site : nom, localisation, effectif, et taux quand il est connu. */
export function SiteRow({ name, detail, society, staff, staffLabel, ratio, badge, onPress, testID }: SiteRowProps) {
  return (
    <RowShell testID={testID} onPress={onPress} accessibilityLabel={[name, detail, society].filter(Boolean).join(', ')}>
      <IconTile icon="business-outline" size={46} />
      <View style={styles.texts}>
        <AppText variant="bodyStrong" color={colors.navy} numberOfLines={1}>
          {name}
        </AppText>
        {detail ? (
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
            {detail}
          </AppText>
        ) : null}
        <View style={styles.meta}>
          {typeof staff === 'number' && staffLabel ? (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={13} color={colors.steel} />
              <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
                {staffLabel}
              </AppText>
            </View>
          ) : null}
          {society ? (
            <AppText variant="caption" color={colors.textMuted} numberOfLines={1} style={styles.metaShrink}>
              {society}
            </AppText>
          ) : null}
        </View>
        {typeof ratio === 'number' ? <ProgressBar ratio={ratio} tone={ratio >= 0.9 ? 'success' : ratio >= 0.75 ? 'warning' : 'danger'} height={4} /> : null}
      </View>
      <View style={styles.side}>
        {badge}
        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
      </View>
    </RowShell>
  );
}

type IncidentRowProps = {
  title: string;
  /** Site, date et heure. */
  detail?: string | null;
  tone: Tone;
  icon?: IconName;
  badge?: ReactNode;
  footer?: ReactNode;
  onPress?: () => void;
  testID?: string;
};

/** Ligne d'incident ou d'alerte : la gravité est donnée par l'icône, la couleur et le badge écrit. */
export function IncidentRow({ title, detail, tone, icon = 'warning-outline', badge, footer, onPress, testID }: IncidentRowProps) {
  return (
    <RowShell testID={testID} onPress={onPress} accessibilityLabel={[title, detail].filter(Boolean).join(', ')}>
      <View style={[styles.severity, { backgroundColor: toneColors[tone].fg }]} />
      <IconTile icon={icon} tone={tone} size={40} />
      <View style={styles.texts}>
        <AppText variant="bodyStrong" color={colors.navy} numberOfLines={2}>
          {title}
        </AppText>
        {detail ? (
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={2}>
            {detail}
          </AppText>
        ) : null}
        {footer}
      </View>
      <View style={styles.side}>
        {badge}
        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
      </View>
    </RowShell>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 68,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: colors.surfacePressed },
  texts: { flex: 1, gap: 2 },
  code: { fontVariant: ['tabular-nums'], letterSpacing: 0.3 },
  side: { alignItems: 'flex-end', gap: spacing.xs, maxWidth: '42%' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaShrink: { flexShrink: 1 },
  severity: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
});
