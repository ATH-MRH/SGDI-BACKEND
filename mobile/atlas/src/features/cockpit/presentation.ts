import type { IconName } from '@/components/ui';
import type { TranslationKey } from '@/i18n';
import { formatDate } from '@/utils/format';

/** Icône de chaque indicateur du cockpit. Une clé inconnue reçoit une icône neutre. */
const KPI_ICONS: Record<string, IconName> = {
  expected: 'people-outline',
  present: 'checkmark-circle-outline',
  absent: 'close-circle-outline',
  notPointed: 'help-circle-outline',
  abandons: 'exit-outline',
  alertsOpen: 'notifications-outline',
  alertsCritical: 'alert-circle-outline',
  leaves: 'calendar-outline',
};

export function kpiIcon(key: string): IconName {
  return KPI_ICONS[key] ?? 'stats-chart-outline';
}

const WEEKDAYS: readonly TranslationKey[] = ['day.sun', 'day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat'];

/** Clé du jour de la semaine d'une date "2026-10-07", sans dépendre de la locale du moteur. */
export function weekdayKey(date: string): TranslationKey {
  const [year, month, day] = date.split('-').map(Number);
  const index = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return WEEKDAYS[index] ?? 'day.mon';
}

/** "07/10" : jour et mois d'une date ISO. */
export function shortDate(date: string): string {
  return formatDate(date).slice(0, 5);
}

/** Taux 0–1 → "96 %" ; "—" quand il est inconnu. */
export function percent(ratio: number | null | undefined): string {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? `${Math.round(ratio * 100)} %` : '—';
}
