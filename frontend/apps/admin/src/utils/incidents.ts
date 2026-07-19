/** Règles d'affichage des incidents — fidèles à la fiche SPEC (incidentPillClass, statuts). */
import type { Incident } from '@sgdi/shared';

const CLOSED = ['clos', 'resolu', 'résolu', 'cloture', 'clôturé', 'ferme', 'fermé', 'closed'];
const CRITICAL = ['critique', 'majeur', 'urgent'];

export const isClosed = (i: Incident): boolean => CLOSED.includes((i.status ?? '').toLowerCase());
export const isCritical = (i: Incident): boolean =>
  CRITICAL.includes((i.severity ?? '').toLowerCase()) && !isClosed(i);

/** incidentPillClass : rouge critique/majeur/urgent · ambre alerte/moyen/mineur · vert clos · gris sinon. */
export function pillClass(value: string | null): string {
  const s = (value ?? '').toLowerCase();
  if (['critique', 'majeur', 'urgent'].includes(s)) return 'sg-pill--red';
  if (['alerte', 'moyen', 'mineur'].includes(s)) return 'sg-pill--amber';
  if (['clos', 'resolu', 'résolu'].includes(s)) return 'sg-pill--green';
  return 'sg-pill--gray';
}

/** Bordure gauche de carte : vert clos, sinon rouge critique, sinon orange ouvert. */
export function cardBorder(i: Incident): string {
  if (isClosed(i)) return '#10b981';
  if (isCritical(i)) return '#dc2626';
  return '#c2410c';
}

// Référentiels du formulaire (valeurs/libellés exacts de la fiche SPEC).
export const CATEGORIES = ['Sécurité', 'Discipline', 'Matériel', 'Client', 'Accident', 'Consigne', 'Autre'];
export const SEVERITIES = [
  { value: 'mineur', label: 'Normal' },
  { value: 'majeur', label: 'Élevée' },
  { value: 'critique', label: 'Très élevée' },
];
export const STATUSES = [
  { value: 'en_cours', label: 'En cours' },
  { value: 'acquitte', label: 'Acquitté' },
  { value: 'clos', label: 'Clôturé' },
];

export function formatFR(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return day && m && y ? `${day}/${m}/${y}` : d;
}

export function formatDateTimeFR(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? iso : dt.toLocaleString('fr-FR');
}

export const safe = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return s.trim() === '' ? '—' : s;
};
