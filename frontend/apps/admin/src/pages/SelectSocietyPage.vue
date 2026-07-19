<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    await session.loadSocieties();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Chargement des sociétés impossible';
  } finally {
    loading.value = false;
  }
});

async function choose(society: string | null): Promise<void> {
  session.setActiveSociety(society);
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  await router.replace(redirect);
}
</script>

<template>
  <div class="select">
    <div class="sg-card select__card">
      <div class="select__brand">SGDI · ATLAS</div>
      <h1 class="select__title">Choisir une société</h1>
      <p class="select__subtitle">Votre activité sera cloisonnée à la société sélectionnée.</p>

      <p v-if="loading" class="select__muted">Chargement…</p>
      <p v-else-if="error" class="sg-alert">{{ error }}</p>

      <ul v-else class="select__list">
        <li v-for="soc in session.availableSocieties" :key="soc">
          <button class="select__item" @click="choose(soc)">
            <span>{{ soc }}</span>
            <span class="select__chevron">›</span>
          </button>
        </li>
        <li v-if="session.isUnrestricted">
          <button class="select__item select__item--all" @click="choose(null)">
            <span>Toutes les sociétés</span>
            <span class="select__chevron">›</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.select { min-height: 100%; display: grid; place-items: center; padding: var(--sg-space-4); }
.select__card { width: 100%; max-width: 440px; padding: var(--sg-space-8); }
.select__brand { font-size: var(--sg-fs-lg); font-weight: 800; color: var(--sg-brand-600); }
.select__title { margin: var(--sg-space-4) 0 var(--sg-space-1); font-size: var(--sg-fs-xl); }
.select__subtitle { margin: 0 0 var(--sg-space-6); color: var(--sg-text-muted); font-size: var(--sg-fs-sm); }
.select__muted { color: var(--sg-text-muted); }
.select__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sg-space-2); }
.select__item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  font: inherit;
  font-weight: 600;
  color: var(--sg-text);
  text-align: left;
  background: var(--sg-surface-2);
  border: 1px solid var(--sg-border);
  border-radius: var(--sg-radius);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.select__item:hover { border-color: var(--sg-brand-500); background: var(--sg-brand-50); }
.select__item--all { color: var(--sg-brand-600); }
.select__chevron { font-size: var(--sg-fs-lg); color: var(--sg-text-muted); }
</style>
