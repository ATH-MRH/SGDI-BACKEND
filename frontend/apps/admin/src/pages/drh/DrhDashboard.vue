<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { DrhDashboard, Employee } from '@sgdi/shared';
import { drhApi, employeesApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import { fullName } from '@/utils/employees';
import { formatFR } from '@/utils/incidents';

const router = useRouter();
const session = useSessionStore();
const data = ref<DrhDashboard | null>(null);
const employees = ref<Employee[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    const soc = session.activeSociety ?? undefined;
    const [d, emps] = await Promise.all([
      drhApi.dashboard({ society: soc }),
      employeesApi.list({ society: soc }),
    ]);
    data.value = d;
    employees.value = emps;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally { loading.value = false; }
}
onMounted(load);

const byStatus = computed(() => data.value?.employees_by_status ?? {});
const byCand = computed(() => data.value?.candidates_by_status ?? {});
const total = computed(() => data.value?.employees_total ?? 0);

function ratio(key: string): number {
  return total.value ? Math.round(((byStatus.value[key] ?? 0) / total.value) * 100) : 0;
}

function daysTo(d: string | null | undefined): number | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  return Math.round((new Date(d.slice(0, 10)).getTime() - Date.now()) / 86400000);
}

// Fins de période d'essai à ≤90 jours (bonus).
const trialSoon = computed(() =>
  (data.value?.trial_periods ?? [])
    .map((t) => ({ ...t, days: daysTo(t.trial_end_date) }))
    .filter((t) => t.days != null && t.days <= 90)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0)),
);

// Alerte fin de contrat : expirés (<0) + fins ≤90j, trié par échéance.
const contratAlertes = computed(() =>
  employees.value
    .map((e) => ({ e, days: daysTo(e.contract_end_date) }))
    .filter((x) => x.days != null && x.days <= 90)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0)),
);
const contratsExpires = computed(() => contratAlertes.value.filter((x) => (x.days ?? 0) < 0).length);
const contratsFin90 = computed(() => contratAlertes.value.filter((x) => (x.days ?? 0) >= 0).length);

const KPI: { key: string; label: string; color: string }[] = [
  { key: 'actif', label: 'Actifs', color: '#16a34a' },
  { key: 'conge', label: 'En congé', color: '#0360a8' },
  { key: 'maladie', label: 'Maladie', color: '#f97316' },
  { key: 'absent', label: 'Absents', color: '#dc2626' },
  { key: 'suspendu', label: 'Suspendus', color: '#7c3aed' },
  { key: 'sortant', label: 'Sortants', color: '#475569' },
];
const CAND_KPI: { key: string; label: string; color: string }[] = [
  { key: 'nouvelle', label: 'Candidats', color: '#4f46e5' },
  { key: 'reserve', label: 'Réserve', color: '#0284c7' },
  { key: 'archive', label: 'Archivés', color: '#475569' },
];
const RATIOS: { key: string; label: string; color: string }[] = [
  { key: 'actif', label: 'Actifs', color: '#047857' },
  { key: 'conge', label: 'Congés', color: '#f59e0b' },
  { key: 'maladie', label: 'Maladies', color: '#c2410c' },
  { key: 'absent', label: 'Absences', color: '#dc2626' },
  { key: 'suspendu', label: 'Suspensions', color: '#7c3aed' },
];

function delaiBadge(days: number | null): { label: string; cls: string } {
  if (days == null) return { label: '—', cls: 'sg-pill--gray' };
  if (days < 0) return { label: `Expiré J+${Math.abs(days)}`, cls: 'sg-pill--red' };
  return { label: `J-${days}`, cls: days <= 30 ? 'sg-pill--red' : 'sg-pill--amber' };
}
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
        <div class="dr-kpi" style="border-top-color:#b45309">
          <span class="dr-num" style="color:#b45309">{{ data.leaves_pending }}</span><span class="dr-lbl">Congés en attente</span>
        </div>
      </div>

      <!-- KPI candidats -->
      <div class="dr-kpis dr-kpis--cand">
        <div v-for="k in CAND_KPI" :key="k.key" class="dr-kpi" :style="{ borderTopColor: k.color }">
          <span class="dr-num" :style="{ color: k.color }">{{ byCand[k.key] ?? 0 }}</span>
          <span class="dr-lbl">{{ k.label }}</span>
        </div>
      </div>

      <!-- Ratios RH -->
      <div class="sg-card dr-ratio">
        <h3 class="dr-h3">Ratios RH</h3>
        <div v-for="r in RATIOS" :key="r.key" class="dr-ratio__row">
          <div class="dr-ratio__head"><span>{{ r.label }}</span><strong>{{ ratio(r.key) }}%</strong></div>
          <div class="dr-bar"><div class="dr-bar__fill" :style="{ width: ratio(r.key) + '%', background: r.color }"></div></div>
        </div>
      </div>

      <!-- Alerte fin de contrat -->
      <div class="sg-card dr-section">
        <h3 class="dr-h3">Alerte fin de contrat (≤ 90 jours)</h3>
        <p class="sg-page-sub dr-sub">{{ contratsExpires }} contrat(s) expiré(s) · {{ contratsFin90 }} fin(s) dans 90 jours</p>
        <div v-if="!contratAlertes.length" class="dr-empty">Aucune échéance de contrat proche.</div>
        <table v-else class="ef-table">
          <thead><tr><th>Code</th><th>Employé</th><th>Fin de contrat</th><th>Délai</th></tr></thead>
          <tbody>
            <tr v-for="x in contratAlertes.slice(0, 8)" :key="x.e.id" class="ef-row" @click="router.push(`/effectif/agent/${x.e.id}`)">
              <td class="ef-mono">{{ x.e.code }}</td><td>{{ fullName(x.e) }}</td>
              <td>{{ x.e.contract_end_date ? formatFR(x.e.contract_end_date.slice(0, 10)) : '—' }}</td>
              <td><span class="sg-pill" :class="delaiBadge(x.days).cls">{{ delaiBadge(x.days).label }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="contratAlertes.length > 8" class="dr-more">+{{ contratAlertes.length - 8 }} autre(s)</p>
      </div>

      <!-- Fins de période d'essai (bonus) -->
      <div class="sg-card dr-section">
        <h3 class="dr-h3">Fins de période d'essai (≤ 90 jours) — {{ trialSoon.length }}</h3>
        <div v-if="!trialSoon.length" class="dr-empty">Aucune fin d'essai proche.</div>
        <table v-else class="ef-table">
          <thead><tr><th>Code</th><th>Employé</th><th>Fin d'essai</th><th>Délai</th></tr></thead>
          <tbody>
            <tr v-for="t in trialSoon" :key="t.id" class="ef-row" @click="router.push(`/effectif/agent/${t.id}`)">
              <td class="ef-mono">{{ t.code }}</td><td>{{ t.name }}</td>
              <td>{{ t.trial_end_date ? formatFR(t.trial_end_date.slice(0, 10)) : '—' }}</td>
              <td><span class="sg-pill" :class="delaiBadge(t.days).cls">{{ delaiBadge(t.days).label }}</span></td>
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
@media (min-width: 1100px) { .dr-kpis { grid-template-columns: repeat(8, 1fr); } }
.dr-kpis--cand { grid-template-columns: repeat(3, 1fr); }
@media (min-width: 700px) { .dr-kpis--cand { grid-template-columns: repeat(3, 1fr); max-width: 540px; } }
.dr-kpi { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: var(--sg-space-4) var(--sg-space-3); background: var(--sg-surface); border: 1px solid var(--sg-border); border-top: 3px solid var(--sg-border); border-radius: var(--sg-radius); }
.dr-kpi--total { border-top-color: var(--sg-brand-600); }
.dr-num { font-size: 28px; font-weight: 900; line-height: 1; }
.dr-lbl { font-size: 11px; text-transform: uppercase; color: var(--sg-text-muted); font-weight: 700; text-align: center; }
.dr-ratio { padding: var(--sg-space-4); margin-bottom: var(--sg-space-4); }
.dr-ratio__row { margin-bottom: var(--sg-space-3); }
.dr-ratio__head { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: var(--sg-fs-sm); }
.dr-bar { height: 10px; background: var(--sg-surface-2); border-radius: 999px; overflow: hidden; }
.dr-bar__fill { height: 100%; }
.dr-section { padding: var(--sg-space-4); margin-bottom: var(--sg-space-4); }
.dr-h3 { font-size: var(--sg-fs-sm); text-transform: uppercase; color: var(--sg-brand-700); font-weight: 800; margin: 0 0 var(--sg-space-2); }
.dr-sub { margin: 0 0 var(--sg-space-3); }
.dr-empty { text-align: center; color: var(--sg-text-muted); padding: var(--sg-space-5); }
.dr-more { text-align: center; color: var(--sg-text-muted); font-size: 12px; margin-top: var(--sg-space-2); }
.ef-table { width: 100%; border-collapse: collapse; font-size: var(--sg-fs-sm); }
.ef-table th { text-align: left; padding: 8px 10px; color: var(--sg-text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--sg-border); }
.ef-table td { padding: 8px 10px; border-bottom: 1px solid var(--sg-border); }
.ef-row { cursor: pointer; } .ef-row:hover { background: var(--sg-surface-2); }
.ef-mono { font-family: ui-monospace, Menlo, Consolas, monospace; color: #b45309; }
</style>
