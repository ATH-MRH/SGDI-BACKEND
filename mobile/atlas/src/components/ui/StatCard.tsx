import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import { Card } from './Card';
import { ProgressBar } from './ProgressBar';
import { SectionHeader } from './SectionHeader';
import type { Tone } from '@/theme/tokens';

type CardProps = {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
  testID?: string;
};

/** Carte de statistiques ou de graphique : un titre de section, une action « Voir tout », un contenu. */
export function ChartCard({ title, hint, actionLabel, onAction, children, testID }: CardProps) {
  return (
    <Card testID={testID} style={styles.card}>
      <SectionHeader title={title} hint={hint} actionLabel={actionLabel} onAction={onAction} />
      {children}
    </Card>
  );
}

type LineProps = { label: string; value: string; ratio?: number | null; tone?: Tone | 'brand'; caption?: string; testID?: string };

/** Ligne de statistique : libellé, valeur, et sa barre de proportion quand elle a un sens. */
export function StatLine({ label, value, ratio, tone = 'brand', caption, testID }: LineProps) {
  return (
    <View testID={testID} style={styles.line} accessible accessibilityLabel={`${label} : ${value}`}>
      <View style={styles.lineHead}>
        <View style={styles.lineTexts}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {label}
          </AppText>
          {caption ? (
            <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
              {caption}
            </AppText>
          ) : null}
        </View>
        <AppText variant="label" color={colors.navy}>
          {value}
        </AppText>
      </View>
      {ratio !== undefined ? <ProgressBar ratio={ratio} tone={tone} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  line: { gap: spacing.sm },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lineTexts: { flex: 1 },
});
