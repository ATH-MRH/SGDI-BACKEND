/** Contrats du backend ATLAS consommés par le mobile (app/modules/auth/schemas.py). */

export type ApiUser = {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  access_level: string | null;
  is_active: boolean;
  authorized_societies: string[] | null;
  authorized_sites: number[] | null;
  global_society_access: boolean;
  authorized_structures: string[] | null;
  authorized_actions: string[] | null;
  authorized_modules: string[] | null;
  supervisor_read_only: boolean;
  /** Calculés par GET /api/auth/me uniquement (absents de la réponse de login). */
  effective_modules: string[] | null;
  module_access_global: boolean;
  recruitment_access?: boolean;
};

/** Site du périmètre de l'utilisateur, tel que renvoyé par les listes de sites du backend. */
export type ScopeSite = {
  id: number;
  /** null quand aucune liste de sites n'est accessible à ce profil (identifiant seul connu). */
  name: string | null;
  society: string | null;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: ApiUser;
};

/** Réponse de /api/auth/mobile/login et /api/auth/refresh. */
export type SessionResponse = LoginResponse & {
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
};

/** Enveloppe de pagination de app/core/pagination.py. */
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
};
