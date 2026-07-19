/** Store de session : jeton, utilisateur, société active, permissions dérivées. */
import { defineStore } from 'pinia';
import type { User } from '@sgdi/shared';
import { authApi, referenceApi, getStoredToken, setStoredToken } from '@/api';

const ACTIVE_SOCIETY_KEY = 'sgdi_active_society';

interface SessionState {
  user: User | null;
  token: string | null;
  activeSociety: string | null;
  availableSocieties: string[];
  loading: boolean;
  error: string;
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    user: null,
    token: getStoredToken(),
    activeSociety: localStorage.getItem(ACTIVE_SOCIETY_KEY),
    availableSocieties: [],
    loading: false,
    error: '',
  }),

  getters: {
    isAuthenticated: (state): boolean => Boolean(state.token),
    /** Sociétés autorisées de l'utilisateur (vide = accès à toutes, convention backend). */
    societies: (state): string[] => state.user?.authorized_societies ?? [],
    isUnrestricted: (state): boolean => {
      const role = (state.user?.role ?? '').toUpperCase();
      const level = (state.user?.access_level ?? '').toUpperCase();
      return ['ADMIN', 'ADM', 'ADM1', 'ADM2'].includes(role) || level === 'H5';
    },
    /**
     * Un utilisateur CLOISONNÉ à plusieurs sociétés DOIT en choisir une active.
     * Un non-cloisonné (aucune société listée) reste sur « Toutes » par défaut (non forcé).
     */
    mustSelectSociety(state): boolean {
      return Boolean(state.token) && (state.user?.authorized_societies?.length ?? 0) > 1 && !state.activeSociety;
    },
  },

  actions: {
    setActiveSociety(society: string | null): void {
      this.activeSociety = society;
      if (society) localStorage.setItem(ACTIVE_SOCIETY_KEY, society);
      else localStorage.removeItem(ACTIVE_SOCIETY_KEY);
    },

    async login(username: string, password: string): Promise<boolean> {
      this.loading = true;
      this.error = '';
      try {
        const res = await authApi.login({ username, password });
        this.token = res.access_token;
        this.user = res.user;
        setStoredToken(res.access_token);
        // Société unique -> sélection automatique ; sinon on laisse l'écran de choix décider.
        const socs = res.user.authorized_societies ?? [];
        this.setActiveSociety(socs.length === 1 ? socs[0] : this.activeSociety);
        return true;
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'Échec de la connexion';
        return false;
      } finally {
        this.loading = false;
      }
    },

    /** Sociétés sélectionnables : les autorisées si cloisonné, sinon le référentiel complet. */
    async loadSocieties(): Promise<void> {
      if (this.societies.length) {
        this.availableSocieties = this.societies;
        return;
      }
      this.availableSocieties = await referenceApi.societes();
    },

    /** Réhydrate l'utilisateur depuis un jeton persisté (rechargement de page). */
    async restore(): Promise<void> {
      if (!this.token) return;
      try {
        this.user = await authApi.me();
        const socs = this.user.authorized_societies ?? [];
        // Purge une société active devenue non autorisée (droits modifiés côté serveur).
        if (this.activeSociety && socs.length && !socs.includes(this.activeSociety)) {
          this.setActiveSociety(socs.length === 1 ? socs[0] : null);
        }
      } catch {
        this.logout();
      }
    },

    logout(): void {
      this.token = null;
      this.user = null;
      this.availableSocieties = [];
      this.setActiveSociety(null);
      setStoredToken(null);
    },
  },
});
