/** Routing en mode HASH (#/...) pour conserver les URLs de l'ancien front (parité). */
import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { useSessionStore } from '@/stores/session';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { public: true },
  },
  {
    path: '/select-societe',
    name: 'select-societe',
    component: () => import('@/pages/SelectSocietyPage.vue'),
  },
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/HomePage.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHashHistory('/v2/'),
  routes,
});

// Garde de route : redirige vers /login si non authentifié ; évite /login si déjà connecté.
router.beforeEach((to) => {
  const session = useSessionStore();
  if (!to.meta.public && !session.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' && session.isAuthenticated) {
    return { name: 'home' };
  }
  // Cloisonné à plusieurs sociétés sans société active -> écran de sélection obligatoire.
  if (session.mustSelectSociety && to.name !== 'select-societe') {
    return { name: 'select-societe', query: { redirect: to.fullPath } };
  }
  return true;
});
