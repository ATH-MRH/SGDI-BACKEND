/** Accesseurs & taxonomie employé — round-trip via extra._legacy (fiche SPEC Effectif). */
import type { Employee } from '@sgdi/shared';

type Rec = Record<string, unknown>;
function legacy(e: Employee): Rec {
  const ex = (e.extra ?? {}) as Rec;
  return (ex._legacy as Rec) ?? {};
}
function arr(v: unknown): Rec[] {
  return Array.isArray(v) ? (v as Rec[]) : [];
}
function s(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export const nom = (e: Employee): string => s(legacy(e).nom) || e.last_name || '';
export const prenom = (e: Employee): string => s(legacy(e).prenom) || e.first_name || '';
export const matricule = (e: Employee): string => s(legacy(e).matricule) || e.code || '';
export const telephone = (e: Employee): string => s(legacy(e).telephone) || e.phone || '';
export const societe = (e: Employee): string => s(legacy(e).societe) || e.society || '';
// Pas de repli 'actif' : un statut vide reste vide (toLowerCase brut ; pas de mapping de synonymes).
export const statut = (e: Employee): string => (s(legacy(e).statut) || e.status || '').toLowerCase();
export const photo = (e: Employee): string => s(legacy(e).photo);
export const dateNaissance = (e: Employee): string => s(legacy(e).dateNaissance) || e.birth_date || '';
export const situation = (e: Employee): string => s(legacy(e).situation) || e.family_status || '';
export const dateRecrutement = (e: Employee): string => s(legacy(e).dateRecrutement) || e.recruit_date || '';
export const fullName = (e: Employee): string => `${nom(e)} ${prenom(e)}`.trim();

// Colonne/tri Poste = affectationCourante.poste → fonction → position (PAS legacy.poste seul).
export function poste(e: Employee): string {
  const l = legacy(e);
  const aff = (l.affectationCourante as Rec) ?? {};
  return s(aff.poste) || s(l.fonction) || e.position || '';
}
export function siteName(e: Employee): string {
  const aff = (legacy(e).affectationCourante as Rec) ?? {};
  return s(aff.siteName);
}
function hasAffectation(e: Employee): boolean {
  const aff = (legacy(e).affectationCourante as Rec) ?? {};
  return Boolean(aff.siteId || aff.siteName);
}
export const gestionEvents = (e: Employee): Rec[] => arr(legacy(e).gestionEvents);

/** Blacklist stricte (a.blacklist seul) pour le filtre liste + KPI K7 (parité legacy). */
export const isBlacklistStrict = (e: Employee): boolean => Boolean(legacy(e).blacklist);
/** Blacklist « pastille » (3 drapeaux) pour l'affichage du statut uniquement. */
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

const SORTANT_STATUTS = ['sortant', 'archive', 'demissionne', 'démissionné', 'licencie', 'licencié'];
function isFormer(e: Employee): boolean {
  if (SORTANT_STATUTS.includes(statut(e))) return true;
  const l = legacy(e);
  const ds = s(l.dateSortie) || s(l.departAt);
  // Date de sortie renseignée : former seulement si déjà passée (une sortie future ≠ former).
  if (/^\d{4}-\d{2}-\d{2}/.test(ds)) return ds.slice(0, 10) <= todayISO();
  return Boolean(l.finRelationAt);
}

/** Prédicats de sous-filtre. */
export function matchesFilter(e: Employee, filter: string): boolean {
  const st = statut(e);
  switch (filter) {
    case 'operationnels': return st === 'actif' && Boolean(siteName(e));
    case 'conge': return st === 'conge' || st === 'congé' || st === 'en_conge';
    case 'maladie': return st === 'maladie';
    case 'absents': {
      if (st === 'absent') return true;
      const td = todayISO();
      return gestionEvents(e).some((g) =>
        s(g.type).toLowerCase() === 'absence'
        && ['en_cours', 'approuve'].includes(s(g.statut || 'en_cours').toLowerCase())
        && (!g.du || s(g.du) <= td) && (!g.au || s(g.au) >= td));
    }
    case 'suspension': return st === 'suspendu' || st === 'suspension';
    case 'sortant': return SORTANT_STATUTS.includes(st);
    case 'blacklist': return isBlacklistStrict(e);
    case 'instance_affectation': return !isFormer(e) && !hasAffectation(e);
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
  if (st === 'conge' || st === 'congé' || st === 'en_conge') return { label: 'CONGÉ', cls: 'sg-pill--blue' };
  if (st === 'maladie') return { label: 'MALADIE', cls: 'sg-pill--amber' };
  if (st === 'absent' || st === 'abandon') return { label: st.toUpperCase(), cls: 'sg-pill--red' };
  if (st === 'actif') return { label: 'ACTIF', cls: 'sg-pill--green' };
  return { label: st.toUpperCase() || '—', cls: 'sg-pill--gray' };
}

/** Les 7 KPI (libellés/couleurs/route exacts de la fiche SPEC). K7 blacklist = drapeau strict. */
export const EFFECTIF_KPIS: { key: string; label: string; color: string; filter: string }[] = [
  { key: 'operationnels', label: 'Opérationnel', color: '#16a34a', filter: 'operationnels' },
  { key: 'conge', label: 'En congé', color: '#0360a8', filter: 'conge' },
  { key: 'maladie', label: 'En maladie', color: '#f97316', filter: 'maladie' },
  { key: 'absents', label: 'En absence', color: '#dc2626', filter: 'absents' },
  { key: 'suspension', label: 'Suspendu', color: '#7c3aed', filter: 'suspension' },
  { key: 'sortant', label: 'Sortant', color: '#475569', filter: 'sortant' },
  { key: 'blacklist', label: 'BLACKLIST', color: '#111827', filter: 'blacklist' },
];

/**
 * Comptage KPI. K4 « En absence » = statut='absent' UNIQUEMENT (divergence assumée vs liste).
 * K7 blacklist = drapeau strict. Les autres suivent matchesFilter.
 */
export function kpiCount(list: Employee[], filter: string): number {
  if (filter === 'absents') return list.filter((e) => statut(e) === 'absent').length;
  return list.filter((e) => matchesFilter(e, filter)).length;
}
