<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const router = useRouter();

async function logout(): Promise<void> {
  session.logout();
  await router.replace({ name: 'login' });
}
</script>

<template>
  <div class="home">
    <header class="home__bar">
      <div class="home__brand">SGDI · ATLAS <span class="home__tag">v2</span></div>
      <div class="home__user">
        <span>{{ session.user?.full_name }}</span>
        <span class="home__level">{{ session.user?.access_level ?? '—' }}</span>
        <button class="sg-btn home__logout" @click="logout">Déconnexion</button>
      </div>
    </header>

    <main class="home__main">
      <section class="sg-card home__panel">
        <h1>Fondation opérationnelle ✓</h1>
        <p class="home__muted">
          Squelette Phase 0 : Vue 3 + Vite + Pinia + Router, client API typé, authentification
          serveur réelle. L'ancien front reste servi à la racine comme repère de parité.
        </p>
        <dl class="home__facts">
          <div><dt>Rôle</dt><dd>{{ session.user?.role }}</dd></div>
          <div><dt>Niveau</dt><dd>{{ session.user?.access_level ?? '—' }}</dd></div>
          <div>
            <dt>Sociétés</dt>
            <dd>{{ session.societies.length ? session.societies.join(', ') : 'Toutes (non cloisonné)' }}</dd>
          </div>
          <div><dt>Non restreint</dt><dd>{{ session.isUnrestricted ? 'oui' : 'non' }}</dd></div>
        </dl>
      </section>
    </main>
  </div>
</template>

<style scoped>
.home { min-height: 100%; display: flex; flex-direction: column; }
.home__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sg-space-3) var(--sg-space-6);
  background: var(--sg-surface);
  border-bottom: 1px solid var(--sg-border);
}
.home__brand { font-weight: 800; color: var(--sg-brand-600); }
.home__tag {
  font-size: var(--sg-fs-sm);
  color: #fff;
  background: var(--sg-brand-500);
  padding: 1px 8px;
  border-radius: 999px;
  margin-left: var(--sg-space-2);
}
.home__user { display: flex; align-items: center; gap: var(--sg-space-3); }
.home__level {
  font-size: var(--sg-fs-sm);
  color: var(--sg-text-muted);
  border: 1px solid var(--sg-border);
  border-radius: 999px;
  padding: 1px 8px;
}
.home__logout { background: var(--sg-text-muted); padding: 6px 12px; }
.home__logout:hover { background: var(--sg-danger); }
.home__main { padding: var(--sg-space-8); display: grid; place-items: start center; }
.home__panel { max-width: 640px; padding: var(--sg-space-8); }
.home__panel h1 { margin-top: 0; font-size: var(--sg-fs-xl); }
.home__muted { color: var(--sg-text-muted); }
.home__facts {
  margin: var(--sg-space-6) 0 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--sg-space-4);
}
.home__facts dt { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); }
.home__facts dd { margin: 2px 0 0; font-weight: 600; }
</style>
