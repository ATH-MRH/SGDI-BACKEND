/** Endpoints d'authentification — miroir de app/modules/auth/routes.py. */
import type { ApiClient } from './client';
import type { LoginCredentials, TokenResponse, User } from '../types';

export function createAuthApi(client: ApiClient) {
  return {
    /** POST /api/auth/login → { access_token, user }. */
    login(credentials: LoginCredentials): Promise<TokenResponse> {
      return client.post<TokenResponse>('/auth/login', credentials);
    },
    /** GET /api/auth/me → utilisateur courant (Bearer requis). */
    me(): Promise<User> {
      return client.get<User>('/auth/me');
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
