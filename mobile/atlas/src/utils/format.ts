/** Formatage d'affichage sans dépendance à la locale du moteur JavaScript. */

const pad = (value: number) => String(value).padStart(2, '0');

/** "2026-10-07" ou ISO → "07/10/2026" ; chaîne vide si illisible. */
export function formatDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** ISO avec heure → "07/10/2026 14:05" (heure telle que fournie par le serveur). */
export function formatDateTime(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : formatDate(value);
}

/** ISO avec heure → "14:05". */
export function formatTime(value: string | null | undefined): string {
  const match = /[T ](\d{2}):(\d{2})/.exec(value ?? '');
  if (match) return `${match[1]}:${match[2]}`;
  return /^\d{2}:\d{2}/.test(value ?? '') ? (value ?? '').slice(0, 5) : '';
}

/** Minutes → "1 h 05" ou "45 min". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '';
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  return hours > 0 ? `${hours} h ${pad(total % 60)}` : `${total} min`;
}

export function fullName(last: string | null | undefined, first: string | null | undefined): string {
  return [last, first].map((part) => (part ?? '').trim()).filter(Boolean).join(' ');
}

/** "07/10/2026" saisi par l'utilisateur → "2026-10-07" ; null si la date n'existe pas. */
export function parseDateInput(value: string): string | null {
  const match = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\s*$/.exec(value);
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Date locale de l'appareil décalée de `days` jours, au format "2026-10-07". */
export function localDate(days: number = 0, from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Montant → "1 234 567,50 DA" (séparateurs français, sans dépendre de Intl) ; "—" s'il est inconnu. */
export function formatMoney(value: number | null | undefined, currency: string = 'DA'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const negative = value < 0;
  const [whole = '0', cents = '00'] = Math.abs(value).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return `${negative ? '-' : ''}${grouped},${cents} ${currency}`;
}

/** Montant compact pour une tuile : "1,2 M DA", "845 k DA". */
export function formatMoneyShort(value: number | null | undefined, currency: string = 'DA'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')} M ${currency}`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1000)} k ${currency}`;
  return formatMoney(value, currency);
}

/** Premier jour du mois et aujourd'hui, au format "2026-10-01". */
export function currentMonth(from: Date = new Date()): { from: string; to: string } {
  return { from: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`, to: localDate(0, from) };
}
