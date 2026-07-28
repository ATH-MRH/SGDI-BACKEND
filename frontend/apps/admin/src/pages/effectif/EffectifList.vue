<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Employee } from '@sgdi/shared';
import { employeesApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import {
  nom, prenom, matricule, telephone, societe, poste, siteName,
  dateRecrutement, photo, fullName, statusPill, matchesFilter, kpiCount,
  EFFECTIF_KPIS,
} from '@/utils/employees';
import { formatFR } from '@/utils/incidents';

const props = defineProps<{ filter: string }>();
const router = useRouter();
const session = useSessionStore();

const all = ref<Employee[]>([]);
const loading = ref(true);
const error = ref('');
const page = ref(1);
const pageSize = 25;

const TITLES: Record<string, string> = {
  actifs: 'Gestion des effectifs',
  operationnels: 'Effectif opérationnel',
  conge: 'Agents en congé',
  maladie: 'Agents en maladie',
  absents: 'Agents en absence',
  suspension: 'Agents suspendus',
  instance_affectation: "Employés en attente d'affectation",
  sortant: 'Sortant',
  blacklist: 'BLACKLIST',
};
const title = computed(() => TITLES[props.filter] ?? 'Gestion des effectifs');

// KPI masquées sur instance_affectation (parité : masqué aussi OPS/DRH — contextes non distingués en v2).
const showKpis = computed(() => props.filter !== 'instance_affectation');

// --- Recherche (persistée par sous-filtre) ---
const search = ref('');
watch(() => props.filter, (f) => {
  search.value = sessionStorage.getItem(`effectifSearch:${f}`) ?? '';
  page.value = 1;
}, { immediate: true });
watch(search, (v) => sessionStorage.setItem(`effectifSearch:${props.filter}`, v));

// --- Tri (NON persisté, reset nom_asc au reload) ---
type SortKey = 'employe' | 'code' | 'societe' | 'poste' | 'site' | 'recrut' | 'statut';
const sortKey = ref<SortKey>('employe');
const sortDir = ref<'asc' | 'desc'>('asc');
const SORT_OPTIONS: { value: string; label: string; key: SortKey; dir: 'asc' | 'desc' }[] = [
  { value: 'nom_asc', label: 'Nom A→Z', key: 'employe', dir: 'asc' },
  { value: 'nom_desc', label: 'Nom Z→A', key: 'employe', dir: 'desc' },
  { value: 'recrut_asc', label: 'Recrutement ancien→récent', key: 'recrut', dir: 'asc' },
  { value: 'recrut_desc', label: 'Recrutement récent→ancien', key: 'recrut', dir: 'desc' },
  { value: 'mat_asc', label: 'Code ↑', key: 'code', dir: 'asc' },
  { value: 'mat_desc', label: 'Code ↓', key: 'code', dir: 'desc' },
];
const sortValue = computed(() => {
  const base = sortKey.value === 'code' ? 'mat' : sortKey.value === 'recrut' ? 'recrut' : 'nom';
  return `${base}_${sortDir.value}`;
});
function onSortSelect(v: string): void {
  const opt = SORT_OPTIONS.find((o) => o.value === v);
  if (opt) { sortKey.value = opt.key; sortDir.value = opt.dir; }
}
function toggleSort(key: SortKey): void {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else { sortKey.value = key; sortDir.value = 'asc'; }
}
function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '↕';
  return sortDir.value === 'asc' ? '▲' : '▼';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    all.value = await employeesApi.list({ society: session.activeSociety ?? undefined });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// KPI comptés localement sur la liste chargée.
const kpiCounts = computed(() => {
  const m: Record<string, number> = {};
  for (const k of EFFECTIF_KPIS) m[k.filter] = kpiCount(all.value, k.filter);
  return m;
});

// (1) sous-filtre → (2) société (déjà côté serveur) → (5) tri ; recherche = filtrage local.
const filtered = computed(() => all.value.filter((e) => matchesFilter(e, props.filter)));

const searched = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return filtered.value;
  return filtered.value.filter((e) => {
    const iso = dateRecrutement(e);
    return `${nom(e)} ${prenom(e)} ${matricule(e)} ${societe(e)} ${poste(e)} ${siteName(e)} ${telephone(e)} ${iso} ${iso ? formatFR(iso.slice(0, 10)) : ''} ${statusPill(e).label}`
      .toLowerCase().includes(q);
  });
});

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
function sortField(e: Employee, key: SortKey): string {
  switch (key) {
    case 'code': return matricule(e);
    case 'societe': return societe(e);
    case 'poste': return poste(e);
    case 'site': return siteName(e);
    case 'recrut': return dateRecrutement(e);
    case 'statut': return statusPill(e).label;
    case 'employe':
    default: return `${nom(e)} ${prenom(e)}`;
  }
}
const sorted = computed(() => {
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...searched.value].sort((a, b) => dir * collator.compare(sortField(a, sortKey.value), sortField(b, sortKey.value)));
});

const pages = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize)));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * pageSize, page.value * pageSize));
watch(sorted, () => { if (page.value > pages.value) page.value = pages.value; });

function goToFilter(filter: string): void {
  router.push(filter === 'actifs' ? '/effectif' : `/effectif/${filter}`);
}
function openFiche(e: Employee): void {
  router.push(`/effectif/agent/${e.id}`);
}
</script>

<template>
  <div>
    <div class="sg-page-head">
      <div>
        <h1 class="sg-page-title">{{ title }}</h1>
        <p class="sg-page-sub">Effectif &amp; agents · {{ session.activeSociety ?? 'Toutes les sociétés' }}</p>
      </div>
    </div>

    <!-- 7 cartes KPI cliquables -->
    <div v-if="showKpis" class="ef-kpis">
      <button
        v-for="k in EFFECTIF_KPIS" :key="k.key"
        class="ef-kpi" :class="{ 'ef-kpi--active': filter === k.filter }"
        :style="{ '--kpi': k.color, borderColor: filter === k.filter ? k.color : k.color + '22' }"
        @click="goToFilter(k.filter)"
      >
        <span class="ef-kpi__ico" :style="{ color: k.color }">{{ k.icon }}</span>
        <span class="ef-kpi__num" :style="{ color: k.color }">{{ kpiCounts[k.filter] ?? 0 }}</span>
        <span class="ef-kpi__lbl">{{ k.label }}</span>
      </button>
    </div>

    <p v-if="error" class="sg-alert">{{ error }}</p>
    <p v-if="loading" class="sg-page-sub">Chargement…</p>

    <template v-else>
      <!-- En-tête : recherche + tri -->
      <div class="ef-toolbar">
        <input
          v-model="search" class="sg-input ef-search" type="search"
          placeholder="Recherche nom / prénom / code"
        />
        <select class="sg-select ef-sort" :value="sortValue" @change="onSortSelect(($event.target as HTMLSelectElement).value)">
          <option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <p class="ef-count">{{ sorted.length }} résultat(s) affiché(s)</p>

      <div v-if="!sorted.length" class="sg-card ef-empty">Aucun employé.</div>

      <div v-else class="sg-card ef-tablewrap">
        <table class="ef-table">
          <thead>
            <tr>
              <th class="ef-sort-head" style="width:28%" @click="toggleSort('employe')">Employé <span class="ef-ind">{{ sortIndicator('employe') }}</span></th>
              <th class="ef-sort-head" style="width:8%" @click="toggleSort('code')">Code <span class="ef-ind">{{ sortIndicator('code') }}</span></th>
              <th class="ef-sort-head" style="width:13%" @click="toggleSort('societe')">Société <span class="ef-ind">{{ sortIndicator('societe') }}</span></th>
              <th class="ef-sort-head" style="width:13%" @click="toggleSort('poste')">Poste <span class="ef-ind">{{ sortIndicator('poste') }}</span></th>
              <th class="ef-sort-head" style="width:10%" @click="toggleSort('site')">Site <span class="ef-ind">{{ sortIndicator('site') }}</span></th>
              <th class="ef-sort-head" style="width:8%" @click="toggleSort('recrut')">Recrut. <span class="ef-ind">{{ sortIndicator('recrut') }}</span></th>
              <th class="ef-sort-head" style="width:82px" @click="toggleSort('statut')">Statut <span class="ef-ind">{{ sortIndicator('statut') }}</span></th>
              <th style="width:96px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in pageRows" :key="e.id" class="ef-row" @click="openFiche(e)">
              <td>
                <div class="ef-agent">
                  <span class="ef-avatar"><img v-if="photo(e)" :src="photo(e)" alt="" /><template v-else>{{ (prenom(e) || '?')[0] }}</template></span>
                  <div>
                    <div class="ef-name">{{ fullName(e) }}</div>
                    <div class="ef-phone">{{ telephone(e) || '—' }}</div>
                  </div>
                </div>
              </td>
              <td><span class="ef-code">{{ matricule(e) || '—' }}</span></td>
              <td class="ef-xs">{{ societe(e) || '—' }}</td>
              <td class="ef-xs">{{ poste(e) || '—' }}</td>
              <td class="ef-xs">{{ siteName(e) || '—' }}</td>
              <td class="ef-xs">{{ dateRecrutement(e) ? formatFR(dateRecrutement(e).slice(0, 10)) : '—' }}</td>
              <td><span class="sg-pill" :class="statusPill(e).cls">{{ statusPill(e).label }}</span></td>
              <td @click.stop>
                <button class="sg-btn sg-btn-ghost sg-btn-sm" @click="openFiche(e)">Ouvrir →</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="ef-foot">
          <span>{{ sorted.length }} employé(s) · page {{ page }}/{{ pages }}</span>
          <span class="ef-foot__nav">
            <button class="sg-btn sg-btn-ghost sg-btn-sm" :disabled="page <= 1" @click="page--">Précédent</button>
            <button class="sg-btn sg-btn-ghost sg-btn-sm" :disabled="page >= pages" @click="page++">Suivant</button>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ef-kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sg-space-3); margin-bottom: var(--sg-space-5); }
@media (min-width: 768px) { .ef-kpis { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 1200px) { .ef-kpis { grid-template-columns: repeat(7, 1fr); } }
.ef-kpi {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  min-height: 120px; padding: var(--sg-space-3); background: var(--sg-surface);
  border: 2px solid; border-radius: var(--sg-radius); cursor: pointer; font: inherit;
}
.ef-kpi:hover { background: var(--sg-surface-2); }
.ef-kpi__ico { font-size: 30px; line-height: 1; }
.ef-kpi__num { font-size: 30px; font-weight: 900; line-height: 1; }
.ef-kpi__lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--sg-text-muted); text-align: center; }

.ef-toolbar { display: flex; flex-wrap: wrap; gap: var(--sg-space-3); align-items: center; margin-bottom: 6px; }
.ef-search { flex: 1; min-width: 220px; text-align: center; }
.ef-sort { min-width: 220px; }
.ef-count { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); margin: 0 0 var(--sg-space-3); }
.ef-empty { padding: var(--sg-space-8); text-align: center; color: var(--sg-text-muted); }

.ef-tablewrap { overflow-x: auto; }
.ef-table { width: 100%; border-collapse: collapse; font-size: var(--sg-fs-sm); }
.ef-table th { text-align: left; padding: 10px 12px; color: var(--sg-text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--sg-border); }
.ef-sort-head { cursor: pointer; user-select: none; white-space: nowrap; }
.ef-sort-head:hover { color: var(--sg-brand-700); }
.ef-ind { opacity: 0.6; font-size: 10px; }
.ef-table td { padding: 10px 12px; border-bottom: 1px solid var(--sg-border); }
.ef-row { cursor: pointer; }
.ef-row:hover { background: var(--sg-surface-2); }
.ef-agent { display: flex; align-items: center; gap: 10px; }
.ef-avatar { width: 34px; height: 34px; border-radius: 999px; background: var(--sg-brand-soft); color: var(--sg-brand-700); display: grid; place-items: center; font-weight: 800; overflow: hidden; flex-shrink: 0; }
.ef-avatar img { width: 100%; height: 100%; object-fit: cover; }
.ef-name { font-weight: 700; }
.ef-phone { font-size: 11px; color: var(--sg-text-muted); }
.ef-code { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 800; color: #b45309; }
.ef-xs { font-size: 12px; color: var(--sg-text); }
.ef-foot { display: flex; align-items: center; justify-content: space-between; padding: 12px; color: var(--sg-text-muted); }
.ef-foot__nav { display: flex; gap: var(--sg-space-2); }
</style>
