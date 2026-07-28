/** Accesseurs & taxonomie employé — round-trip via extra._legacy (fiche SPEC Effectif). */
import type { Employee } from '@sgdi/shared';

type Rec = Record<string, unknown>;
function legacy(e: Employee): Rec {
  const ex = (e.extra ?? {}) as Rec;
  return (ex._legacy as Rec) ?? {};
}
function s(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export const nom = (e: Employee): string => s(legacy(e).nom) || e.last_name || '';
export const prenom = (e: Employee): string => s(legacy(e).prenom) || e.first_name || '';
export const matricule = (e: Employee): string => s(legacy(e).matricule) || e.code || '';
export const telephone = (e: Employee): string => s(legacy(e).telephone) || e.phone || '';
export const societe = (e: Employee): string => s(legacy(e).societe) || e.society || '';
export const statut = (e: Employee): string => (s(legacy(e).statut) || e.status || 'actif').toLowerCase();
export const photo = (e: Employee): string => s(legacy(e).photo);
export const dateNaissance = (e: Employee): string => s(legacy(e).dateNaissance) || e.birth_date || '';
export const situation = (e: Employee): string => s(legacy(e).situation) || e.family_status || '';
export const dateRecrutement = (e: Employee): string => s(legacy(e).dateRecrutement) || e.recruit_date || '';
export const fullName = (e: Employee): string => `${nom(e)} ${prenom(e)}`.trim();

export function poste(e: Employee): string {
  const l = legacy(e);
  const aff = (l.affectationCourante as Rec) ?? {};
  return s(l.poste) || s(aff.poste) || s(l.fonction) || e.position || '';
}
export function siteName(e: Employee): string {
  const aff = (legacy(e).affectationCourante as Rec) ?? {};
  return s(aff.siteName);
}
export function isBlacklist(e: Employee): boolean {
  const l = legacy(e);
  return Boolean(l.blacklist || l.blacklistContractBlocked || l.contractBlocked);
}
export function ageYears(e: Employee): number | null {
  const bd = dateNaissance(e);
  if (!/^\d{4}-\d{2}-\d{2}/.test(bd)) return null;
  const b = new Date(bd); const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

const SORTANT_STATUTS = ['sortant', 'demissionne', 'démissionné', 'licencie', 'licencié'];

/** Prédicats de sous-filtre (axe statut principal ; congé/maladie/opérationnel approximés). */
export function matchesFilter(e: Employee, filter: string): boolean {
  const st = statut(e);
  switch (filter) {
    case 'operationnels': return st === 'actif' && Boolean(siteName(e));
    case 'conge': return st === 'conge' || st === 'congé' || st === 'en_conge';
    case 'maladie': return st === 'maladie';
    case 'absents': return st === 'absent';
    case 'suspension': return st === 'suspendu' || st === 'suspension';
    case 'sortant': return SORTANT_STATUTS.includes(st);
    case 'blacklist': return isBlacklist(e);
    case 'instance_affectation': return st === 'actif' && !siteName(e);
    case 'actifs':
    default: return st === 'actif';
  }
}

/** Pastille de statut (MAJUSCULES) : classe + libellé. */
export function statusPill(e: Employee): { label: string; cls: string } {
  if (isBlacklist(e)) return { label: 'BLACKLIST', cls: 'sg-pill--gray' };
  const st = statut(e);
  if (SORTANT_STATUTS.includes(st)) return { label: 'SORTANT', cls: 'sg-pill--gray' };
  if (st === 'suspendu' || st === 'suspension') return { label: 'SUSPENDU', cls: 'sg-pill--amber' };
  if (st === 'absent' || st === 'abandon') return { label: st.toUpperCase(), cls: 'sg-pill--red' };
  if (st === 'actif') return { label: 'ACTIF', cls: 'sg-pill--green' };
  return { label: st.toUpperCase() || 'ACTIF', cls: 'sg-pill--gray' };
}

/** Les 7 KPI (libellés/couleurs/route exacts de la fiche SPEC). */
export const EFFECTIF_KPIS: { key: string; label: string; icon: string; color: string; filter: string }[] = [
  { key: 'operationnels', label: 'Opérationnel', icon: '👮', color: '#16a34a', filter: 'operationnels' },
  { key: 'conge', label: 'En congé', icon: '🏖', color: '#0360a8', filter: 'conge' },
  { key: 'maladie', label: 'En maladie', icon: '🤒', color: '#f97316', filter: 'maladie' },
  { key: 'absents', label: 'En absence', icon: '❌', color: '#dc2626', filter: 'absents' },
  { key: 'suspension', label: 'Suspendu', icon: '⏸', color: '#7c3aed', filter: 'suspension' },
  { key: 'sortant', label: 'Sortant', icon: '➡', color: '#475569', filter: 'sortant' },
  { key: 'blacklist', label: 'BLACKLIST', icon: '⛔', color: '#111827', filter: 'blacklist' },
];
