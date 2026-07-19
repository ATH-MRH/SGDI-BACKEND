<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Incident, IncidentActionName, SiteRef, EmployeeRef } from '@sgdi/shared';
import { incidentsApi, referenceApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import { isClosed, isCritical, pillClass, cardBorder, formatFR, safe, incidentSubject } from '@/utils/incidents';
import IncidentFormModal from '@/components/incidents/IncidentFormModal.vue';
import IncidentDetailModal from '@/components/incidents/IncidentDetailModal.vue';

const props = defineProps<{ mode: 'site' | 'autres' }>();
const session = useSessionStore();

const items = ref<Incident[]>([]);
const total = ref(0);
const pages = ref(1);
const page = ref(1);
const loading = ref(true);
const error = ref('');
const filter = ref<'tous' | 'ouverts' | 'critiques' | 'clotures'>('tous');
const showForm = ref(false);
const detail = ref<Incident | null>(null);

const siteMap = ref<Record<number, string>>({});
const agentMap = ref<Record<number, string>>({});

const eventType = computed(() => (props.mode === 'autres' ? 'autre' : 'site'));
const title = computed(() => (props.mode === 'autres' ? 'Main courante — Évènements autres' : 'Main courante — Évènements site'));

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
    const res = await incidentsApi.page({ event_type: eventType.value, page: page.value, page_size: 20 });
    items.value = res.items;
    total.value = res.total;
    pages.value = res.pages;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadRefs(), load()]);
});
watch(() => props.mode, () => { page.value = 1; filter.value = 'tous'; void load(); });

const filtered = computed(() => {
  if (filter.value === 'ouverts') return items.value.filter((i) => !isClosed(i));
  if (filter.value === 'critiques') return items.value.filter((i) => isCritical(i));
  if (filter.value === 'clotures') return items.value.filter((i) => isClosed(i));
  return items.value;
});

const kpi = computed(() => ({
  total: total.value,
  ouverts: items.value.filter((i) => !isClosed(i)).length,
  critiques: items.value.filter((i) => isCritical(i)).length,
  clos: items.value.filter((i) => isClosed(i)).length,
}));

async function doAction(inc: Incident, action: IncidentActionName): Promise<void> {
  // Parité legacy : escalade et clôture demandent un motif / une observation.
  let note: string | undefined;
  if (action === 'escalader') {
    const r = window.prompt("Motif / destinataire de l'escalade :");
    if (r === null) return; // annulé
    note = r;
  } else if (action === 'cloturer') {
    const r = window.prompt('Observation de clôture :');
    if (r === null) return; // annulé
    note = r; // observation vide acceptée
  }
  try {
    await incidentsApi.action(inc.id, action, note);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Action impossible";
  }
}

function onSaved(): void {
  showForm.value = false;
  page.value = 1;
  void load();
}
function go(delta: number): void {
  const next = page.value + delta;
  if (next >= 1 && next <= pages.value) { page.value = next; void load(); }
}
</script>

<template>
  <div>
    <div class="sg-page-head">
      <div>
        <h1 class="sg-page-title">{{ title }}</h1>
        <p class="sg-page-sub">Journal opérationnel, suivi des faits, décisions et clôtures.</p>
      </div>
      <button class="sg-btn" @click="showForm = true">Nouvel évènement</button>
    </div>

    <div class="sg-kpis kpi4">
      <div class="sg-kpi" style="cursor:default">
        <div class="sg-kpi__label">Total</div><div class="sg-kpi__value">{{ kpi.total }}</div>
      </div>
      <div class="sg-kpi" style="cursor:default">
        <div class="sg-kpi__label">Ouverts</div><div class="sg-kpi__value" style="color:#b45309">{{ kpi.ouverts }}</div>
      </div>
      <div class="sg-kpi" style="cursor:default">
        <div class="sg-kpi__label">Critiques</div><div class="sg-kpi__value" style="color:#b91c1c">{{ kpi.critiques }}</div>
      </div>
      <div class="sg-kpi" style="cursor:default">
        <div class="sg-kpi__label">Clôturés</div><div class="sg-kpi__value" style="color:#047857">{{ kpi.clos }}</div>
      </div>
    </div>

    <div class="filters">
      <button v-for="f in (['tous','ouverts','critiques','clotures'] as const)" :key="f"
              class="sg-btn sg-btn-ghost sg-btn-sm" :class="{ 'filters--on': filter === f }" @click="filter = f">
        {{ { tous: 'Tous', ouverts: 'Ouverts', critiques: 'Critiques', clotures: 'Clôturés' }[f] }}
      </button>
    </div>

    <p v-if="loading" class="sg-page-sub">Chargement de la main courante…</p>
    <p v-else-if="error" class="sg-alert">{{ error }}</p>
    <div v-else-if="!filtered.length" class="sg-card empty">Aucun évènement.</div>

    <div v-else class="list">
      <article v-for="i in filtered" :key="i.id" class="sg-card card" :style="{ borderLeft: `5px solid ${cardBorder(i)}` }">
        <div class="card__main">
          <div class="card__pills">
            <span class="sg-pill" :class="pillClass(i.severity)">{{ i.severity || 'mineur' }}</span>
            <span class="sg-pill" :class="pillClass(i.status)">{{ i.status || 'en_cours' }}</span>
            <span class="card__date">{{ formatFR(i.incident_date) }} {{ i.incident_time || '' }}</span>
          </div>
          <h3 class="card__subject">{{ incidentSubject(i) }}</h3>
          <p v-if="i.description" class="card__desc">{{ i.description }}</p>
          <div v-if="i.consigne" class="card__consigne"><strong>Conduite à tenir :</strong> {{ i.consigne }}</div>
          <div class="card__meta">
            Site : {{ safe(i.site_id ? siteMap[i.site_id] : null) }} ·
            Agent : {{ safe(i.employee_id ? agentMap[i.employee_id] : null) }} ·
            Catégorie : {{ safe(i.category) }}
          </div>
        </div>
        <div class="card__actions">
          <button class="sg-btn sg-btn-secondary sg-btn-sm" @click="detail = i">Voir</button>
          <template v-if="!isClosed(i)">
            <button class="sg-btn sg-btn-ghost sg-btn-sm" @click="doAction(i, 'acquitter')">Acquitter</button>
            <button class="sg-btn sg-btn-ghost sg-btn-sm" @click="doAction(i, 'escalader')">Escalader</button>
            <button class="sg-btn sg-btn-sm" @click="doAction(i, 'cloturer')">Clôturer</button>
          </template>
        </div>
      </article>
    </div>

    <div v-if="pages > 1" class="pager">
      <button class="sg-btn sg-btn-ghost sg-btn-sm" :disabled="page <= 1" @click="go(-1)">← Précédent</button>
      <span class="pager__info">Page {{ page }} / {{ pages }}</span>
      <button class="sg-btn sg-btn-ghost sg-btn-sm" :disabled="page >= pages" @click="go(1)">Suivant →</button>
    </div>

    <IncidentFormModal v-if="showForm" :mode="mode" @close="showForm = false" @saved="onSaved" />
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
.kpi4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 760px) { .kpi4 { grid-template-columns: repeat(2, 1fr); } }
.filters { display: flex; flex-wrap: wrap; gap: var(--sg-space-2); margin: var(--sg-space-4) 0; }
.filters--on { background: var(--sg-brand-soft); color: var(--sg-brand-700); border-color: var(--sg-brand-500); }
.empty { padding: var(--sg-space-8); text-align: center; color: var(--sg-text-muted); }
.list { display: flex; flex-direction: column; gap: var(--sg-space-3); }
.card { display: flex; gap: var(--sg-space-4); padding: var(--sg-space-4); }
.card__main { flex: 1; min-width: 0; }
.card__pills { display: flex; align-items: center; gap: var(--sg-space-2); margin-bottom: 6px; }
.card__date { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); }
.card__subject { margin: 0 0 4px; font-weight: 800; }
.card__desc { margin: 0 0 6px; color: var(--sg-text-soft); }
.card__consigne { font-size: var(--sg-fs-sm); background: var(--sg-surface-2); border-radius: var(--sg-radius-sm); padding: 6px 10px; margin-bottom: 6px; }
.card__meta { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); }
.card__actions { display: flex; flex-direction: column; gap: var(--sg-space-2); flex-shrink: 0; }
.pager { display: flex; align-items: center; justify-content: center; gap: var(--sg-space-3); margin-top: var(--sg-space-4); }
.pager__info { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); }
</style>
