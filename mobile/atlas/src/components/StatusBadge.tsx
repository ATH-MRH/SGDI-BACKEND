import { t, type TranslationKey } from '@/i18n';
import type { Tone } from '@/theme/tokens';

import { Badge } from './ui';

type Props = { status: { label: TranslationKey; tone: Tone } | null; fallback: string; testID?: string };

/** Statut traduit et coloré ; une valeur inconnue du mobile est affichée telle quelle, sans couleur. */
export function StatusBadge({ status, fallback, testID }: Props) {
  return <Badge testID={testID} tone={status?.tone ?? 'neutral'} label={status ? t(status.label) : fallback} />;
}
