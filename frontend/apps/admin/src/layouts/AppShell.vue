<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, RouterLink, useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const router = useRouter();

const canSwitchSociety = computed(() => session.societies.length > 1 || session.isUnrestricted);
const activeSocietyLabel = computed(() => session.activeSociety ?? 'Toutes les sociétés');

const nav = [
  { label: 'Accueil', to: '/', icon: '⌂' },
  { label: 'Main courante', to: '/incidents/dashboard', icon: '⚑', match: '/incidents' },
  { label: 'Recrutement', to: '/recrutement', icon: '👤', match: '/recrutement' },
];

async function logout(): Promise<void> {
  session.logout();
  await router.replace({ name: 'login' });
}
</script>

<template>
  <div class="shell">
    <aside class="shell__side">
      <div class="shell__brand">SGDI<span>·ATLAS</span></div>
      <nav class="shell__nav">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="shell__link"
          :class="{ 'shell__link--active': $route.path.startsWith(item.match ?? item.to) && (item.match || $route.path === item.to) }"
        >
          <span class="shell__ico">{{ item.icon }}</span>{{ item.label }}
        </RouterLink>
      </nav>
      <div class="shell__side-foot">v2 · préversion</div>
    </aside>

    <div class="shell__main">
      <header class="shell__top">
        <div class="shell__spacer"></div>
        <div class="shell__user">
          <button v-if="canSwitchSociety" class="shell__society" type="button" @click="router.push({ name: 'select-societe', query: { redirect: $route.fullPath } })">
            {{ activeSocietyLabel }} <span class="shell__caret">▾</span>
          </button>
          <span v-else class="shell__society shell__society--static">{{ activeSocietyLabel }}</span>
          <span class="shell__name">{{ session.user?.full_name }}</span>
          <span class="shell__level">{{ session.user?.access_level ?? '—' }}</span>
          <button class="sg-btn sg-btn-sm sg-btn-ghost" @click="logout">Déconnexion</button>
        </div>
      </header>
      <main class="shell__content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100%; }
.shell__side {
  background: var(--sg-brand-strong);
  color: #dbe7f5;
  display: flex;
  flex-direction: column;
  padding: var(--sg-space-4) var(--sg-space-3);
}
.shell__brand { font-weight: 900; font-size: var(--sg-fs-lg); letter-spacing: 0.5px; color: #fff; padding: 6px 10px var(--sg-space-4); }
.shell__brand span { color: #8fb3d9; font-weight: 700; }
.shell__nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.shell__link {
  display: flex;
  align-items: center;
  gap: var(--sg-space-2);
  padding: 10px 12px;
  border-radius: var(--sg-radius-sm);
  color: #cfe0f2;
  text-decoration: none;
  font-weight: 600;
  font-size: var(--sg-fs-sm);
}
.shell__link:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.shell__link--active { background: rgba(255, 255, 255, 0.14); color: #fff; }
.shell__ico { width: 18px; text-align: center; opacity: 0.9; }
.shell__side-foot { font-size: 11px; color: #6f92b8; padding: var(--sg-space-3) 10px 0; }

.shell__main { display: flex; flex-direction: column; min-width: 0; }
.shell__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sg-space-3) var(--sg-space-6);
  background: var(--sg-surface);
  border-bottom: 1px solid var(--sg-border);
}
.shell__spacer { flex: 1; }
.shell__user { display: flex; align-items: center; gap: var(--sg-space-3); }
.shell__society {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; font: inherit; font-weight: 700; font-size: var(--sg-fs-sm);
  color: var(--sg-brand-700); background: var(--sg-brand-soft);
  border: 1px solid var(--sg-border); border-radius: 999px; cursor: pointer;
}
.shell__society--static { cursor: default; color: var(--sg-text-muted); }
.shell__caret { color: var(--sg-text-muted); }
.shell__name { font-weight: 600; font-size: var(--sg-fs-sm); }
.shell__level {
  font-size: var(--sg-fs-sm); color: var(--sg-text-muted);
  border: 1px solid var(--sg-border); border-radius: 999px; padding: 1px 8px;
}
.shell__content { padding: var(--sg-space-6); flex: 1; }

@media (max-width: 720px) {
  .shell { grid-template-columns: 1fr; }
  .shell__side { flex-direction: row; align-items: center; overflow-x: auto; }
  .shell__nav { flex-direction: row; flex: 1; }
  .shell__side-foot { display: none; }
}
</style>
