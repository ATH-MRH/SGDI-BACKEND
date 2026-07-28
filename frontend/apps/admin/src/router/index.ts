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
    component: () => import('@/layouts/AppShell.vue'),
    children: [
      { path: '', name: 'home', component: () => import('@/pages/HomePage.vue') },
      { path: 'incidents', redirect: '/incidents/dashboard' },
      { path: 'incidents/dashboard', name: 'incidents-dashboard', component: () => import('@/pages/incidents/IncidentsDashboard.vue') },
      { path: 'incidents/site', name: 'incidents-site', component: () => import('@/pages/incidents/IncidentsList.vue'), props: { mode: 'site' } },
      { path: 'incidents/autres', name: 'incidents-autres', component: () => import('@/pages/incidents/IncidentsList.vue'), props: { mode: 'autres' } },
      { path: 'recrutement', name: 'recrutement', component: () => import('@/pages/recrutement/RecrutementList.vue'), props: { mode: 'new' } },
      { path: 'reserve', name: 'reserve', component: () => import('@/pages/recrutement/RecrutementList.vue'), props: { mode: 'reserve' } },
      { path: 'candidats_archives', name: 'candidats-archives', component: () => import('@/pages/recrutement/RecrutementList.vue'), props: { mode: 'archive' } },
      { path: 'recrutement/:id', name: 'candidate-fiche', component: () => import('@/pages/recrutement/CandidateFiche.vue') },
      { path: 'reserve/:id', name: 'candidate-fiche-reserve', component: () => import('@/pages/recrutement/CandidateFiche.vue') },
      { path: 'candidats_archives/:id', name: 'candidate-fiche-archive', component: () => import('@/pages/recrutement/CandidateFiche.vue') },
      { path: 'effectif', name: 'effectif', component: () => import('@/pages/effectif/EffectifList.vue'), props: { filter: 'actifs' } },
      { path: 'effectif/:filter(operationnels|conge|maladie|absents|suspension|instance_affectation|sortant|blacklist)', name: 'effectif-filter', component: () => import('@/pages/effectif/EffectifList.vue'), props: true },
      { path: 'agents', redirect: '/effectif' },
      { path: 'effectif/sortants', name: 'effectif-sortants', component: () => import('@/pages/effectif/SortantsList.vue') },
      { path: 'effectif/agent/:id', name: 'employee-fiche', component: () => import('@/pages/effectif/EmployeeFiche.vue') },
      { path: 'agents/:id', name: 'employee-fiche-agents', component: () => import('@/pages/effectif/EmployeeFiche.vue') },
      { path: 'drh/dashboard', name: 'drh-dashboard', component: () => import('@/pages/drh/DrhDashboard.vue') },
    ],
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
