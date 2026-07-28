<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { DrhDashboard } from '@sgdi/shared';
import { drhApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import { formatFR } from '@/utils/incidents';

const router = useRouter();
const session = useSessionStore();
const data = ref<DrhDashboard | null>(null);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    data.value = await drhApi.dashboard({ society: session.activeSociety ?? undefined });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally { loading.value = false; }
}
onMounted(load);

const byStatus = computed(() => data.value?.employees_by_status ?? {});
const actifs = computed(() => byStatus.value['actif'] ?? 0);
const total = computed(() => data.value?.employees_total ?? 0);
const tauxActifs = computed(() => (total.value ? Math.round((actifs.value / total.value) * 100) : 0));

// Fins d'essai à ≤90 jours.
function daysTo(d: string | null): number | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  return Math.round((new Date(d).getTime() - Date.now()) / 86400000);
}
const trialSoon = computed(() =>
  (data.value?.trial_periods ?? [])
    .map((t) => ({ ...t, days: daysTo(t.trial_end_date) }))
    .filter((t) => t.days != null && t.days <= 90)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0)),
);

const KPI: { key: string; label: string; color: string }[] = [
  { key: 'actif', label: 'Actifs', color: '#16a34a' },
  { key: 'conge', label: 'En congé', color: '#0360a8' },
  { key: 'maladie', label: 'Maladie', color: '#f97316' },
  { key: 'suspendu', label: 'Suspendus', color: '#7c3aed' },
  { key: 'sortant', label: 'Sortants', color: '#475569' },
];
</script>

<template>
  <div>
    <div class="sg-page-head">
      <h1 class="sg-page-title">Tableau de bord DRH</h1>
      <p class="sg-page-sub">Ressources humaines · {{ session.activeSociety ?? 'Toutes les sociétés' }}</p>
    </div>
    <p v-if="error" class="sg-alert">{{ error }}</p>
    <p v-if="loading" class="sg-page-sub">Chargement…</p>

    <template v-else-if="data">
      <div class="dr-kpis">
        <div class="dr-kpi dr-kpi--total"><span class="dr-num">{{ total }}</span><span class="dr-lbl">Effectif total</span></div>
        <div v-for="k in KPI" :key="k.key" class="dr-kpi" :style="{ borderTopColor: k.color }">
          <span class="dr-num" :style="{ color: k.color }">{{ byStatus[k.key] ?? 0 }}</span>
          <span class="dr-lbl">{{ k.label }}</span>
        </div>
        <div class="dr-kpi" style="border-top-color:#dc2626">
          <span class="dr-num" style="color:#dc2626">{{ data.leaves_pending }}</span><span class="dr-lbl">Congés en attente</span>
        </div>
      </div>

      <div class="sg-card dr-ratio">
        <div class="dr-ratio__head"><span>Taux d'actifs</span><strong>{{ tauxActifs }}%</strong></div>
        <div class="dr-bar"><div class="dr-bar__fill" :style="{ width: tauxActifs + '%' }"></div></div>
      </div>

      <div class="sg-card dr-section">
        <h3 class="dr-h3">Fins de période d'essai (≤ 90 jours) — {{ trialSoon.length }}</h3>
        <div v-if="!trialSoon.length" class="dr-empty">Aucune fin d'essai proche.</div>
        <table v-else class="ef-table">
          <thead><tr><th>Code</th><th>Employé</th><th>Fin d'essai</th><th>Délai</th></tr></thead>
          <tbody>
            <tr v-for="t in trialSoon" :key="t.id" class="ef-row" @click="router.push(`/effectif/agent/${t.id}`)">
              <td class="ef-mono">{{ t.code }}</td><td>{{ t.name }}</td>
              <td>{{ t.trial_end_date ? formatFR(t.trial_end_date.slice(0, 10)) : '—' }}</td>
              <td><span class="sg-pill" :class="(t.days ?? 0) <= 30 ? 'sg-pill--red' : 'sg-pill--amber'">J-{{ t.days }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dr-kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sg-space-3); margin-bottom: var(--sg-space-4); }
@media (min-width: 700px) { .dr-kpis { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 1100px) { .dr-kpis { grid-template-columns: repeat(7, 1fr); } }
.dr-kpi { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: var(--sg-space-4) var(--sg-space-3); background: var(--sg-surface); border: 1px solid var(--sg-border); border-top: 3px solid var(--sg-border); border-radius: var(--sg-radius); }
.dr-kpi--total { border-top-color: var(--sg-brand-600); }
.dr-num { font-size: 28px; font-weight: 900; line-height: 1; }
.dr-lbl { font-size: 11px; text-transform: uppercase; color: var(--sg-text-muted); font-weight: 700; text-align: center; }
.dr-ratio { padding: var(--sg-space-4); margin-bottom: var(--sg-space-4); }
.dr-ratio__head { display: flex; justify-content: space-between; margin-bottom: var(--sg-space-2); font-size: var(--sg-fs-sm); }
.dr-bar { height: 10px; background: var(--sg-surface-2); border-radius: 999px; overflow: hidden; }
.dr-bar__fill { height: 100%; background: #16a34a; }
.dr-section { padding: var(--sg-space-4); }
.dr-h3 { font-size: var(--sg-fs-sm); text-transform: uppercase; color: var(--sg-brand-700); font-weight: 800; margin: 0 0 var(--sg-space-3); }
.dr-empty { text-align: center; color: var(--sg-text-muted); padding: var(--sg-space-5); }
.ef-table { width: 100%; border-collapse: collapse; font-size: var(--sg-fs-sm); }
.ef-table th { text-align: left; padding: 8px 10px; color: var(--sg-text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--sg-border); }
.ef-table td { padding: 8px 10px; border-bottom: 1px solid var(--sg-border); }
.ef-row { cursor: pointer; } .ef-row:hover { background: var(--sg-surface-2); }
.ef-mono { font-family: ui-monospace, Menlo, Consolas, monospace; color: #b45309; }
</style>
