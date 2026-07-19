/** Store de session : jeton, utilisateur, société active, permissions dérivées. */
import { defineStore } from 'pinia';
import type { User } from '@sgdi/shared';
import { authApi, getStoredToken, setStoredToken } from '@/api';

interface SessionState {
  user: User | null;
  token: string | null;
  activeSociety: string | null;
  loading: boolean;
  error: string;
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    user: null,
    token: getStoredToken(),
    activeSociety: null,
    loading: false,
    error: '',
  }),

  getters: {
    isAuthenticated: (state): boolean => Boolean(state.token),
    /** Sociétés autorisées (vide = accès à toutes, convention backend). */
    societies: (state): string[] => state.user?.authorized_societies ?? [],
    isUnrestricted: (state): boolean => {
      const role = (state.user?.role ?? '').toUpperCase();
      const level = (state.user?.access_level ?? '').toUpperCase();
      return ['ADMIN', 'ADM', 'ADM1', 'ADM2'].includes(role) || level === 'H5';
    },
  },

  actions: {
    async login(username: string, password: string): Promise<boolean> {
      this.loading = true;
      this.error = '';
      try {
        const res = await authApi.login({ username, password });
        this.token = res.access_token;
        this.user = res.user;
        setStoredToken(res.access_token);
        const socs = res.user.authorized_societies ?? [];
        this.activeSociety = socs.length === 1 ? socs[0] : null;
        return true;
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'Échec de la connexion';
        return false;
      } finally {
        this.loading = false;
      }
    },

    /** Réhydrate l'utilisateur depuis un jeton persisté (rechargement de page). */
    async restore(): Promise<void> {
      if (!this.token) return;
      try {
        this.user = await authApi.me();
      } catch {
        this.logout();
      }
    },

    logout(): void {
      this.token = null;
      this.user = null;
      this.activeSociety = null;
      setStoredToken(null);
    },
  },
});
