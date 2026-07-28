<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Employee } from '@sgdi/shared';
import { employeesApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import { fullName, matricule, societe } from '@/utils/employees';
import { getLegacy, dotation } from '@/utils/employeeFiche';
import { formatFR } from '@/utils/incidents';

const router = useRouter();
const session = useSessionStore();
const all = ref<Employee[]>([]);
const loading = ref(true);
const error = ref('');

// Reversements : le legacy filtre strictement statut==='sortant' + finRelationAt renseigné.

async function load(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    all.value = await employeesApi.list({ society: session.activeSociety ?? undefined });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally { loading.value = false; }
}
onMounted(load);

function elapsedH(e: Employee): number | null {
  const at = getLegacy(e).finRelationAt;
  if (!at) return null;
  const t = new Date(String(at)).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 3600000);
}
function dateSortie(e: Employee): string {
  const l = getLegacy(e);
  const d = String(l.dateSortie ?? l.finRelationAt ?? l.dateFinContrat ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? formatFR(d.slice(0, 10)) : (d || '—');
}
function dotationLabel(e: Employee): string {
  const arts = dotation(e).map((m) => String(m.article ?? '')).filter(Boolean);
  return arts.length ? arts.join(', ') : `${dotation(e).length} article(s)`;
}

const rows = computed(() =>
  all.value
    .filter((e) => {
      const l = getLegacy(e);
      const st = (String(l.statut ?? e.status ?? '')).toLowerCase();
      return st === 'sortant' && Boolean(l.finRelationAt) && dotation(e).length > 0 && !l.finRelationDotationReversee;
    })
    .map((e) => ({ e, h: elapsedH(e) }))
    .sort((a, b) => (b.h ?? 0) - (a.h ?? 0)),
);
const total = computed(() => rows.value.length);
const moins72 = computed(() => rows.value.filter((r) => (r.h ?? 0) < 72).length);
const alerte72 = computed(() => rows.value.filter((r) => (r.h ?? 0) >= 72).length);
</script>

<template>
  <div>
    <div class="sg-page-head">
      <h1 class="sg-page-title">Reversements dotation en attente</h1>
      <p class="sg-page-sub">DRH · {{ session.activeSociety ?? 'Toutes les sociétés' }}</p>
    </div>
    <p v-if="error" class="sg-alert">{{ error }}</p>
    <p v-if="loading" class="sg-page-sub">Chargement…</p>

    <template v-else>
      <div class="rv-kpis">
        <div class="rv-kpi"><span>{{ total }}</span>Total</div>
        <div class="rv-kpi" style="color:#b45309"><span>{{ moins72 }}</span>En attente &lt;72h</div>
        <div class="rv-kpi" :class="{ 'rv-blink': alerte72 > 0 }" style="color:#dc2626"><span>{{ alerte72 }}</span>Alerte ≥72h</div>
      </div>

      <p v-if="alerte72 > 0" class="sg-alert rv-blink">{{ alerte72 }} dotation(s) non reversée(s) depuis plus de 72h.</p>

      <div v-if="!rows.length" class="sg-card rv-empty">Aucun reversement en attente.</div>
      <div v-else class="sg-card rv-tablewrap">
        <table class="rv-table">
          <thead><tr><th>Employé</th><th>Code</th><th>Société</th><th>Date sortie</th><th>Dotation</th><th>Délai</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.e.id" class="rv-row" @click="router.push(`/effectif/agent/${r.e.id}`)">
              <td><strong>{{ fullName(r.e) }}</strong></td>
              <td class="rv-mono">{{ matricule(r.e) }}</td>
              <td>{{ societe(r.e) || '—' }}</td>
              <td>{{ dateSortie(r.e) }}</td>
              <td>{{ dotationLabel(r.e) }}</td>
              <td><span class="sg-pill" :class="(r.h ?? 0) >= 72 ? 'sg-pill--red rv-blink' : 'sg-pill--amber'">{{ r.h != null ? '+' + r.h + 'h' : '—' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rv-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sg-space-3); margin-bottom: var(--sg-space-4); max-width: 560px; }
.rv-kpi { display: flex; flex-direction: column; align-items: center; padding: var(--sg-space-4); background: var(--sg-surface); border: 1px solid var(--sg-border); border-radius: var(--sg-radius); font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--sg-text-muted); }
.rv-kpi span { font-size: 28px; font-weight: 900; color: inherit; }
.rv-blink { animation: rv-blink 1.1s ease-in-out infinite; }
@keyframes rv-blink { 50% { opacity: 0.45; } }
.rv-empty { padding: var(--sg-space-8); text-align: center; color: var(--sg-text-muted); }
.rv-tablewrap { overflow-x: auto; }
.rv-table { width: 100%; border-collapse: collapse; font-size: var(--sg-fs-sm); }
.rv-table th { text-align: left; padding: 10px 12px; color: var(--sg-text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--sg-border); }
.rv-table td { padding: 10px 12px; border-bottom: 1px solid var(--sg-border); }
.rv-row { cursor: pointer; } .rv-row:hover { background: var(--sg-surface-2); }
.rv-mono { font-family: ui-monospace, Menlo, Consolas, monospace; color: #b45309; }
</style>
