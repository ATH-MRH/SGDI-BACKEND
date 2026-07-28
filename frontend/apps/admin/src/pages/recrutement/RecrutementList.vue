<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Candidate } from '@sgdi/shared';
import { candidatesApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import ModalDialog from '@/components/ModalDialog.vue';
import {
  isNew, isReserve, isArchived, candidateAvis, avisClass, posteLabel, formatPhone,
  societe, wilaya, photo, motifArchive, archivedAt, fullName, ninAlert, ageYears,
} from '@/utils/candidates';
import { formatFR } from '@/utils/incidents';

const props = defineProps<{ mode: 'new' | 'reserve' | 'archive' }>();
const router = useRouter();
const session = useSessionStore();

const all = ref<Candidate[]>([]);
const loading = ref(true);
const error = ref('');
const page = ref(1);
const pageSize = computed(() => (props.mode === 'reserve' ? 15 : 25));

const actionsFor = ref<Candidate | null>(null); // modale « ⋯ » réserve
const archiveFor = ref<Candidate | null>(null); // modale archiver
const archiveMotif = ref('');
const archiveComment = ref('');

const ARCHIVE_MOTIFS = [
  'Dossier incomplet', 'Profil non conforme', 'Âge non conforme', 'Poste non disponible',
  'Candidat non joignable', 'Désistement du candidat', 'Avis défavorable', 'Doublon', 'Autre',
];

const TABS: { mode: 'new' | 'reserve' | 'archive'; label: string; route: string }[] = [
  { mode: 'new', label: 'Nouveaux dossiers', route: '/recrutement' },
  { mode: 'reserve', label: 'Réserve', route: '/reserve' },
  { mode: 'archive', label: 'Archives', route: '/candidats_archives' },
];

const titles = {
  new: { h1: 'Nouvelles candidatures', sub: 'Candidats à présélectionner pour la fiche de renseignement.' },
  reserve: { h1: 'Candidats en réserve', sub: 'Candidats validés, en attente de recrutement.' },
  archive: { h1: 'Candidats archivés', sub: 'Dossiers archivés depuis les nouvelles candidatures et les candidats en réserve.' },
};

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    all.value = await candidatesApi.list({ society: session.activeSociety ?? undefined });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chargement impossible';
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => props.mode, () => { page.value = 1; });

const counts = computed(() => ({
  new: all.value.filter(isNew).length,
  reserve: all.value.filter((c) => isReserve(c)).length,
  archive: all.value.filter(isArchived).length,
}));

const rows = computed(() => {
  const pred = props.mode === 'new' ? isNew : props.mode === 'reserve' ? isReserve : isArchived;
  return all.value.filter(pred);
});
const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize.value)));
const pageRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return rows.value.slice(start, start + pageSize.value);
});

function openFiche(c: Candidate, edit = false): void {
  const base = props.mode === 'archive' ? 'candidats_archives' : props.mode === 'reserve' ? 'reserve' : 'recrutement';
  if (edit) sessionStorage.setItem(`candidatAutoEdit:${c.id}`, '1'); // ouverture directe en édition
  router.push(`/${base}/${c.id}`);
}
function addCandidate(): void {
  router.push('/reserve/nouveau'); // création toujours en réserve (parité legacy)
}

async function changeAvis(c: Candidate, value: string): Promise<void> {
  const previous = candidateAvis(c);
  const data = { ...(c.data ?? {}), avisDecision: value, avisDate: (c.data?.avisDate as string) || new Date().toISOString().slice(0, 10) };
  c.data = data; // optimiste
  try {
    await candidatesApi.update(c.id, { data });
  } catch {
    c.data = { ...(c.data ?? {}), avisDecision: previous }; // rollback
    error.value = 'Mise à jour avis refusée';
  }
}

async function confirmArchive(): Promise<void> {
  if (!archiveFor.value) return;
  if (!archiveMotif.value) { error.value = "Choisissez un motif d'archivage"; return; }
  const c = archiveFor.value;
  const data = {
    ...(c.data ?? {}), motifArchive: archiveMotif.value, commentaireArchive: archiveComment.value,
    archivedAt: new Date().toISOString(), archiveSource: isReserve(c) ? 'reserve' : 'new',
  };
  try {
    await candidatesApi.update(c.id, { status: 'archive', data });
    archiveFor.value = null; archiveMotif.value = ''; archiveComment.value = '';
    await load();
    router.push('/candidats_archives');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Archivage refusé';
  }
}

async function deleteCandidate(c: Candidate): Promise<void> {
  if (!window.confirm(`Supprimer définitivement ${fullName(c)} ?`)) return;
  actionsFor.value = null;
  try {
    await candidatesApi.remove(c.id);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Suppression impossible';
  }
}
</script>

<template>
  <div>
    <div class="sg-page-head">
      <div>
        <h1 class="sg-page-title">{{ titles[mode].h1 }}</h1>
        <p class="sg-page-sub">{{ titles[mode].sub }}</p>
      </div>
    </div>

    <!-- Onglets avec compteurs -->
    <nav class="rc-tabs" aria-label="Recrutement et candidats">
      <button
        v-for="t in TABS" :key="t.mode"
        class="rc-tab" :class="{ 'rc-tab--active': t.mode === mode }"
        @click="router.push(t.route)"
      >
        {{ t.label }} <span class="rc-tab__count">{{ counts[t.mode] }}</span>
      </button>
    </nav>

    <!-- Barre d'import (new/reserve) -->
    <div v-if="mode !== 'archive'" class="rc-import">
      <button class="sg-btn sg-btn-ghost sg-btn-sm" title="Import Excel — à venir" @click="error = 'Import Excel — bientôt disponible'">Modèle Excel</button>
      <button class="sg-btn sg-btn-ghost sg-btn-sm" title="Import Excel — à venir" @click="error = 'Import Excel — bientôt disponible'">Importer Excel</button>
      <button class="sg-btn sg-btn-ghost sg-btn-sm" title="Import Excel — à venir" @click="error = 'Import Excel — bientôt disponible'">Excel libre</button>
      <button class="sg-btn sg-btn-sm" @click="addCandidate">+ Ajouter candidat</button>
    </div>

    <p v-if="error" class="sg-alert">{{ error }}</p>
    <p v-if="loading" class="sg-page-sub">Chargement…</p>
    <div v-else-if="!rows.length" class="sg-card rc-empty">Aucun candidat.</div>

    <div v-else class="sg-card rc-tablewrap">
      <table class="rc-table">
        <thead>
          <tr>
            <th>Candidat</th>
            <th>Poste</th>
            <th>Société</th>
            <template v-if="mode === 'archive'"><th>Origine</th><th>Wilaya</th></template>
            <th>Téléphone</th>
            <th>Avis</th>
            <th>{{ mode === 'archive' ? 'Archivage' : 'Date' }}</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in pageRows" :key="c.id" class="rc-row" @click="mode === 'reserve' ? (actionsFor = c) : openFiche(c)">
            <td>
              <div class="rc-cand">
                <span class="rc-avatar"><img v-if="photo(c)" :src="photo(c)" alt="" /><template v-else>{{ (c.first_name || '?')[0] }}</template></span>
                <div>
                  <div class="rc-name">{{ fullName(c) }}</div>
                  <div class="rc-email">{{ c.email || '' }}</div>
                  <span v-if="ninAlert(c)" class="sg-pill sg-pill--red" title="NIN non conforme">Alerte NIN</span>
                  <span v-if="(ageYears(c) ?? 99) < 20" class="sg-pill sg-pill--red">Alerte âge · {{ ageYears(c) }} ans</span>
                </div>
              </div>
            </td>
            <td>{{ posteLabel(c) }}</td>
            <td><span class="sg-pill sg-pill--gray">{{ societe(c) || '—' }}</span></td>
            <template v-if="mode === 'archive'">
              <td><span class="sg-pill sg-pill--gray">{{ (c.data?.archiveSource === 'reserve') ? 'Candidat en réserve' : 'Candidat' }}</span></td>
              <td>{{ wilaya(c) || '—' }}</td>
            </template>
            <td>{{ formatPhone(c.phone || c.data?.telephone) }}</td>
            <td @click.stop>
              <select class="rc-avis" :class="avisClass(candidateAvis(c))" :value="candidateAvis(c)" @change="changeAvis(c, ($event.target as HTMLSelectElement).value)">
                <option>Favorable</option><option>Défavorable</option><option>Instance</option>
              </select>
            </td>
            <td>
              <template v-if="mode === 'archive'">
                {{ formatFR(archivedAt(c).slice(0, 10)) }}
                <div class="rc-motif">{{ motifArchive(c) || '—' }}</div>
              </template>
              <template v-else>{{ formatFR(c.created_at.slice(0, 10)) }}</template>
            </td>
            <td>
              <span v-if="isArchived(c)" class="sg-pill sg-pill--gray">Archivé</span>
              <span v-else-if="isReserve(c)" class="sg-pill sg-pill--amber">Réserve</span>
              <span v-else class="sg-pill" style="color:#0369a1;background:#e0f2fe">Nouvelle</span>
            </td>
            <td @click.stop>
              <button v-if="mode === 'reserve'" class="sg-btn sg-btn-ghost sg-btn-sm" title="Actions" @click="actionsFor = c">⋯</button>
              <button v-else class="sg-btn sg-btn-ghost sg-btn-sm" @click="openFiche(c)">Ouvrir →</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="rc-foot">
        <span>{{ rows.length }} candidat(s) · page {{ page }}/{{ pages }}</span>
        <span class="rc-foot__nav">
          <button class="sg-btn sg-btn-ghost sg-btn-sm" :disabled="page <= 1" @click="page--">Précédent</button>
          <button class="sg-btn sg-btn-ghost sg-btn-sm" :disabled="page >= pages" @click="page++">Suivant</button>
        </span>
      </div>
    </div>

    <!-- Modale actions (réserve) -->
    <ModalDialog v-if="actionsFor" title="Actions candidat" @close="actionsFor = null">
      <p class="sg-page-sub">{{ fullName(actionsFor) }} · {{ societe(actionsFor) || '—' }}</p>
      <div class="rc-actions">
        <button class="sg-btn sg-btn-secondary" @click="openFiche(actionsFor!)">👁 Afficher</button>
        <button class="sg-btn sg-btn-secondary" @click="openFiche(actionsFor!, true)">✎ Modifier</button>
        <button class="sg-btn sg-btn-ghost" @click="archiveFor = actionsFor; actionsFor = null">🗄 Archiver</button>
        <button class="sg-btn sg-btn-ghost rc-danger" @click="deleteCandidate(actionsFor!)">🗑 Supprimer</button>
      </div>
    </ModalDialog>

    <!-- Modale archiver -->
    <ModalDialog v-if="archiveFor" title="Archiver candidat" @close="archiveFor = null">
      <div class="sg-field">
        <label>Motif *</label>
        <select v-model="archiveMotif" class="sg-select">
          <option value="">— Choisir un motif —</option>
          <option v-for="m in ARCHIVE_MOTIFS" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
      <div class="sg-field" style="margin-top:12px">
        <label>Commentaire</label>
        <textarea v-model="archiveComment" class="sg-textarea" rows="3" placeholder="Précision facultative"></textarea>
      </div>
      <template #footer>
        <button class="sg-btn sg-btn-ghost" @click="archiveFor = null">Annuler</button>
        <button class="sg-btn rc-danger" @click="confirmArchive">Archiver candidat</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.rc-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--sg-border); margin-bottom: var(--sg-space-4); }
.rc-tab {
  padding: 10px 16px; font: inherit; font-weight: 600; font-size: var(--sg-fs-sm);
  color: var(--sg-text-muted); background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer;
}
.rc-tab--active { color: var(--sg-brand-700); border-bottom-color: var(--sg-brand-600); }
.rc-tab__count { display: inline-block; margin-left: 6px; padding: 0 7px; font-size: 11px; border-radius: 999px; background: var(--sg-surface-2); border: 1px solid var(--sg-border); }
.rc-import { display: flex; flex-wrap: wrap; gap: var(--sg-space-2); margin-bottom: var(--sg-space-4); }
.rc-empty { padding: var(--sg-space-8); text-align: center; color: var(--sg-text-muted); }
.rc-tablewrap { overflow-x: auto; }
.rc-table { width: 100%; border-collapse: collapse; font-size: var(--sg-fs-sm); }
.rc-table th { text-align: left; padding: 10px 12px; color: var(--sg-text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--sg-border); }
.rc-table td { padding: 10px 12px; border-bottom: 1px solid var(--sg-border); }
.rc-row { cursor: pointer; }
.rc-row:hover { background: var(--sg-surface-2); }
.rc-cand { display: flex; align-items: center; gap: 10px; }
.rc-avatar { width: 34px; height: 34px; border-radius: 999px; background: var(--sg-brand-soft); color: var(--sg-brand-700); display: grid; place-items: center; font-weight: 800; overflow: hidden; flex-shrink: 0; }
.rc-avatar img { width: 100%; height: 100%; object-fit: cover; }
.rc-name { font-weight: 700; }
.rc-email { font-size: 11px; color: var(--sg-text-muted); }
.rc-motif { font-size: 11px; color: var(--sg-text-muted); }
.rc-avis { padding: 4px 8px; border-radius: var(--sg-radius-sm); border: 1px solid var(--sg-border); font: inherit; font-size: var(--sg-fs-sm); cursor: pointer; }
.avis-favorable { color: #047857; background: #d1fae5; }
.avis-defavorable { color: #b91c1c; background: #fee2e2; }
.avis-instance { color: #b45309; background: #fef3c7; }
.rc-foot { display: flex; align-items: center; justify-content: space-between; padding: 12px; color: var(--sg-text-muted); }
.rc-foot__nav { display: flex; gap: var(--sg-space-2); }
.rc-actions { display: flex; flex-direction: column; gap: var(--sg-space-2); margin-top: var(--sg-space-3); }
.rc-danger { background: var(--sg-danger); }
</style>
