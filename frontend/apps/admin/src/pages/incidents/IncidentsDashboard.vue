<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Incident, IncidentDashboard, SiteRef, EmployeeRef } from '@sgdi/shared';
import { incidentsApi, referenceApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import { formatFR, incidentSubject } from '@/utils/incidents';
import IncidentFormModal from '@/components/incidents/IncidentFormModal.vue';
import IncidentDetailModal from '@/components/incidents/IncidentDetailModal.vue';

const router = useRouter();
const session = useSessionStore();
const data = ref<IncidentDashboard | null>(null);
const loading = ref(true);
const error = ref('');
const showForm = ref(false);
const formMode = ref<'site' | 'autres'>('site');
const detail = ref<Incident | null>(null);

const siteMap = ref<Record<number, string>>({});
const agentMap = ref<Record<number, string>>({});

function openForm(mode: 'site' | 'autres'): void {
  formMode.value = mode;
  showForm.value = true;
}

async function loadRefs(): Promise<void> {
  try {
    const [sites, emps] = await Promise.all([
      referenceApi.sites(session.activeSociety ?? undefined),
      referenceApi.employees(session.activeSociety ?? undefined),
    ]);
    siteMap.value = Object.fromEntries((sites as SiteRef[]).map((s) => [s.id, s.name]));
    agentMap.value = Object.fromEntries((emps as EmployeeRef[]).map((a) => [a.id, `${a.last_name} ${a.first_name}`]));
  } catch {
    /* listes optionnelles */
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    data.value = await incidentsApi.dashboard();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await Promise.all([loadRefs(), load()]);
});

const KPIS: { key: keyof IncidentDashboard['kpis']; label: string; color: string; to: string }[] = [
  { key: 'total', label: 'Total main courante', color: '#043970', to: '/incidents/site' },
  { key: 'site', label: 'Évènements site', color: '#0369a1', to: '/incidents/site' },
  { key: 'autres', label: 'Évènements autres', color: '#7c2d12', to: '/incidents/autres' },
  { key: 'ouverts', label: 'Ouverts', color: '#b45309', to: '/incidents/site' },
  { key: 'critiques', label: 'Critiques', color: '#b91c1c', to: '/incidents/site' },
  { key: 'clos', label: 'Clôturés', color: '#047857', to: '/incidents/site' },
  { key: 'aujourdhui', label: "Aujourd'hui", color: '#1d4ed8', to: '/incidents/site' },
];

function onSaved(): void {
  showForm.value = false;
  void load();
}
</script>

<template>
  <div>
    <div class="sg-page-head">
      <div>
        <h1 class="sg-page-title">Main courante — Tableau de bord</h1>
        <p class="sg-page-sub">Synthèse des évènements, incidents, alertes et clôtures.</p>
      </div>
      <button class="sg-btn" @click="openForm('site')">Nouvel évènement</button>
    </div>

    <p v-if="loading" class="sg-page-sub">Chargement…</p>
    <p v-else-if="error" class="sg-alert">{{ error }}</p>

    <template v-else-if="data">
      <div class="sg-kpis kpi7">
        <button v-for="k in KPIS" :key="k.key" class="sg-kpi" @click="router.push(k.to)">
          <div class="sg-kpi__label">{{ k.label }}</div>
          <div class="sg-kpi__value" :style="{ color: k.color }">{{ data.kpis[k.key] }}</div>
        </button>
      </div>

      <div class="dash2">
        <section class="sg-card dash2__card">
          <h3 class="dash2__title">Accès rapides</h3>
          <div class="dash2__quick">
            <button class="sg-btn sg-btn-secondary sg-btn-sm" @click="router.push('/incidents/site')">Évènements site</button>
            <button class="sg-btn sg-btn-secondary sg-btn-sm" @click="router.push('/incidents/autres')">Évènements autres</button>
            <button class="sg-btn sg-btn-sm" @click="openForm('site')">Créer évènement site</button>
            <button class="sg-btn sg-btn-sm" @click="openForm('autres')">Créer évènement autre</button>
          </div>
        </section>

        <section class="sg-card dash2__card">
          <h3 class="dash2__title">Alertes ouvertes</h3>
          <ul v-if="data.alertes.length" class="alerts">
            <li v-for="a in data.alertes" :key="a.id">
              <button class="alerts__item" @click="detail = a">
                <span class="alerts__subject">{{ incidentSubject(a) }}</span>
                <span class="alerts__meta">{{ formatFR(a.incident_date) }} · {{ a.status }} · {{ a.severity }}</span>
              </button>
            </li>
          </ul>
          <p v-else class="alerts__empty">Aucune alerte ouverte.</p>
        </section>
      </div>
    </template>

    <IncidentFormModal v-if="showForm" :mode="formMode" @close="showForm = false" @saved="onSaved" />
    <IncidentDetailModal
      v-if="detail"
      :incident="detail"
      :site-name="detail.site_id ? siteMap[detail.site_id] : undefined"
      :agent-name="detail.employee_id ? agentMap[detail.employee_id] : undefined"
      @close="detail = null"
      @updated="load"
    />
  </div>
</template>

<style scoped>
.kpi7 { grid-template-columns: repeat(7, 1fr); }
@media (max-width: 1280px) { .kpi7 { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 760px) { .kpi7 { grid-template-columns: repeat(2, 1fr); } }
.dash2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sg-space-4); margin-top: var(--sg-space-4); }
@media (max-width: 760px) { .dash2 { grid-template-columns: 1fr; } }
.dash2__card { padding: var(--sg-space-4); }
.dash2__title { margin: 0 0 var(--sg-space-3); font-weight: 800; }
.dash2__quick { display: flex; flex-wrap: wrap; gap: var(--sg-space-2); }
.alerts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.alerts__item {
  width: 100%; text-align: left; cursor: pointer;
  background: var(--sg-surface-2); border: 1px solid var(--sg-border); border-radius: var(--sg-radius-sm);
  padding: 8px 10px; display: flex; flex-direction: column; gap: 2px;
}
.alerts__item:hover { border-color: var(--sg-brand-500); }
.alerts__subject { font-size: var(--sg-fs-sm); font-weight: 700; }
.alerts__meta { font-size: 11px; color: var(--sg-text-muted); }
.alerts__empty { color: var(--sg-success); font-weight: 600; font-size: var(--sg-fs-sm); }
</style>
