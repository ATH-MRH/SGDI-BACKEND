<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const router = useRouter();
</script>

<template>
  <div>
    <div class="sg-page-head">
      <div>
        <h1 class="sg-page-title">Accueil</h1>
        <p class="sg-page-sub">Espace d'administration ATLAS — préversion v2.</p>
      </div>
    </div>

    <section class="sg-card home__panel">
      <h2>Modules disponibles</h2>
      <div class="home__mods">
        <button class="home__mod" @click="router.push('/incidents/dashboard')">
          <span class="home__mod-label">Main courante</span>
          <span class="home__mod-desc">Incidents, évènements, alertes, clôtures</span>
        </button>
      </div>

      <h2 class="home__h2">Session</h2>
      <dl class="home__facts">
        <div><dt>Utilisateur</dt><dd>{{ session.user?.full_name }}</dd></div>
        <div><dt>Rôle</dt><dd>{{ session.user?.role }}</dd></div>
        <div><dt>Niveau</dt><dd>{{ session.user?.access_level ?? '—' }}</dd></div>
        <div><dt>Société active</dt><dd>{{ session.activeSociety ?? 'Toutes' }}</dd></div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.home__panel { padding: var(--sg-space-8); max-width: 820px; }
.home__panel h2 { margin: 0 0 var(--sg-space-4); font-size: var(--sg-fs-lg); }
.home__h2 { margin-top: var(--sg-space-8) !important; }
.home__mods { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--sg-space-3); }
.home__mod {
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
  padding: var(--sg-space-4); text-align: left; cursor: pointer;
  background: var(--sg-surface-2); border: 1px solid var(--sg-border); border-radius: var(--sg-radius);
}
.home__mod:hover { border-color: var(--sg-brand-500); background: var(--sg-brand-50); }
.home__mod-ico { font-size: 1.4rem; }
.home__mod-label { font-weight: 800; color: var(--sg-brand-700); }
.home__mod-desc { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); }
.home__facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--sg-space-4); margin: 0; }
.home__facts dt { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); }
.home__facts dd { margin: 2px 0 0; font-weight: 600; }
</style>
