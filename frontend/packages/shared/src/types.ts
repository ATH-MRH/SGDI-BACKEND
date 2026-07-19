/**
 * Types partagés, alignés sur les schémas backend (app/modules/auth/schemas.py).
 * Source de vérité = le backend ; on reflète fidèlement UserOut / TokenOut.
 */

/** Niveaux d'accès H1–H5 (voir app/core/authz.py). */
export type AccessLevel = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | (string & {});

/** Utilisateur authentifié — miroir de `UserOut` (auth/schemas.py). */
export interface User {
  id: number;
  username: string;
  email: string | null;
  full_name: string;
  role: string;
  access_level: AccessLevel | null;
  authorized_societies: string[];
  authorized_structures: string[];
  authorized_sites: number[];
  is_active: boolean;
}

/** Réponse de /api/auth/login et /api/auth/admin-system-login — miroir de `TokenOut`. */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface LoginCredentials {
  username: string;
  password: string;
}
