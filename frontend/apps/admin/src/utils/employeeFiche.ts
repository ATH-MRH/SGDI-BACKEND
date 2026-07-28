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

/** 48 wilayas d'Algérie (code — nom). */
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

/** 20 champs de complétude (AGENT_COMPLETENESS_FIELDS). */
export const COMPLETENESS_FIELDS = [
  'matricule', 'nom', 'prenom', 'societe', 'telephone', 'adresse', 'dateNaissance', 'lieuNaissance',
  'nin', 'numeroCnas', 'commune', 'wilaya', 'banque', 'numeroCompte', 'situation', 'dateRecrutement',
  'typeContrat', 'fonction', 'contactUrgenceNom', 'contactUrgenceTel',
];

/** Modèle éditable à plat, hydraté depuis colonnes + legacy (legacy prioritaire). */
export interface FicheForm {
  // Identité
  nom: string; prenom: string; nomPere: string; nomMere: string; adresse: string; commune: string;
  nin: string; wilaya: string; numeroCnas: string; telephone: string; numeroPasseport: string;
  email: string; banque: string; dateNaissance: string; numeroCompte: string; sexe: string;
  lieuNaissance: string; photo: string;
  // Contact urgence
  contactUrgenceNom: string; contactUrgenceLien: string; contactUrgenceTel: string; noteUrgence: string;
  // Famille
  situation: string; nombreEnfants: number; famille: Legacy[];
  // Habilitations
  habilitations: Record<string, string>; langues: string[];
  // Contrat
  fonction: string; typeContrat: string; salaireNet: string; dateRecrutement: string;
  dureeContrat: string; dateFinContrat: string; dureeEssai: number; dateFinEssai: string;
}

export function hydrateForm(e: Employee): FicheForm {
  const l = getLegacy(e);
  const hab = (l.habilitations as Record<string, unknown>) ?? {};
  const habilitations: Record<string, string> = {};
  for (const h of HABILITATIONS) habilitations[h.key] = str(hab[h.key]) || 'non';
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
    famille: arr(l.famille).map((m) => ({ ...m })),
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

/** Construit le payload PUT : colonnes typées + extra._legacy fusionné (round-trip complet). */
export function buildPayload(e: Employee, f: FicheForm): EmployeeInput {
  const prevExtra = (e.extra ?? {}) as Legacy;
  const prevLegacy = (prevExtra._legacy as Legacy) ?? {};
  const legacy: Legacy = {
    ...prevLegacy,
    nom: f.nom, prenom: f.prenom, nomPere: f.nomPere, nomMere: f.nomMere, adresse: f.adresse,
    commune: f.commune, nin: f.nin, wilaya: f.wilaya, numeroCnas: f.numeroCnas, telephone: f.telephone,
    numeroPasseport: f.numeroPasseport, email: f.email, banque: f.banque, dateNaissance: f.dateNaissance,
    numeroCompte: f.numeroCompte, sexe: f.sexe, lieuNaissance: f.lieuNaissance, photo: f.photo,
    contactUrgenceNom: f.contactUrgenceNom, contactUrgenceLien: f.contactUrgenceLien,
    contactUrgenceTel: f.contactUrgenceTel, noteUrgence: f.noteUrgence,
    situation: f.situation, nombreEnfants: f.nombreEnfants, famille: f.famille,
    habilitations: f.habilitations, langues: f.langues,
    fonction: f.fonction, typeContrat: f.typeContrat, salaireNet: f.salaireNet,
    dateRecrutement: f.dateRecrutement, dureeContrat: f.dureeContrat, dateFinContrat: f.dateFinContrat,
    dureeEssai: f.dureeEssai, dateFinEssai: f.dateFinEssai,
  };
  const salaryNet = Number(String(f.salaireNet).replace(/\s/g, '').replace(',', '.')) || 0;
  return {
    last_name: f.nom, first_name: f.prenom, father_name: f.nomPere, mother_name: f.nomMere,
    address: f.adresse, commune: f.commune, nin: f.nin || null, wilaya: f.wilaya, phone: f.telephone,
    email: f.email, birth_date: f.dateNaissance || null, birth_place: f.lieuNaissance,
    family_status: f.situation, children_count: f.nombreEnfants, position: f.fonction,
    contract_type: f.typeContrat, salary_net: salaryNet, recruit_date: f.dateRecrutement || null,
    trial_end_date: f.dateFinEssai || null, contract_end_date: f.dateFinContrat || null,
    extra: { ...prevExtra, _legacy: legacy },
  };
}

// --- Accesseurs tableaux (lecture seule) ---
export const conges = (e: Employee): Legacy[] => arr(getLegacy(e).conges).filter((c) => str(c.type).toLowerCase() !== 'maladie');
export const absencesEvents = (e: Employee): Legacy[] => {
  const l = getLegacy(e);
  const ev = arr(l.gestionEvents).filter((g) => ['absence', 'maladie', 'suspension'].includes(str(g.type).toLowerCase()));
  const maladie = arr(l.conges).filter((c) => str(c.type).toLowerCase() === 'maladie');
  return [...ev, ...maladie];
};
export const gestionEvents = (e: Employee): Legacy[] => arr(getLegacy(e).gestionEvents);
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

/** Complétude sur 20 champs → % + liste des manquants. */
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
  for (const k of COMPLETENESS_FIELDS) {
    if (str(vals[k]).trim()) filled++;
    else missing.push(k);
  }
  return { pct: Math.round((filled / COMPLETENESS_FIELDS.length) * 100), filled, missing };
}

export function completenessRingClass(pct: number): string {
  return pct >= 85 ? 'good' : pct >= 60 ? 'medium' : 'low';
}
