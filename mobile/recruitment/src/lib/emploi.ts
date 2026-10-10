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
export type CompanyDetail = Company & { description: string; website: string | null; activities: string[]; locations: string; headcount: string; offers: Offer[] };
export type Facets = { wilayas: string[]; professions: string[]; contract_types: string[]; companies: { id: number; name: string }[] };
export type OfferPage = { items: Offer[]; total: number; page: number; pages: number; facets: Facets };
export type OfferFilters = { q?: string; wilaya?: string; profession?: string; contract_type?: string; company_id?: number };
export type EmploiConfig = { version: number; sms_available: boolean; cv_max_bytes: number; cv_types: string[]; contract_types: string[]; session_ttl: number };

export type CVMeta = { name: string; mime_type: string; size: number };
export type Profile = Record<string, unknown>;
export type Account = { first_name: string; last_name: string; phone: string; profile: Profile; cv: CVMeta | null; has_photo: boolean; created_at: string | null };
export type ApplicationState = { status: string; label: string; message: string; updated_at?: string | null; convocation?: { date?: string; heure?: string; lieu?: string } };
export type SentDocument = { label: string; name: string; mime_type: string; size: number; received_at: string | null };
export type DocumentRequest = { id: number; label: string; note: string | null; due: string | null; status: 'requested' | 'received'; received_at: string | null };
export type SharedContract = { position: string; contract_type: string; state: string; state_label: string; start_date: string | null; signed_on: string | null };
export type Application = {
  id: number; kind: 'offer' | 'spontaneous'; position: string; submitted_at: string | null; reference: string; state: ApplicationState;
  offer: { id: number; title: string; company: Company; wilaya: string | null; contract_type: string | null; open: boolean } | null;
  message: string | null; withdrawn: boolean; can_withdraw: boolean; documents: SentDocument[]; document_requests: DocumentRequest[]; contract: SharedContract | null;
};
export type ChatMessage = { id: number; sender: 'candidate' | 'recruiter'; body: string; client_id: string; created_at: string | null; read: boolean };
export type Conversation = { application_id: number; kind: 'offer' | 'spontaneous'; title: string; company: Company | null; last_message: ChatMessage | null; unread: number; submitted_at: string | null };
export type Thread = { application_id: number; title: string; company: Company | null; items: ChatMessage[] };
export type Interview = {
  id: number | null; source: 'interview' | 'dossier'; application_id: number | null; position: string; company: string | null; starts_at: string; timezone: string;
  location: string; contact: string | null; note: string | null; status: 'proposed' | 'confirmed' | 'cancelled' | 'done' | 'no_show' | 'dossier'; past: boolean;
};
export type InterviewList = { items: Interview[]; timezone: string; now: string };
export type JobAlert = { id: number; wilaya: string | null; profession: string | null; contract_type: string | null; company_id: number | null; company: string | null; active: boolean };
export type AppNotification = { id: number; kind: 'application' | 'message' | 'interview' | 'offer'; title: string; body: string; application_id: number | null; interview_id: number | null; offer_id: number | null; created_at: string | null; read: boolean };
export type Summary = { unread_messages: number; unread_notifications: number; upcoming_interviews: number };
export type PushSettings = { push: Record<'applications' | 'messages' | 'interviews' | 'offers', boolean>; push_available: boolean; devices: number };
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

export type StateTone = 'neutral' | 'gold' | 'green' | 'red' | 'blue';
// Les libellés viennent du serveur ; seule la couleur est choisie ici, à partir du code d'état.
// Candidature à une annonce : received, shortlisted, interview, accepted, declined. Les autres codes sont ceux du dossier.
const STATE_TONES: Record<string, StateTone> = {
  received: 'neutral', shortlisted: 'gold', interview: 'green', accepted: 'green', declined: 'red', withdrawn: 'neutral',
  review: 'blue', reserve: 'neutral', invited: 'gold', interviewed: 'gold', transmitted_drh: 'green', recruited: 'green',
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

/** `base` : profil enregistré ; ses rubriques gérées ailleurs que dans le formulaire (études, compétences) sont conservées. */
export function formToProfile(values: FormValues, experience: Experience[], base: Profile = {}): Profile {
  const profile: Profile = { ...base };
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
  const list = (key: string) => Array.isArray(account.profile[key]) && (account.profile[key] as unknown[]).length ? 1 : 0;
  const filled = COMPLETENESS_KEYS.filter(key => typeof account.profile[key] === 'string' && account.profile[key]).length
    + list('experience') + list('skills') + (account.cv ? 1 : 0);
  return Math.round((filled / (COMPLETENESS_KEYS.length + 3)) * 100);
}

// ── Présentation : icône de métier, étapes, calendrier ──────────────────────
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Icône d'une offre, choisie d'après son métier ou son intitulé. */
export function jobIcon(offer: { profession?: string | null; title: string }): 'shield' | 'forklift' | 'sparkles' | 'box' | 'briefcase' {
  const text = fold(`${offer.profession || ''} ${offer.title}`);
  if (/securit|gardien|surveill|rondier|prevention/.test(text)) return 'shield';
  if (/cariste|chariot|manutention/.test(text)) return 'forklift';
  if (/nettoy|entretien|proprete|hygiene/.test(text)) return 'sparkles';
  if (/logisti|magasin|stock|livr|chauffeur/.test(text)) return 'box';
  return 'briefcase';
}

export type StepState = 'done' | 'current' | 'todo' | 'past' | 'failed';
export type Step = { label: string; state: StepState };
/**
 * Progression d'une candidature à une annonce. Une candidature non retenue ou retirée n'est jamais
 * dessinée comme une progression réussie : ses étapes passées sont neutres et la dernière est en échec.
 */
export function applicationSteps(status: string): Step[] {
  const labels = ['Reçue', 'En examen', 'Entretien', 'Décision'];
  if (status === 'declined' || status === 'withdrawn') {
    return labels.map((label, index) => ({ label: index === 3 ? (status === 'declined' ? 'Non retenue' : 'Retirée') : label, state: index === 3 ? 'failed' : 'past' }));
  }
  const reached = { received: 0, review: 1, shortlisted: 1, interview: 2, accepted: 3 }[status] ?? 0;
  return labels.map((label, index) => ({
    label: index === 3 && status === 'accepted' ? 'Retenue' : index === 1 && status === 'shortlisted' ? 'Présélection' : label,
    state: status === 'accepted' || index < reached || (index === reached && status !== 'review' && status !== 'interview') ? 'done' : index === reached ? 'current' : 'todo',
  }));
}

const CLOSED_STATES = new Set(['accepted', 'declined', 'withdrawn', 'recruited']);
export const isClosed = (application: Pick<Application, 'state'>) => CLOSED_STATES.has(application.state.status);

/** Semaines d'un mois, du lundi au dimanche ; `null` hors du mois. */
export function calendarMonth(year: number, month: number): (number | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)), days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = Array.from({ length: (first.getUTCDay() + 6) % 7 }, () => null);
  for (let day = 1; day <= days; day++) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}
export const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** Jours du mois portant un entretien non annulé (dates réelles renvoyées par le serveur). */
export function interviewDays(items: Pick<Interview, 'starts_at' | 'status'>[], year: number, month: number): Set<number> {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return new Set(items.filter(item => item.status !== 'cancelled' && item.starts_at.startsWith(prefix)).map(item => Number(item.starts_at.slice(8, 10))));
}

/** « Mardi 13 octobre 2026 · 10 h 00 », sans conversion de fuseau : l'heure est celle d'Alger, donnée par le serveur. */
export function formatDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return formatDate(value);
  const [, year, month, day, hour, minute] = match;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  return `${weekday} ${Number(day)} ${MONTHS[Number(month) - 1].toLowerCase()} ${year} · ${Number(hour)} h ${minute}`;
}
export const formatTime = (value: string | null) => /T(\d{2}):(\d{2})/.exec(value || '')?.slice(1).join(':') || '';

export function splitInterviews(items: Interview[]): { upcoming: Interview[]; past: Interview[] } {
  const closed = (item: Interview) => item.past || item.status === 'cancelled' || item.status === 'done' || item.status === 'no_show';
  return { upcoming: items.filter(item => !closed(item)), past: items.filter(closed).reverse() };
}

export const alertLabel = (alert: Pick<JobAlert, 'profession' | 'wilaya' | 'contract_type' | 'company'>) =>
  [alert.profession, alert.wilaya, alert.contract_type, alert.company].filter(Boolean).join(' · ') || 'Toutes les offres';

/** Écran ouvert par une notification. */
export function notificationTarget(item: Pick<AppNotification, 'kind' | 'application_id' | 'offer_id'>): { pathname: string; params?: Record<string, string> } {
  if (item.kind === 'message' && item.application_id) return { pathname: '/messages/[id]', params: { id: String(item.application_id) } };
  if (item.kind === 'interview') return { pathname: '/applications/interviews' };
  if (item.kind === 'offer' && item.offer_id) return { pathname: '/offers/[id]', params: { id: String(item.offer_id) } };
  if (item.application_id) return { pathname: '/applications/[id]', params: { id: String(item.application_id) } };
  return { pathname: '/applications' };
}

export type TipSection = { heading: string; points: string[] };
/** Texte d'un conseil saisi par le recrutement : une ligne seule ouvre une partie, « - » introduit une idée. */
export function parseTipBody(body: string): TipSection[] {
  const sections: TipSection[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const point = /^[-•*–]\s*(.+)$/.exec(line);
    if (point && sections.length) sections[sections.length - 1].points.push(point[1]);
    else if (point) sections.push({ heading: '', points: [point[1]] });
    else sections.push({ heading: line, points: [] });
  }
  return sections;
}

export const fileSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

/** Heure d'Alger (UTC+1, sans heure d'été) d'un horodatage serveur exprimé en UTC : « 10:14 », précédé du jour s'il n'est pas `today`. */
export function messageTime(utc: string | null, today?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(utc || '');
  if (!match) return '';
  const local = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) + 1, Number(match[5]))).toISOString();
  const clock = local.slice(11, 16);
  return today && local.slice(0, 10) === today ? clock : `${formatDate(local).replace(/ \d{4}$/, '')} · ${clock}`;
}
