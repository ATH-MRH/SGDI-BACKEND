/** Fiche employé — référentiels, accesseurs tableaux, complétude, round-trip extra._legacy. */
import type { Employee, EmployeeInput } from '@sgdi/shared';

export type Legacy = Record<string, unknown>;

export function getLegacy(e: Employee): Legacy {
  const ex = (e.extra ?? {}) as Legacy;
  return { ...((ex._legacy as Legacy) ?? {}) };
}
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function arr(v: unknown): Legacy[] {
  return Array.isArray(v) ? (v as Legacy[]) : [];
}
export function daysBetween(a: unknown, b: unknown): number | null {
  const x = str(a).slice(0, 10); const y = str(b).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || !/^\d{4}-\d{2}-\d{2}$/.test(y)) return null;
  return Math.round((new Date(y).getTime() - new Date(x).getTime()) / 86400000);
}
/** Nombre de jours inclusif (du→au), comme le legacy (daysBetween+1). */
export function joursInclusif(du: unknown, au: unknown): string {
  const d = daysBetween(du, au);
  return d == null ? '—' : String(d + 1);
}

/** 48 wilayas d'Algérie. */
export const WILAYAS: string[] = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra', 'Béchar', 'Blida',
  'Bouira', 'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel',
  'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma', 'Constantine', 'Médéa',
  'Mostaganem', "M'Sila", 'Mascara', 'Ouargla', 'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj',
  'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela', 'Souk Ahras', 'Tipaza',
  'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent', 'Ghardaïa', 'Relizane',
];

export const BANQUES_ALGERIE: string[] = [
  'BNA', 'BEA', 'BADR', 'CPA', 'BDL', 'CNEP Banque', 'Al Baraka', 'BNP Paribas El Djazaïr',
  'Société Générale Algérie', 'Natixis Algérie', 'Trust Bank', 'Gulf Bank', 'AGB', 'Housing Bank',
  'Fransabank', 'Salam Bank', 'Algérie Poste (CCP)',
];

export const SITUATIONS = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)'];
export const SEXES = ['M', 'F'];
/** Durées de contrat proposées (recalcule dateFinContrat). */
export const DUREES_CONTRAT = ['1m', '3m', '6m', '12m', '24m', '36m', 'Indéterminée'];

export const HABILITATIONS: { key: string; label: string }[] = [
  { key: 'enqueteHabilitation', label: "Enquête d'habilitation" },
  { key: 'serviceNational', label: 'Service national' },
  { key: 'diplomeSecourisme', label: 'Diplôme de secourisme' },
  { key: 'diplomeAntiIncendie', label: 'Diplôme lutte anti-incendie' },
];

export const DOCUMENTS: { key: string; label: string }[] = [
  { key: 'ActeNaissance', label: 'Acte de naissance' },
  { key: 'CertifResidence', label: 'Certificat de résidence' },
  { key: 'CasierJudiciaire', label: 'Casier judiciaire' },
  { key: 'AptitudeMedicale', label: 'Aptitude médicale' },
  { key: 'BulletinANEM', label: 'Bulletin ANEM' },
  { key: 'ChequeBarre', label: 'Chèque barré' },
  { key: 'PieceIdentite', label: 'Pièce ID biométrique' },
  { key: 'FicheFamiliale', label: 'Fiche familiale' },
  { key: 'FicheIndividuelle', label: 'Fiche individuelle' },
];

/** 20 champs de complétude (clé + libellé FR exact). */
export const COMPLETENESS_FIELDS: { key: string; label: string }[] = [
  { key: 'matricule', label: 'Matricule' },
  { key: 'nom', label: 'Nom' },
  { key: 'prenom', label: 'Prénom' },
  { key: 'societe', label: 'Société' },
  { key: 'telephone', label: 'Téléphone' },
  { key: 'adresse', label: 'Adresse' },
  { key: 'dateNaissance', label: 'Date de naissance' },
  { key: 'lieuNaissance', label: 'Lieu de naissance' },
  { key: 'nin', label: 'NIN' },
  { key: 'numeroCnas', label: 'N° sécurité sociale' },
  { key: 'commune', label: 'Commune' },
  { key: 'wilaya', label: 'Wilaya' },
  { key: 'banque', label: 'Compte bancaire' },
  { key: 'numeroCompte', label: 'N° de compte' },
  { key: 'situation', label: 'Situation familiale' },
  { key: 'dateRecrutement', label: 'Date de recrutement' },
  { key: 'typeContrat', label: 'Type de contrat' },
  { key: 'fonction', label: 'Poste' },
  { key: 'contactUrgenceNom', label: "Contact d'urgence" },
  { key: 'contactUrgenceTel', label: "Téléphone d'urgence" },
];

/** Modèle éditable à plat, hydraté depuis colonnes + legacy (legacy prioritaire). */
export interface FicheForm {
  nom: string; prenom: string; nomPere: string; nomMere: string; adresse: string; commune: string;
  nin: string; wilaya: string; numeroCnas: string; telephone: string; numeroPasseport: string;
  email: string; banque: string; dateNaissance: string; numeroCompte: string; sexe: string;
  lieuNaissance: string; photo: string;
  contactUrgenceNom: string; contactUrgenceLien: string; contactUrgenceTel: string; noteUrgence: string;
  situation: string; nombreEnfants: number; famille: Legacy[];
  habilitations: Record<string, string>; langues: string[];
  fonction: string; typeContrat: string; salaireNet: string; dateRecrutement: string;
  dureeContrat: string; dateFinContrat: string; dureeEssai: number; dateFinEssai: string;
}

export function hydrateForm(e: Employee): FicheForm {
  const l = getLegacy(e);
  const hab = (l.habilitations as Record<string, unknown>) ?? {};
  const habilitations: Record<string, string> = {};
  for (const h of HABILITATIONS) habilitations[h.key] = str(hab[h.key]) || 'non';
  // Membres de famille : normaliser la clé date sur `dateNaissance` (schéma legacy).
  const famille = arr(l.famille).map((m) => ({
    nom: str(m.nom), prenom: str(m.prenom),
    dateNaissance: str(m.dateNaissance) || str(m.ddn), commentaire: str(m.commentaire),
  }));
  return {
    nom: str(l.nom) || e.last_name || '',
    prenom: str(l.prenom) || e.first_name || '',
    nomPere: str(l.nomPere) || e.father_name || '',
    nomMere: str(l.nomMere) || e.mother_name || '',
    adresse: str(l.adresse) || e.address || '',
    commune: str(l.commune) || e.commune || '',
    nin: str(l.nin) || e.nin || '',
    wilaya: str(l.wilaya) || e.wilaya || '',
    numeroCnas: str(l.numeroCnas),
    telephone: str(l.telephone) || e.phone || '',
    numeroPasseport: str(l.numeroPasseport),
    email: str(l.email) || e.email || '',
    banque: str(l.banque),
    dateNaissance: str(l.dateNaissance) || e.birth_date || '',
    numeroCompte: str(l.numeroCompte) || str(l.iban),
    sexe: str(l.sexe),
    lieuNaissance: str(l.lieuNaissance) || e.birth_place || '',
    photo: str(l.photo),
    contactUrgenceNom: str(l.contactUrgenceNom),
    contactUrgenceLien: str(l.contactUrgenceLien),
    contactUrgenceTel: str(l.contactUrgenceTel),
    noteUrgence: str(l.noteUrgence),
    situation: str(l.situation) || e.family_status || '',
    nombreEnfants: Number(l.nombreEnfants ?? e.children_count ?? 0) || 0,
    famille,
    habilitations,
    langues: (Array.isArray(l.langues) ? l.langues.map(String) : []),
    fonction: str(l.fonction) || e.position || '',
    typeContrat: str(l.typeContrat) || e.contract_type || 'CDD',
    salaireNet: str(l.salaireNet) || (e.salary_net ? String(e.salary_net) : ''),
    dateRecrutement: str(l.dateRecrutement) || e.recruit_date || '',
    dureeContrat: str(l.dureeContrat),
    dateFinContrat: str(l.dateFinContrat) || e.contract_end_date || '',
    dureeEssai: Number(l.dureeEssai ?? 90) || 90,
    dateFinEssai: str(l.dateFinEssai) || e.trial_end_date || '',
  };
}

/** Validation NIN : 10 ou 18 chiffres, sinon null (protège la colonne unique). */
function validNinOrNull(nin: string): string | null {
  const norm = str(nin).replace(/\D/g, '');
  return /^(\d{10}|\d{18})$/.test(norm) ? norm : null;
}

/** Construit le payload PUT : colonnes typées + extra (racine + _legacy) round-trippé complet. */
export function buildPayload(e: Employee, f: FicheForm): EmployeeInput {
  const prevExtra = (e.extra ?? {}) as Legacy;
  const prevLegacy = (prevExtra._legacy as Legacy) ?? {};
  // Ne persister que les membres de famille non vides (parité legacy).
  const famille = f.famille.filter((m) => str(m.nom) || str(m.prenom) || str(m.dateNaissance) || str(m.commentaire));
  const validNin = validNinOrNull(f.nin);
  const legacy: Legacy = {
    ...prevLegacy,
    nom: f.nom, prenom: f.prenom, nomPere: f.nomPere, nomMere: f.nomMere, adresse: f.adresse,
    commune: f.commune, nin: validNin || '', wilaya: f.wilaya, numeroCnas: f.numeroCnas, telephone: f.telephone,
    numeroPasseport: f.numeroPasseport, email: f.email, banque: f.banque, dateNaissance: f.dateNaissance,
    numeroCompte: f.numeroCompte, sexe: f.sexe, lieuNaissance: f.lieuNaissance, photo: f.photo,
    contactUrgenceNom: f.contactUrgenceNom, contactUrgenceLien: f.contactUrgenceLien,
    contactUrgenceTel: f.contactUrgenceTel, noteUrgence: f.noteUrgence,
    situation: f.situation, nombreEnfants: f.nombreEnfants, famille,
    habilitations: f.habilitations, langues: f.langues,
    fonction: f.fonction, typeContrat: f.typeContrat, salaireNet: f.salaireNet,
    dateRecrutement: f.dateRecrutement, dureeContrat: f.dureeContrat, dateFinContrat: f.dateFinContrat,
    dureeEssai: f.dureeEssai, dateFinEssai: f.dateFinEssai,
  };
  // Trace de NIN invalide (parité protection colonne unique).
  if (f.nin && !validNin) { legacy.ninInvalidOriginal = f.nin.trim(); legacy.ninAlert = true; }
  else { delete legacy.ninInvalidOriginal; delete legacy.ninAlert; }
  const salaryNet = Number(String(f.salaireNet).replace(/\s/g, '').replace(',', '.')) || 0;
  // extra : on écrase les props à plat périmées à la racine par les valeurs éditées (legacy racine-prioritaire).
  const extra: Legacy = { ...prevExtra, ...legacy, _legacy: legacy };
  return {
    last_name: f.nom, first_name: f.prenom, father_name: f.nomPere, mother_name: f.nomMere,
    address: f.adresse, commune: f.commune, nin: validNin, wilaya: f.wilaya, phone: f.telephone,
    email: f.email, birth_date: f.dateNaissance || null, birth_place: f.lieuNaissance,
    family_status: f.situation, children_count: f.nombreEnfants, position: f.fonction,
    contract_type: f.typeContrat, salary_net: salaryNet, recruit_date: f.dateRecrutement || null,
    trial_end_date: f.dateFinEssai || null, contract_end_date: f.dateFinContrat || null,
    extra,
  };
}

// --- Recalculs dérivés (onglet contrat, parité updateAgentTrialEndDate/contractEndDate) ---
export function addDays(startISO: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(startISO) || !Number.isFinite(days)) return '';
  const d = new Date(startISO.slice(0, 10));
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
export function contractEndDate(startISO: string, duree: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(startISO) || !duree) return '';
  const d = new Date(startISO.slice(0, 10));
  const mMonth = /^(\d+)\s*m/i.exec(duree);
  const mDay = /^(\d+)\s*[dj]/i.exec(duree);
  if (mMonth) { d.setMonth(d.getMonth() + Number(mMonth[1])); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  if (mDay) { return addDays(startISO, Number(mDay[1])); } // parité addDays legacy (sans -1)
  return ''; // Indéterminée / inconnu → pas de fin auto
}

// --- Accesseurs tableaux (lecture seule) ---
export const congesLegacy = (e: Employee): Legacy[] => arr(getLegacy(e).conges).filter((c) => str(c.type).toLowerCase() !== 'maladie');

/** Congés = leaves (source DB, type≠Maladie) si fournis, sinon extra._legacy.conges. Triés du desc. */
export function congesRows(e: Employee, leaves?: Legacy[] | null): Legacy[] {
  const src = leaves && leaves.length
    ? leaves.filter((l) => str(l.leave_type ?? l.type).toLowerCase() !== 'maladie').map(mapLeave)
    : congesLegacy(e);
  return [...src].sort((a, b) => str(b.du).localeCompare(str(a.du)));
}
/** Absences = gestionEvents(Absence/Maladie/Suspension) 'Carrière' + maladies 'Congés'. Triées du desc. */
export function absencesRows(e: Employee, leaves?: Legacy[] | null): Legacy[] {
  const l = getLegacy(e);
  const ev = arr(l.gestionEvents)
    .filter((g) => ['absence', 'maladie', 'suspension'].includes(str(g.type).toLowerCase()))
    .map((g): Legacy => ({ ...g, source: 'Carrière' }));
  const maladieSrc = leaves && leaves.length
    ? leaves.filter((x) => str(x.leave_type ?? x.type).toLowerCase() === 'maladie').map(mapLeave)
    : arr(l.conges).filter((c) => str(c.type).toLowerCase() === 'maladie');
  const maladie = maladieSrc.map((c): Legacy => ({ ...c, source: 'Congés' }));
  return [...ev, ...maladie].sort((a, b) => str(b.du).localeCompare(str(a.du)));
}
/** Mappe une ligne Leave (colonnes DB) vers la forme legacy {type,du,au,statut,motif}. */
function mapLeave(l: Legacy): Legacy {
  return {
    type: str(l.leave_type ?? l.type), du: str(l.start_date ?? l.du), au: str(l.end_date ?? l.au),
    statut: str(l.status ?? l.statut), motif: str(l.reason ?? l.motif),
  };
}

export const sanctions = (e: Employee): Legacy[] => arr(getLegacy(e).sanctions);
export const affectations = (e: Employee): Legacy[] => arr(getLegacy(e).affectationsHistorique);
export const affectationCourante = (e: Employee): Legacy => (getLegacy(e).affectationCourante as Legacy) ?? {};
export const contratsHistorique = (e: Employee): Legacy[] => arr(getLegacy(e).contratsPersonnel);
export const dotation = (e: Employee): Legacy[] => {
  const l = getLegacy(e);
  return arr(l.dotation).length ? arr(l.dotation) : arr(l.materiel);
};
export function documentsMap(e: Employee): Record<string, Legacy> {
  const d = getLegacy(e).documents;
  return (d && typeof d === 'object' ? d : {}) as Record<string, Legacy>;
}
export const isBlacklisted = (e: Employee): boolean => {
  const l = getLegacy(e);
  return Boolean(l.blacklist || l.blacklistContractBlocked || l.contractBlocked);
};

// --- Onglet Carrière : icône + couleur par type d'événement (parité gestionIcon/gestionPillClass) ---
const GESTION_META: Record<string, { icon: string; cls: string }> = {
  Recrutement: { icon: '🎯', cls: 'sg-pill--green' },
  Dotation: { icon: '📦', cls: 'sg-pill--blue' },
  Affectation: { icon: '📍', cls: 'sg-pill--blue' },
  Congé: { icon: '🏖', cls: 'sg-pill--blue' },
  Maladie: { icon: '🤒', cls: 'sg-pill--amber' },
  Absence: { icon: '❌', cls: 'sg-pill--red' },
  Suspension: { icon: '⏸', cls: 'sg-pill--purple' },
  'Mise en demeure': { icon: '⚠', cls: 'sg-pill--red' },
  'Période E-N-C': { icon: '🕒', cls: 'sg-pill--amber' },
  "Période d'essai": { icon: '🕒', cls: 'sg-pill--amber' },
  'Fin de contrat': { icon: '🚪', cls: 'sg-pill--gray' },
  Sanction: { icon: '⚖', cls: 'sg-pill--amber' },
  Blacklist: { icon: '⛔', cls: 'sg-pill--gray' },
};
export function gestionIcon(type: unknown): string { return GESTION_META[str(type)]?.icon ?? '•'; }
export function gestionPillClass(type: unknown): string { return GESTION_META[str(type)]?.cls ?? 'sg-pill--gray'; }
export function gestionStatusClass(statut: unknown): string {
  const s = str(statut).toLowerCase();
  if (s === 'current') return 'sg-pill--green';
  if (s === 'en cours' || s === 'en_cours') return 'sg-pill--amber';
  return 'sg-pill--gray';
}
export function gestionStatusLabel(statut: unknown): string {
  return str(statut) === 'current' ? 'En cours' : (str(statut) || 'terminé');
}
/**
 * Événements de carrière triés (du desc). Marque comme « current » le PREMIER événement
 * d'affectation sans date de fin quand une affectation live existe (parité gestionHistoriqueDisplayRows).
 */
export function gestionRows(e: Employee): Legacy[] {
  const aff = affectationCourante(e);
  const hasLive = Boolean(aff.siteId || aff.siteName);
  const sorted = arr(getLegacy(e).gestionEvents)
    .slice()
    .sort((a, b) => str(b.du || b.createdAt).localeCompare(str(a.du || a.createdAt)));
  let activeShown = false;
  return sorted.map((g): Legacy => {
    const isAff = str(g.type).toLowerCase().includes('affectation');
    const isCurrent = hasLive && isAff && !g.au && !activeShown;
    if (isCurrent) activeShown = true;
    return { ...g, __statut: isCurrent ? 'current' : (str(g.statut) || 'terminé') };
  });
}

/** Complétude sur 20 champs → % + liste des LIBELLÉS manquants. */
export function completeness(f: FicheForm, e: Employee): { pct: number; filled: number; missing: string[] } {
  const vals: Record<string, unknown> = {
    matricule: e.code, nom: f.nom, prenom: f.prenom, societe: e.society, telephone: f.telephone,
    adresse: f.adresse, dateNaissance: f.dateNaissance, lieuNaissance: f.lieuNaissance, nin: f.nin,
    numeroCnas: f.numeroCnas, commune: f.commune, wilaya: f.wilaya, banque: f.banque,
    numeroCompte: f.numeroCompte, situation: f.situation, dateRecrutement: f.dateRecrutement,
    typeContrat: f.typeContrat, fonction: f.fonction, contactUrgenceNom: f.contactUrgenceNom,
    contactUrgenceTel: f.contactUrgenceTel,
  };
  const missing: string[] = [];
  let filled = 0;
  for (const field of COMPLETENESS_FIELDS) {
    if (str(vals[field.key]).trim()) filled++;
    else missing.push(field.label);
  }
  return { pct: Math.round((filled / COMPLETENESS_FIELDS.length) * 100), filled, missing };
}

export function completenessRingClass(pct: number): string {
  return pct >= 85 ? 'good' : pct >= 60 ? 'medium' : 'low';
}

/** Format monétaire FR (2 décimales). */
export function formatMoney(v: unknown): string {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || !n) return str(v) || '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
