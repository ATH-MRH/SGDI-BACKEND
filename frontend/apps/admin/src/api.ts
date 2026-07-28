/**
 * Instance API de l'app admin. Le jeton est stocké en localStorage (source de vérité),
 * lu par le client à chaque requête ; un 401 nettoie le jeton et renvoie au login.
 */
import { ApiClient, createAuthApi, createReferenceApi, createIncidentsApi, createCandidatesApi, createEmployeesApi } from '@sgdi/shared';

const TOKEN_KEY = 'sgdi_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export const apiClient = new ApiClient({
  baseUrl: '/api',
  getToken: getStoredToken,
  onUnauthorized: () => {
    setStoredToken(null);
    if (!location.hash.startsWith('#/login')) location.hash = '#/login';
  },
});

export const authApi = createAuthApi(apiClient);
export const referenceApi = createReferenceApi(apiClient);
export const incidentsApi = createIncidentsApi(apiClient);
export const candidatesApi = createCandidatesApi(apiClient);
export const employeesApi = createEmployeesApi(apiClient);
