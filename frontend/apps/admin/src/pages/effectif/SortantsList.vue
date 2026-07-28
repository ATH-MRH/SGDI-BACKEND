<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Employee } from '@sgdi/shared';
import { employeesApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import { fullName, matricule, societe, matchesFilter } from '@/utils/employees';
import { getLegacy } from '@/utils/employeeFiche';
import { formatFR } from '@/utils/incidents';

const router = useRouter();
const session = useSessionStore();
const all = ref<Employee[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    all.value = await employeesApi.list({ society: session.activeSociety ?? undefined });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally { loading.value = false; }
}
onMounted(load);

const rows = computed(() => all.value.filter((e) => matchesFilter(e, 'sortant')));
function dateSortie(e: Employee): string {
  const l = getLegacy(e);
  const d = String(l.dateSortie ?? l.dateFinContrat ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? formatFR(d.slice(0, 10)) : (d || '—');
}
function openFiche(e: Employee): void { router.push(`/effectif/agent/${e.id}`); }
</script>

<template>
  <div>
    <div class="sg-page-head">
      <h1 class="sg-page-title">ÉLÉMENTS SORTANTS</h1>
      <p class="sg-page-sub">Employés sortants · {{ session.activeSociety ?? 'Toutes les sociétés' }}</p>
    </div>
    <p v-if="error" class="sg-alert">{{ error }}</p>
    <p v-if="loading" class="sg-page-sub">Chargement…</p>
    <div v-else-if="!rows.length" class="sg-card ef-empty">Aucun employé SORTANT.</div>
    <div v-else class="sg-card ef-tablewrap">
      <table class="ef-table">
        <thead><tr><th>Employé</th><th>Société</th><th>Date sortie</th><th></th></tr></thead>
        <tbody>
          <tr v-for="e in rows" :key="e.id" class="ef-row" @click="openFiche(e)">
            <td><strong>{{ fullName(e) }}</strong> <span class="ef-mono">{{ matricule(e) }}</span></td>
            <td>{{ societe(e) || '—' }}</td>
            <td>{{ dateSortie(e) }}</td>
            <td @click.stop><button class="sg-btn sg-btn-ghost sg-btn-sm" @click="openFiche(e)">Ouvrir →</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.ef-empty { padding: var(--sg-space-8); text-align: center; color: var(--sg-text-muted); }
.ef-tablewrap { overflow-x: auto; }
.ef-table { width: 100%; border-collapse: collapse; font-size: var(--sg-fs-sm); }
.ef-table th { text-align: left; padding: 10px 12px; color: var(--sg-text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--sg-border); }
.ef-table td { padding: 10px 12px; border-bottom: 1px solid var(--sg-border); }
.ef-row { cursor: pointer; }
.ef-row:hover { background: var(--sg-surface-2); }
.ef-mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; color: #b45309; }
</style>
