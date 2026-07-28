/** Configuration déclarative des sections de la fiche candidat (fiche SPEC, ZÉRO oubli). */

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'select' | 'textarea' | 'email' | 'money' | 'phone' | 'cnas';
  options?: { value: string; label: string }[];
  required?: boolean;
  colSpan?: boolean;
  placeholder?: string;
  maxlength?: number;
  min?: number;
  step?: number;
  note?: string;
}

export interface SectionDef {
  key: string;
  title: string;
  banner: 'amber' | 'green' | 'blue';
  etape: 1 | 2;
  fields: FieldDef[];
  required: string[]; // champs obligatoires (validation JS)
}

const opt = (values: string[]) => values.map((v) => ({ value: v, label: v }));
const optEmpty = (values: string[], empty = '—') => [{ value: '', label: empty }, ...opt(values)];

export const SITUATIONS = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)'];
export const GROUPES_SANGUINS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const TAILLES_CHEMISE = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
export const TAILLES_PANTALON = ['36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56', '58', '60'];
export const LANGUES = ['Arabe', 'Français', 'Anglais', 'Kabyle', 'Espagnol', 'Allemand'];
export const MOTIFS_DEPART = [
  'Démission', 'Fin de contrat CDD', 'Licenciement économique', 'Licenciement personnel',
  'Rupture conventionnelle', 'Fin de mission', "Période d'essai non concluante", 'Retraite', 'Autre',
];
export const HABILITATIONS = [
  { name: 'hab_enqueteHabilitation', label: "Enquête d'habilitation" },
  { name: 'hab_serviceNational', label: 'Service national' },
  { name: 'hab_diplomeSecourisme', label: 'Diplôme de secourisme' },
  { name: 'hab_diplomeAntiIncendie', label: 'Diplôme lutte anti-incendie' },
];

// Wilayas d'Algérie (58).
export const WILAYAS = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra', 'Béchar', 'Blida', 'Bouira',
  'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel', 'Sétif', 'Saïda',
  'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma', 'Constantine', 'Médéa', 'Mostaganem', "M'Sila", 'Mascara',
  'Ouargla', 'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt',
  'El Oued', 'Khenchela', 'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent', 'Ghardaïa',
  'Relizane', 'Timimoun', 'Bordj Badji Mokhtar', 'Ouled Djellal', 'Béni Abbès', 'In Salah', 'In Guezzam',
  'Touggourt', 'Djanet', "El M'Ghair", 'El Meniaa',
];

export const SECTIONS: SectionDef[] = [
  {
    key: 'identification', title: 'IDENTIFICATION DU CANDIDAT', banner: 'amber', etape: 1,
    required: ['nom', 'prenom', 'dateNaissance', 'lieuNaissance', 'sexe', 'nomPere', 'nomMere', 'nin', 'situation', 'source'],
    fields: [
      { name: 'nom', label: 'Nom *', type: 'text', required: true },
      { name: 'prenom', label: 'Prénom *', type: 'text', required: true },
      { name: 'dateNaissance', label: 'Date de naissance *', type: 'date', required: true, note: 'Âge minimum requis : 20 ans révolus à la date d\'enregistrement.' },
      { name: 'lieuNaissance', label: 'Lieu de naissance *', type: 'text', required: true },
      { name: 'sexe', label: 'Sexe *', type: 'select', options: opt(['M', 'F']), required: true },
      { name: 'situation', label: 'Situation familiale *', type: 'select', options: opt(SITUATIONS), required: true },
      { name: 'nombreEnfants', label: "Nombre d'enfant *", type: 'number', min: 0, placeholder: '0' },
      { name: 'groupeSanguin', label: 'Groupe sanguin', type: 'select', options: optEmpty(GROUPES_SANGUINS) },
      { name: 'nomPere', label: 'Nom du père *', type: 'text', required: true },
      { name: 'nomMere', label: 'Nom de la mère *', type: 'text', required: true },
      { name: 'source', label: 'Source *', type: 'text', required: true, placeholder: 'ANEM, LinkedIn, recommandation…' },
      { name: 'nin', label: 'NIN', type: 'text', maxlength: 20 },
      { name: 'numeroCnas', label: 'N° CNAS', type: 'cnas', maxlength: 13, placeholder: 'xxxxxxxxxx xx' },
      { name: 'taille', label: 'Taille (cm)', type: 'number' },
      { name: 'pointure', label: 'Pointure', type: 'number' },
      { name: 'tailleChemise', label: 'Taille chemise', type: 'select', options: opt(TAILLES_CHEMISE) },
      { name: 'taillePantalon', label: 'Taille pantalon', type: 'select', options: optEmpty(TAILLES_PANTALON) },
    ],
  },
  {
    key: 'militaire', title: 'SERVICE MILITAIRE', banner: 'amber', etape: 1, required: [],
    fields: [
      { name: 'armeService', label: 'Arme', type: 'text', placeholder: 'Infanterie, marine, aviation…' },
      { name: 'nombreAnneesService', label: "Nombre d'année", type: 'number', min: 0, step: 0.5 },
      { name: 'dateIncorporation', label: "Date d'incorporation", type: 'date' },
      { name: 'dateRadiation', label: 'Date de radiation', type: 'date' },
    ],
  },
  {
    key: 'poste', title: 'Poste & CV', banner: 'green', etape: 1,
    required: ['posteSouhaite', 'telephone'],
    fields: [
      { name: 'posteSouhaite', label: 'Poste souhaité *', type: 'select', options: [], required: true },
      { name: 'dureeContrat', label: 'Durée du contrat', type: 'select', options: [] },
      { name: 'salairePrevu', label: 'Salaire prévu pour le poste (DA/mois)', type: 'money', placeholder: '45 000,00' },
      { name: 'telephone', label: 'Téléphone *', type: 'phone', required: true, placeholder: '0000 00 00 00', maxlength: 13 },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'notes', label: 'Notes du recruteur', type: 'textarea', colSpan: true },
    ],
  },
  {
    key: 'avis', title: 'Avis du recruteur', banner: 'amber', etape: 1,
    required: ['avisDecision', 'avisDate', 'avisRecruteur', 'avisCommentaire'],
    fields: [
      { name: 'avisDecision', label: 'Décision *', type: 'select', options: optEmpty(['Favorable', 'Défavorable', 'Instance'], '— Choisir —'), required: true },
      { name: 'avisDate', label: "Date de l'avis *", type: 'date', required: true },
      { name: 'avisRecruteur', label: 'Recruteur *', type: 'text', required: true, placeholder: 'Nom du recruteur' },
      { name: 'avisCommentaire', label: 'Commentaire / motivation *', type: 'textarea', colSpan: true, required: true, placeholder: 'Justification, points forts, réserves, recommandations…' },
    ],
  },
  {
    key: 'contact', title: 'E. Coordonnées & contact d\'urgence', banner: 'blue', etape: 2,
    required: ['adresse', 'commune', 'wilaya', 'contactUrgenceLien', 'contactUrgenceNom', 'contactUrgenceTel'],
    fields: [
      { name: 'adresse', label: 'Adresse *', type: 'text', required: true },
      { name: 'commune', label: 'Commune *', type: 'text', required: true },
      { name: 'wilaya', label: 'Wilaya *', type: 'select', options: optEmpty(WILAYAS), required: true },
      { name: 'contactUrgenceLien', label: "Lien contact d'urgence *", type: 'text', required: true },
      { name: 'contactUrgenceNom', label: 'Nom contact urgence *', type: 'text', required: true },
      { name: 'contactUrgenceTel', label: 'Téléphone *', type: 'phone', required: true, placeholder: '0000 00 00 00', maxlength: 13 },
    ],
  },
  { key: 'habilitations', title: 'F. Habilitations', banner: 'amber', etape: 2, required: [], fields: [] },
  { key: 'experience', title: 'G. Expérience professionnelle', banner: 'green', etape: 2, required: [], fields: [] },
];

// Durées de contrat — format legacy (valeurs 'Nd'/'Nm').
export const DUREES_CONTRAT: { value: string; label: string }[] = [
  { value: '7d', label: '7 jours' }, { value: '15d', label: '15 jours' },
  { value: '1m', label: '1 mois' }, { value: '2m', label: '2 mois' }, { value: '3m', label: '3 mois' },
  { value: '4m', label: '4 mois' }, { value: '5m', label: '5 mois' }, { value: '6m', label: '6 mois' },
  { value: '7m', label: '7 mois' }, { value: '8m', label: '8 mois' }, { value: '9m', label: '9 mois' },
  { value: '10m', label: '10 mois' }, { value: '11m', label: '11 mois' }, { value: '12m', label: '12 mois' },
];

export const ETAPE1_KEYS = ['identification', 'militaire', 'poste', 'avis'];
export const ETAPE2_KEYS = ['contact', 'habilitations', 'experience'];
/** Ordre serveur (avec la section fantôme 'mensurations' après identification). */
export const SERVER_ORDER = ['identification', 'mensurations', 'militaire', 'poste', 'avis', 'contact', 'habilitations', 'experience'];
