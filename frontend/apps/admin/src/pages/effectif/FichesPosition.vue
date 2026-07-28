<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Employee } from '@sgdi/shared';
import { employeesApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import {
  nom, prenom, matricule, societe, poste, siteName, statut, statusPill,
  photo, fullName, dateRecrutement, ageYears,
} from '@/utils/employees';
import { getLegacy, dotation, daysBetween } from '@/utils/employeeFiche';
import { formatFR } from '@/utils/incidents';

const router = useRouter();
const session = useSessionStore();
const all = ref<Employee[]>([]);
const loading = ref(true);
const error = ref('');

const search = ref('');
const fSite = ref('');
const fPoste = ref('');
const fStatut = ref('');
const sort = ref('alpha_asc');
const layout = ref<'mosaique' | 'liste'>('mosaique');

async function load(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    all.value = await employeesApi.list({ society: session.activeSociety ?? undefined });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally { loading.value = false; }
}
onMounted(load);
watch(() => session.activeSociety, load);

// Employés actifs = non sortants.
const SORTANT = ['sortant', 'archive', 'demissionne', 'licencie'];
const isSortant = (e: Employee): boolean => SORTANT.includes(statut(e));
const activeBase = computed(() => all.value.filter((e) => !isSortant(e)));

function contractEnd(e: Employee): string {
  return String(getLegacy(e).dateFinContrat || e.contract_end_date || '');
}
function typeContrat(e: Employee): string {
  return String(getLegacy(e).typeContrat || e.contract_type || '').toUpperCase() || 'CDD';
}
// Dotation la plus récente (mois écoulés) pour « À remplacer ».
function dotationAgeMonths(e: Employee): number | null {
  const dates = dotation(e).map((m) => String(m.date ?? '')).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
  if (!dates.length) return null;
  const d = daysBetween(dates[dates.length - 1], new Date().toISOString().slice(0, 10));
  return d == null ? null : d / 30.44;
}

// 5 KPI (parité renderFiches).
const kActifs = computed(() => activeBase.value.filter((e) => statut(e) === 'actif').length);
const kSansAffectation = computed(() => activeBase.value.filter((e) => !siteName(e)).length);
const kSansDotation = computed(() => activeBase.value.filter((e) => dotation(e).length === 0).length);
const kARemplacer = computed(() => activeBase.value.filter((e) => (dotationAgeMonths(e) ?? 0) >= 12).length);
const kSuspendus = computed(() => activeBase.value.filter((e) => statut(e) === 'suspendu').length);
const base = computed(() => Math.max(1, activeBase.value.length));
function pct(n: number): number { return Math.round((n / base.value) * 100); }

const KPIS = computed(() => [
  { label: 'Employés actifs', value: kActifs.value, desc: "Dans l'effectif", color: '#15803d', pct: pct(kActifs.value), filter: '' },
  { label: 'Sans affectation', value: kSansAffectation.value, desc: 'Site à renseigner', color: '#d97706', pct: pct(kSansAffectation.value), filter: '' },
  { label: 'Sans dotation', value: kSansDotation.value, desc: 'Matériel à attribuer', color: '#dc2626', pct: pct(kSansDotation.value), filter: '' },
  { label: 'À remplacer', value: kARemplacer.value, desc: 'Durée de vie dépassée', color: '#7c3aed', pct: pct(kARemplacer.value), filter: '' },
  { label: 'Employés suspendus', value: kSuspendus.value, desc: 'Suspension en cours', color: '#dc2626', pct: pct(kSuspendus.value), filter: 'suspendu' },
]);

// Options de filtre.
const siteOptions = computed(() => [...new Set(all.value.map(siteName).filter(Boolean))].sort());
const posteOptions = computed(() => [...new Set(all.value.map(poste).filter(Boolean))].sort());
const STATUTS = [
  { value: 'actif', label: 'Actif' }, { value: 'congé', label: 'Congé' }, { value: 'maladie', label: 'Maladie' },
  { value: 'suspendu', label: 'Suspendu' }, { value: 'absent', label: 'Absent' },
  { value: 'abandon', label: 'Abandon' }, { value: 'sortant', label: 'Sortant / archivé' },
];

function matchStatut(e: Employee): boolean {
  if (!fStatut.value) return true;
  const st = statut(e);
  if (fStatut.value === 'sortant') return isSortant(e);
  if (fStatut.value === 'congé') return ['conge', 'congé', 'en_conge'].includes(st);
  return st === fStatut.value;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return all.value.filter((e) => {
    if (fStatut.value !== 'sortant' && isSortant(e) && !fStatut.value) return false; // masquer sortants par défaut
    if (!matchStatut(e)) return false;
    if (fSite.value && siteName(e) !== fSite.value) return false;
    if (fPoste.value && poste(e) !== fPoste.value) return false;
    if (q && !`${nom(e)} ${prenom(e)} ${matricule(e)}`.toLowerCase().includes(q)) return false;
    return true;
  });
});

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const sorted = computed(() => {
  const arr = [...filtered.value];
  switch (sort.value) {
    case 'alpha_desc': return arr.sort((a, b) => collator.compare(fullName(b), fullName(a)));
    case 'recruit_desc': return arr.sort((a, b) => collator.compare(dateRecrutement(b), dateRecrutement(a)));
    case 'recruit_asc': return arr.sort((a, b) => collator.compare(dateRecrutement(a), dateRecrutement(b)));
    case 'age_asc': return arr.sort((a, b) => (ageYears(a) ?? 999) - (ageYears(b) ?? 999));
    case 'age_desc': return arr.sort((a, b) => (ageYears(b) ?? -1) - (ageYears(a) ?? -1));
    case 'alpha_asc':
    default: return arr.sort((a, b) => collator.compare(fullName(a), fullName(b)));
  }
});

// Voyants d'état (parité fpAgentLampStatus, simplifié aux données disponibles).
function lamps(e: Employee): { g: boolean; o: boolean; r: boolean; b: boolean } {
  const l = getLegacy(e);
  const today = new Date().toISOString().slice(0, 10);
  const dCon = daysBetween(today, contractEnd(e));
  let r = false, o = false, b = false;
  if (dCon != null && dCon >= 0 && dCon <= 30) r = true;
  else if (dCon != null && dCon >= 0 && dCon <= 60) o = true;
  const finEssai = String(l.dateFinEssai || e.trial_end_date || '');
  const dE = daysBetween(today, finEssai);
  if (dE != null && dE >= 0 && dE <= 30) o = true;
  if (l.blacklist || l.blacklistContractBlocked || l.contractBlocked) r = true;
  if (Array.isArray(l.sanctions) && l.sanctions.length > 0) o = true;
  if (dotation(e).length === 0) b = true;
  const dotMo = dotationAgeMonths(e);
  if (dotMo != null && dotMo >= 12) r = true;
  else if (dotMo != null && dotMo >= 10) o = true;
  const g = !o && !r && !b;
  return { g, o, r, b };
}

function reset(): void {
  search.value = ''; fSite.value = ''; fPoste.value = ''; fStatut.value = ''; sort.value = 'alpha_asc';
}
function openFiche(e: Employee): void { router.push(`/effectif/agent/${e.id}`); }
function openDocuments(e: Employee): void { router.push(`/effectif/agent/${e.id}`); } // onglet Documents dans la fiche
function fdate(v: unknown): string {
  const d = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? formatFR(d.slice(0, 10)) : '—';
}
</script>

<template>
  <div>
    <div class="fp-head">
      <div>
        <h1 class="sg-page-title">Fiches de position — toutes</h1>
        <p class="sg-page-sub">Consultez et gérez les fiches de vos employés · {{ session.activeSociety ?? 'Toutes les sociétés' }}</p>
      </div>
      <div class="fp-head__actions">
        <button class="sg-btn sg-btn-ghost sg-btn-sm" @click="router.push('/fiches/imprimer')">Imprimer</button>
        <button class="sg-btn sg-btn-sm" @click="router.push('/fiches/badge')">Badges</button>
      </div>
    </div>

    <p v-if="error" class="sg-alert">{{ error }}</p>
    <p v-if="loading" class="sg-page-sub">Chargement…</p>

    <template v-else>
      <!-- 5 KPI -->
      <div class="fp-kpis">
        <div v-for="k in KPIS" :key="k.label" class="fp-kpi" :style="{ '--c': k.color }" @click="k.filter && (fStatut = k.filter)">
          <div class="fp-kpi__body">
            <span class="fp-kpi__lbl">{{ k.label }}</span>
            <strong class="fp-kpi__num">{{ k.value }}</strong>
            <small class="fp-kpi__desc">{{ k.desc }}</small>
          </div>
          <span class="fp-kpi__pct">{{ k.pct }}%</span>
        </div>
      </div>

      <!-- Filtres -->
      <section class="sg-card fp-filters">
        <div class="fp-filters__main">
          <input v-model="search" class="sg-input fp-search" type="search" placeholder="Rechercher par nom ou matricule…" />
          <label class="fp-qf"><span>Site</span><select v-model="fSite" class="sg-select"><option value="">Tous les sites</option><option v-for="s in siteOptions" :key="s" :value="s">{{ s }}</option></select></label>
          <label class="fp-qf"><span>Poste</span><select v-model="fPoste" class="sg-select"><option value="">Tous les postes</option><option v-for="p in posteOptions" :key="p" :value="p">{{ p }}</option></select></label>
          <label class="fp-qf"><span>Statut</span><select v-model="fStatut" class="sg-select"><option value="">Tous les statuts</option><option v-for="s in STATUTS" :key="s.value" :value="s.value">{{ s.label }}</option></select></label>
        </div>
        <div class="fp-filters__foot">
          <div class="fp-count"><strong>{{ sorted.length }}</strong> fiche{{ sorted.length !== 1 ? 's' : '' }} affichée{{ sorted.length !== 1 ? 's' : '' }}</div>
          <div class="fp-controls">
            <label>Trier par</label>
            <select v-model="sort" class="sg-select">
              <option value="alpha_asc">Alphabétique A-Z</option>
              <option value="alpha_desc">Alphabétique Z-A</option>
              <option value="recruit_desc">Recrutement récent d'abord</option>
              <option value="recruit_asc">Recrutement ancien d'abord</option>
              <option value="age_asc">Âge croissant</option>
              <option value="age_desc">Âge décroissant</option>
            </select>
            <div class="fp-layout">
              <button :class="{ active: layout === 'mosaique' }" title="Mosaïque" @click="layout = 'mosaique'">▦</button>
              <button :class="{ active: layout === 'liste' }" title="Liste" @click="layout = 'liste'">☰</button>
            </div>
            <button class="sg-btn sg-btn-ghost sg-btn-sm" @click="reset">Réinitialiser</button>
          </div>
        </div>
      </section>

      <div v-if="!sorted.length" class="sg-card fp-empty">Aucune fiche.</div>

      <!-- Mosaïque -->
      <div v-else-if="layout === 'mosaique'" class="fp-grid">
        <div v-for="e in sorted" :key="e.id" class="sg-card fp-card">
          <div class="fp-lamps">
            <span class="fp-lamp fp-lamp--g" :class="{ off: !lamps(e).g }" title="Statut général OK"></span>
            <span class="fp-lamp fp-lamp--o" :class="{ off: !lamps(e).o }" title="Alerte : sanction / absence / essai / contrat J-60"></span>
            <span class="fp-lamp fp-lamp--r" :class="{ off: !lamps(e).r }" title="Danger : blacklist / dotation 12+ mois / contrat J-30"></span>
            <span class="fp-lamp fp-lamp--b" :class="{ off: !lamps(e).b }" title="Employé non doté"></span>
          </div>
          <div class="fp-card__head">
            <span class="fp-avatar"><img v-if="photo(e)" :src="photo(e)" alt="" /><template v-else>{{ (prenom(e) || '?')[0] }}</template></span>
            <div class="fp-card__id">
              <div class="fp-card__name">{{ fullName(e) }}</div>
              <div class="fp-card__code" :style="{ color: statut(e) === 'actif' ? '#047857' : '#d97706' }">{{ matricule(e) }}</div>
            </div>
          </div>
          <div class="fp-card__facts">
            <div><span>Société :</span> {{ societe(e) || '—' }}</div>
            <div><span>Poste :</span> {{ poste(e) || '—' }}</div>
            <div><span>Site :</span> {{ siteName(e) || '—' }}</div>
            <div><span>Contrat :</span> {{ typeContrat(e) }} · Fin le {{ fdate(contractEnd(e)) }}</div>
          </div>
          <div class="fp-card__actions">
            <div class="fp-card__btns">
              <button class="sg-btn sg-btn-sm" @click="openFiche(e)">Ouvrir fiche</button>
              <button class="sg-btn sg-btn-ghost sg-btn-sm" @click="openDocuments(e)">Documents</button>
            </div>
            <span class="sg-pill" :class="statusPill(e).cls">{{ statusPill(e).label }}</span>
          </div>
        </div>
      </div>

      <!-- Liste -->
      <div v-else class="sg-card fp-tablewrap">
        <table class="fp-table">
          <thead><tr><th>Code</th><th>Employé</th><th>Société</th><th>Poste</th><th>Site</th><th>Contrat</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            <tr v-for="e in sorted" :key="e.id" class="fp-row" @click="openFiche(e)">
              <td class="fp-mono" :style="{ color: statut(e) === 'actif' ? '#047857' : '#d97706' }">{{ matricule(e) }}</td>
              <td><div class="fp-card__name">{{ fullName(e) }}</div></td>
              <td>{{ societe(e) || '—' }}</td>
              <td>{{ poste(e) || '—' }}</td>
              <td>{{ siteName(e) || '—' }}</td>
              <td>{{ typeContrat(e) }} · {{ fdate(contractEnd(e)) }}</td>
              <td><span class="sg-pill" :class="statusPill(e).cls">{{ statusPill(e).label }}</span></td>
              <td @click.stop><button class="sg-btn sg-btn-ghost sg-btn-sm" @click="openFiche(e)">Ouvrir →</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sg-space-3); margin-bottom: var(--sg-space-4); flex-wrap: wrap; }
.fp-head__actions { display: flex; gap: var(--sg-space-2); }
.fp-kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sg-space-3); margin-bottom: var(--sg-space-4); }
@media (min-width: 700px) { .fp-kpis { grid-template-columns: repeat(5, 1fr); } }
.fp-kpi { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: var(--sg-space-4); background: var(--sg-surface); border: 1px solid var(--sg-border); border-left: 3px solid var(--c); border-radius: var(--sg-radius); cursor: pointer; }
.fp-kpi:hover { background: var(--sg-surface-2); }
.fp-kpi__body { display: flex; flex-direction: column; gap: 2px; }
.fp-kpi__lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--sg-text-muted); }
.fp-kpi__num { font-size: 30px; font-weight: 900; line-height: 1; color: var(--c); }
.fp-kpi__desc { font-size: 11px; color: var(--sg-text-muted); }
.fp-kpi__pct { font-size: 12px; font-weight: 800; color: var(--c); }
.fp-filters { padding: var(--sg-space-4); margin-bottom: var(--sg-space-4); }
.fp-filters__main { display: grid; grid-template-columns: 1fr; gap: var(--sg-space-3); }
@media (min-width: 800px) { .fp-filters__main { grid-template-columns: 2fr 1fr 1fr 1fr; align-items: end; } }
.fp-qf { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 700; color: var(--sg-text-muted); text-transform: uppercase; }
.fp-filters__foot { display: flex; align-items: center; justify-content: space-between; gap: var(--sg-space-3); margin-top: var(--sg-space-3); flex-wrap: wrap; }
.fp-count strong { font-size: 18px; }
.fp-controls { display: flex; align-items: center; gap: var(--sg-space-2); flex-wrap: wrap; }
.fp-controls label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--sg-text-muted); }
.fp-layout { display: inline-flex; border: 1px solid var(--sg-border); border-radius: var(--sg-radius-sm); overflow: hidden; }
.fp-layout button { padding: 4px 10px; font-size: 15px; background: var(--sg-surface); border: none; cursor: pointer; color: var(--sg-text-muted); }
.fp-layout button.active { background: var(--sg-brand-soft); color: var(--sg-brand-700); }
.fp-empty { padding: var(--sg-space-8); text-align: center; color: var(--sg-text-muted); }
.fp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--sg-space-4); }
.fp-card { position: relative; padding: var(--sg-space-4); }
.fp-lamps { position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column; gap: 4px; }
.fp-lamp { width: 9px; height: 9px; border-radius: 999px; }
.fp-lamp--g { background: #16a34a; } .fp-lamp--o { background: #f59e0b; } .fp-lamp--r { background: #dc2626; } .fp-lamp--b { background: #2563eb; }
.fp-lamp.off { background: #e2e8f0; }
.fp-card__head { display: flex; align-items: center; gap: 12px; margin-bottom: var(--sg-space-3); }
.fp-avatar { width: 52px; height: 52px; border-radius: 999px; background: var(--sg-brand-soft); color: var(--sg-brand-700); display: grid; place-items: center; font-weight: 800; font-size: 18px; overflow: hidden; flex-shrink: 0; }
.fp-avatar img { width: 100%; height: 100%; object-fit: cover; }
.fp-card__name { font-weight: 700; }
.fp-card__code { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 900; font-size: 18px; }
.fp-card__facts { font-size: 12px; color: var(--sg-text); display: flex; flex-direction: column; gap: 3px; margin-bottom: var(--sg-space-3); }
.fp-card__facts span { color: var(--sg-text-muted); }
.fp-card__actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fp-card__btns { display: flex; gap: 6px; flex-wrap: wrap; }
.fp-tablewrap { overflow-x: auto; }
.fp-table { width: 100%; border-collapse: collapse; font-size: var(--sg-fs-sm); }
.fp-table th { text-align: left; padding: 10px 12px; color: var(--sg-text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--sg-border); }
.fp-table td { padding: 10px 12px; border-bottom: 1px solid var(--sg-border); }
.fp-row { cursor: pointer; } .fp-row:hover { background: var(--sg-surface-2); }
.fp-mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 800; }
</style>
