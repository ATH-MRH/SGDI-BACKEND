/** Taxonomie et affichage des candidats — fidèle aux règles legacy (fiche SPEC, TAXO-1..8). */
import type { Candidate } from '@sgdi/shared';

/** Lecture d'un champ dans le blob `data` (les 7 sections y vivent). */
function d(c: Candidate, key: string): unknown {
  return (c.data ?? {})[key];
}
function ds(c: Candidate, key: string): string {
  const v = d(c, key);
  return v === null || v === undefined ? '' : String(v);
}

const norm = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const ARCHIVE_STATUS = ['archive', 'archived', 'archivé', 'archivee', 'archivée'];
const RECRUITED_STATUS = ['embauche', 'embauché', 'recrute', 'recruté', 'employe', 'employé'];

export function isArchived(c: Candidate): boolean {
  if (ARCHIVE_STATUS.includes(norm(c.status || ''))) return true;
  return Boolean(d(c, 'archivedAt') || d(c, 'motifArchive') || d(c, 'commentaireArchive'));
}
export function isRecruited(c: Candidate): boolean {
  const st = norm(c.status || '');
  if (RECRUITED_STATUS.some((s) => st.includes(s))) return true;
  return Boolean(d(c, 'convertedEmployeeId') || d(c, 'convertedAt') || d(c, 'employeeId') || d(c, 'agentId'));
}
export const isActive = (c: Candidate): boolean => !isArchived(c) && !isRecruited(c);
/** Réserve = statut 'reserve' ET fichePositionValidee === true (LES DEUX). */
export function isReserve(c: Candidate): boolean {
  return norm(c.status || '') === 'reserve' && d(c, 'fichePositionValidee') === true;
}
/** Nouvelle = actif et pas en réserve (un 'reserve' sans validation reste 'nouvelle'). */
export const isNew = (c: Candidate): boolean => isActive(c) && !isReserve(c);

/** Avis normalisé : inconnu/vide => 'Instance' (jamais d'avis vide). */
export function avisValue(raw: unknown): 'Favorable' | 'Défavorable' | 'Instance' {
  const s = norm(String(raw ?? ''));
  if (s === 'favorable') return 'Favorable';
  if (s === 'defavorable') return 'Défavorable';
  return 'Instance';
}
export function candidateAvis(c: Candidate): 'Favorable' | 'Défavorable' | 'Instance' {
  return avisValue(d(c, 'avisDecision'));
}
export function avisClass(v: string): string {
  const a = avisValue(v);
  if (a === 'Favorable') return 'avis-favorable';
  if (a === 'Défavorable') return 'avis-defavorable';
  return 'avis-instance';
}

/** Poste affiché : 1re valeur valide (rejette vide, 4-6 chiffres, dates) sinon « Non renseigné ». */
export function posteLabel(c: Candidate): string {
  const candidates = [ds(c, 'posteSouhaite'), ds(c, 'posteContrat'), ds(c, 'fonction'), ds(c, 'poste'), c.desired_position ?? ''];
  for (const raw of candidates) {
    const v = (raw || '').trim();
    if (!v) continue;
    if (/^\d{4,6}$/.test(v)) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
    return v;
  }
  return 'Non renseigné';
}

/** Téléphone : chiffres tronqués à 10, groupés 4-2-2-2. */
export function formatPhone(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 10);
  if (!digits) return '—';
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8), digits.slice(8, 10)].filter(Boolean);
  return parts.join(' ');
}

export const societe = (c: Candidate): string => c.society || ds(c, 'societe');
export const wilaya = (c: Candidate): string => ds(c, 'wilaya');
export const photo = (c: Candidate): string => ds(c, 'photo');
export const telephone = (c: Candidate): string => c.phone || ds(c, 'telephone');
export const motifArchive = (c: Candidate): string => ds(c, 'motifArchive');
export const archivedAt = (c: Candidate): string => ds(c, 'archivedAt') || (c.updated_at ?? '') || c.created_at;
export const fullName = (c: Candidate): string => `${c.last_name ?? ''} ${c.first_name ?? ''}`.trim();

/** Alerte NIN non conforme (importé) et alerte âge < 20 ans. */
export function ninAlert(c: Candidate): boolean {
  const nin = ds(c, 'nin').replace(/\s/g, '');
  // Backend : NIN = exactement 10 chiffres (sinon alerte, tolérée pour les imports).
  return Boolean(nin) && !/^\d{10}$/.test(nin);
}
export function ageYears(c: Candidate): number | null {
  const bd = ds(c, 'dateNaissance');
  if (!/^\d{4}-\d{2}-\d{2}/.test(bd)) return null;
  const birth = new Date(bd);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}
