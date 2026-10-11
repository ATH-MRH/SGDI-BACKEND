import type { Tone } from '@/theme/tokens';

import { KpiCard } from './KpiCard';

type Props = { label: string; value: string | number; tone?: Tone; testID?: string };

/** Indicateur simple, non cliquable. */
export function Kpi({ label, value, tone = 'neutral', testID }: Props) {
  return <KpiCard testID={testID} label={label} value={value} tone={tone} />;
}
