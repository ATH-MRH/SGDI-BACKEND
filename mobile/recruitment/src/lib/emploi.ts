// Contrat de l'API IRON Emploi (/api/public/emploi) et conversions profil <-> formulaire.
// Aucun import React Native ici : ce module est testé tel quel par `npm test`.
import { ORIGIN, request } from './api.ts';

export type Company = { id: number; name: string; sector: string | null; city: string | null; logo_url: string | null };
export type CompanySummary = Company & { open_offers: number };
export type Offer = {
  id: number; title: string; profession: string | null; wilaya: string | null; location: string | null; contract_type: string | null;
  positions: number; deadline: string | null; published_at: string | null; company: Company;
};
export type OfferDetail = Offer & { missions: string; profile: string; description: string; reference: string | null };
export type CompanyDetail = Company & { description: string; website: string | null; offers: Offer[] };
export type Facets = { wilayas: string[]; professions: string[]; contract_types: string[]; companies: { id: number; name: string }[] };
export type OfferPage = { items: Offer[]; total: number; page: number; pages: number; facets: Facets };
export type OfferFilters = { q?: string; wilaya?: string; profession?: string; contract_type?: string; company_id?: number };
export type EmploiConfig = { version: number; sms_available: boolean; cv_max_bytes: number; cv_types: string[]; contract_types: string[]; session_ttl: number };

export type CVMeta = { name: string; mime_type: string; size: number };
export type Profile = Record<string, unknown>;
export type Account = { first_name: string; last_name: string; phone: string; profile: Profile; cv: CVMeta | null; has_photo: boolean; created_at: string | null };
export type ApplicationState = { status: string; label: string; message: string; updated_at?: string | null; convocation?: { date?: string; heure?: string; lieu?: string } };
export type Application = {
  id: number; kind: 'offer' | 'spontaneous'; position: string; submitted_at: string | null; reference: string; state: ApplicationState;
  offer: { id: number; title: string; company: Company; wilaya: string | null; contract_type: string | null; open: boolean } | null;
};
/** Dossier du candidat : ce qui vaut pour la personne, quelle que soit l'annonce (une convocation, par exemple). */
export type Dossier = { reference: string; state: ApplicationState };
export type ApplicationList = { items: Application[]; dossier: Dossier | null };
export type ApplicationReceipt = { status: string; application_id: number; reference: string; already_applied: boolean };

export function offersPath(filters: OfferFilters = {}, page = 1, pageSize = 20): string {
  const params: string[] = [];
  const add = (key: string, value: string | number | undefined) => {
    if (value !== undefined && String(value).trim()) params.push(`${key}=${encodeURIComponent(String(value).trim())}`);
  };
  add('q', filters.q); add('wilaya', filters.wilaya); add('profession', filters.profession);
  add('contract_type', filters.contract_type); add('company_id', filters.company_id);
  params.push(`page=${page}`, `page_size=${pageSize}`);
  return '/public/emploi/offers?' + params.join('&');
}

export const activeFilterCount = (filters: OfferFilters) =>
  [filters.wilaya, filters.profession, filters.contract_type, filters.company_id].filter(value => value !== undefined && value !== '').length;

export const fetchConfig = (signal?: AbortSignal) => request<EmploiConfig>('/public/emploi/config', { signal });
export const fetchOffers = (filters: OfferFilters, page: number, signal?: AbortSignal, pageSize = 20) => request<OfferPage>(offersPath(filters, page, pageSize), { signal });
export const fetchOffer = (id: number, signal?: AbortSignal) => request<OfferDetail>(`/public/emploi/offers/${id}`, { signal });
export const fetchCompany = (id: number, signal?: AbortSignal) => request<CompanyDetail>(`/public/emploi/companies/${id}`, { signal });

/** Les logos sont des fichiers de marque servis par le serveur ; rien d'autre n'est chargé. */
export const logoUri = (company: Pick<Company, 'logo_url'>) => company.logo_url && company.logo_url.startsWith('/static/') ? ORIGIN + company.logo_url : null;

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}

/** Texte saisi par le recruteur, une idée par ligne : puces affichées telles quelles, sans rien ajouter. */
export const lines = (text: string) => text.split(/\r?\n/).map(line => line.replace(/^\s*[-•*–]\s*/, '').trim()).filter(Boolean);

export function formatDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return '';
  const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

export type StateTone = 'neutral' | 'gold' | 'green' | 'red';
// Les libellés viennent du serveur ; seule la couleur est choisie ici, à partir du code d'état.
// Candidature à une annonce : received, shortlisted, interview, accepted, declined. Les autres codes sont ceux du dossier.
const STATE_TONES: Record<string, StateTone> = {
  received: 'neutral', shortlisted: 'gold', interview: 'gold', accepted: 'green', declined: 'red',
  review: 'neutral', reserve: 'neutral', invited: 'gold', interviewed: 'gold', transmitted_drh: 'green', recruited: 'green',
};
export const stateTone = (status: string): StateTone => STATE_TONES[status] || 'neutral';

/** Une candidature à une annonce a son propre état ; une candidature spontanée suit l'état du dossier. */
export const stateScope = (application: Pick<Application, 'kind'>) => application.kind === 'offer'
  ? { heading: 'État de votre candidature', note: 'Cet état ne concerne que cette annonce. Vos autres candidatures sont suivies séparément.' }
  : { heading: 'État de votre dossier', note: 'L’état est celui enregistré par le service recrutement pour votre dossier.' };

export const newRequestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;

// ── Profil <-> formulaire ────────────────────────────────────────────────────
export type FormValues = Record<string, string>;
export type Experience = Record<'society' | 'position' | 'start_date' | 'end_date' | 'departure_reason', string>;

const TEXT_KEYS = ['email', 'birth_date', 'birth_place', 'sex', 'family_status', 'blood_group', 'father_name', 'mother_name', 'nin', 'cnas_number',
  'address', 'commune', 'wilaya', 'emergency_name', 'emergency_relation', 'emergency_phone', 'desired_position', 'availability', 'source',
  'military_service', 'shirt_size'] as const;
const NUMBER_KEYS = ['children_count', 'expected_salary', 'height', 'shoe_size'] as const;
const EXPERIENCE_KEYS = ['society', 'position', 'start_date', 'end_date', 'departure_reason'] as const;

const parseNumber = (value: string | undefined) => {
  const text = (value || '').replace(/\s/g, '').replace(',', '.');
  return text ? Number(text) : null;
};

export function profileToForm(profile: Profile, identity: { first_name: string; last_name: string; phone: string }): { values: FormValues; experience: Experience[] } {
  const values: FormValues = { ...identity };
  for (const key of TEXT_KEYS) if (typeof profile[key] === 'string' && profile[key]) values[key] = profile[key] as string;
  for (const key of NUMBER_KEYS) if (typeof profile[key] === 'number' && (key !== 'children_count' || profile[key] !== 0)) values[key] = String(profile[key]);
  if (Array.isArray(profile.languages) && profile.languages.length) values.languages = profile.languages.join(', ');
  const experience = (Array.isArray(profile.experience) ? profile.experience : []).map(row => {
    const source = (row || {}) as Record<string, unknown>;
    return Object.fromEntries(EXPERIENCE_KEYS.map(key => [key, typeof source[key] === 'string' ? source[key] : ''])) as Experience;
  });
  return { values, experience };
}

export function formToProfile(values: FormValues, experience: Experience[]): Profile {
  const profile: Profile = {};
  for (const key of TEXT_KEYS) profile[key] = (values[key] || '').trim() || null;
  profile.children_count = parseNumber(values.children_count) ?? 0;
  for (const key of ['expected_salary', 'height', 'shoe_size'] as const) profile[key] = parseNumber(values[key]);
  profile.languages = (values.languages || '').split(',').map(value => value.trim()).filter(Boolean);
  profile.experience = experience
    .map(row => Object.fromEntries(EXPERIENCE_KEYS.map(key => [key, row[key].trim() || null])))
    .filter(row => Object.values(row).some(Boolean));
  return profile;
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Contrôles faits avant l'envoi ; le serveur reste l'autorité. Retourne '' si tout est correct. */
export function validateForm(values: FormValues, experience: Experience[], options: { needPosition: boolean }): string {
  if (options.needPosition && (values.desired_position || '').trim().length < 2) return 'Choisissez le poste souhaité.';
  for (const [key, label] of [['expected_salary', 'Salaire souhaité'], ['children_count', 'Nombre d’enfants'], ['height', 'Taille'], ['shoe_size', 'Pointure']] as const) {
    const number = parseNumber(values[key]);
    if (number !== null && (!Number.isFinite(number) || number < 0)) return `${label} : valeur invalide.`;
  }
  const dates = [values.birth_date, ...experience.flatMap(row => [row.start_date, row.end_date])].filter(Boolean) as string[];
  if (dates.some(value => !isDate(value))) return 'Renseignez les dates au format AAAA-MM-JJ.';
  const email = (values.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Adresse e-mail invalide.';
  return '';
}

const COMPLETENESS_KEYS = ['birth_date', 'sex', 'address', 'wilaya', 'commune', 'email', 'availability', 'emergency_phone'] as const;
/** Part réellement renseignée du profil (champs utiles au recrutement + CV), de 0 à 100. */
export function profileCompleteness(account: Pick<Account, 'profile' | 'cv'>): number {
  const filled = COMPLETENESS_KEYS.filter(key => typeof account.profile[key] === 'string' && account.profile[key]).length
    + (Array.isArray(account.profile.experience) && account.profile.experience.length ? 1 : 0) + (account.cv ? 1 : 0);
  return Math.round((filled / (COMPLETENESS_KEYS.length + 2)) * 100);
}
