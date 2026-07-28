<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Employee } from '@sgdi/shared';
import { employeesApi } from '@/api';
import { ageYears, statut, statusPill } from '@/utils/employees';
import { formatFR } from '@/utils/incidents';
import {
  WILAYAS, BANQUES_ALGERIE, SITUATIONS, SEXES, HABILITATIONS, DOCUMENTS,
  hydrateForm, buildPayload, completeness, completenessRingClass,
  conges, absencesEvents, gestionEvents, sanctions, affectations, affectationCourante,
  contratsHistorique, dotation, documentsMap, isBlacklisted,
  type FicheForm,
} from '@/utils/employeeFiche';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const employee = ref<Employee | null>(null);
const form = ref<FicheForm | null>(null);
const snapshot = ref('');
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const editMode = ref(false);
const activeTab = ref('identite');

type Tab = { key: string; label: string };
const TABS: Tab[] = [
  { key: 'identite', label: 'Informations personnelles' },
  { key: 'habilitations', label: 'Habilitations' },
  { key: 'contrat', label: 'RH / contrat' },
  { key: 'conges', label: 'Congés' },
  { key: 'absences', label: 'Absences' },
  { key: 'carriere', label: 'Carrière' },
  { key: 'pointage', label: 'Pointage' },
  { key: 'verifications', label: 'Documents archivés' },
  { key: 'materiel', label: 'Matériel' },
  { key: 'affectation', label: 'Affectation' },
  { key: 'sanctions', label: 'Sanctions' },
  { key: 'portail', label: 'Portail RH' },
];

const locked = computed(() => (employee.value?.locked ?? 1) === 1);
const editable = computed(() => editMode.value && !saving.value);
const dirty = computed(() => form.value != null && JSON.stringify(form.value) !== snapshot.value);

async function load(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    const e = await employeesApi.get(id);
    employee.value = e;
    form.value = hydrateForm(e);
    snapshot.value = JSON.stringify(form.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Chargement impossible';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const comp = computed(() => (form.value && employee.value ? completeness(form.value, employee.value) : { pct: 0, filled: 0, missing: [] }));
const age = computed(() => (employee.value ? ageYears(employee.value) : null));
const pill = computed(() => (employee.value ? statusPill(employee.value) : { label: '', cls: '' }));

function addFamille(): void {
  form.value?.famille.push({ nom: '', prenom: '', ddn: '', commentaire: '' });
}
function removeFamille(i: number): void {
  form.value?.famille.splice(i, 1);
}
function familleAge(ddn: unknown): string {
  const d = String(ddn ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return '—';
  const b = new Date(d); const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return `${a}`;
}

async function save(): Promise<void> {
  if (!employee.value || !form.value) return;
  if (!form.value.nom.trim() || !form.value.prenom.trim()) { error.value = 'Nom et prénom obligatoires.'; return; }
  saving.value = true; error.value = '';
  try {
    const updated = await employeesApi.update(employee.value.id, buildPayload(employee.value, form.value));
    employee.value = updated;
    form.value = hydrateForm(updated);
    snapshot.value = JSON.stringify(form.value);
    editMode.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Enregistrement refusé';
  } finally {
    saving.value = false;
  }
}
function cancelEdit(): void {
  if (employee.value) { form.value = hydrateForm(employee.value); snapshot.value = JSON.stringify(form.value); }
  editMode.value = false;
}
function goBack(): void { router.push('/effectif'); }

function docStatus(key: string): { archived: boolean; date: string; url: string } {
  const d = documentsMap(employee.value as Employee)[key] ?? {};
  const url = String((d as Record<string, unknown>).url ?? '');
  return { archived: Boolean(url), date: String((d as Record<string, unknown>).date ?? ''), url };
}
const docCount = computed(() => DOCUMENTS.filter((d) => docStatus(d.key).archived).length);

function fdate(v: unknown): string {
  const d = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? formatFR(d.slice(0, 10)) : (d || '—');
}
</script>

<template>
  <div>
    <div class="ef-top">
      <button class="sg-btn sg-btn-ghost sg-btn-sm" @click="goBack">← Retour</button>
      <div class="ef-top__actions">
        <button v-if="!editMode" class="sg-btn sg-btn-sm" @click="editMode = true">✎ Modifier</button>
        <template v-else>
          <button class="sg-btn sg-btn-ghost sg-btn-sm" :disabled="saving" @click="cancelEdit">Annuler</button>
          <button class="sg-btn sg-btn-sm" :disabled="!dirty || saving" @click="save">{{ saving ? 'Enregistrement…' : '✓ Enregistrer' }}</button>
        </template>
      </div>
    </div>

    <p v-if="error" class="sg-alert">{{ error }}</p>
    <p v-if="loading" class="sg-page-sub">Chargement…</p>

    <template v-else-if="employee && form">
      <!-- Carte profil (lecture seule) -->
      <div class="sg-card ef-profile">
        <div class="ef-photo">
          <img v-if="form.photo" :src="form.photo" alt="" />
          <span v-else class="ef-photo__ph">PHOTO</span>
        </div>
        <div class="ef-profile__grid">
          <div><span class="ef-lbl">Code</span><span class="ef-code" :class="{ 'ef-code--op': statut(employee) === 'actif' }">{{ employee.code || '—' }}</span></div>
          <div><span class="ef-lbl">Recrutement</span>{{ fdate(form.dateRecrutement) }}</div>
          <div><span class="ef-lbl">Nom</span>{{ form.nom || '—' }}</div>
          <div><span class="ef-lbl">Prénom</span>{{ form.prenom || '—' }}</div>
          <div><span class="ef-lbl">Téléphone</span>{{ form.telephone || '—' }}</div>
          <div><span class="ef-lbl">Société</span>{{ employee.society || '—' }}</div>
          <div><span class="ef-lbl">Âge</span>{{ age != null ? age + ' ans' : '—' }}</div>
          <div><span class="ef-lbl">Catégorie</span>{{ form.fonction || '—' }}</div>
          <div><span class="ef-lbl">Affectation</span>{{ affectationCourante(employee).siteName || 'Sans affectation' }}</div>
          <div><span class="ef-lbl">Fin de contrat</span>{{ fdate(form.dateFinContrat) }}</div>
        </div>
      </div>

      <!-- Chips -->
      <div class="ef-chips">
        <span class="sg-pill" :class="pill.cls">{{ pill.label }}</span>
        <span v-if="isBlacklisted(employee)" class="sg-pill sg-pill--red">⛔ BLACK LIST</span>
        <span v-if="locked" class="sg-pill sg-pill--gray">🔒 Fiche officielle verrouillée</span>
        <span v-else class="sg-pill sg-pill--green">Modification autorisée</span>
      </div>

      <!-- Complétude -->
      <div class="sg-card ef-comp">
        <div class="ef-ring" :class="completenessRingClass(comp.pct)">{{ comp.pct }}%</div>
        <div class="ef-comp__body">
          <div class="ef-comp__count">{{ comp.filled }}/20 informations renseignées</div>
          <div v-if="comp.missing.length" class="ef-comp__missing">À compléter : {{ comp.missing.join(', ') }}</div>
          <div v-else class="ef-comp__missing">Fiche complète ✓</div>
        </div>
      </div>

      <!-- Onglets -->
      <nav class="ef-tabs">
        <button v-for="t in TABS" :key="t.key" class="ef-tab" :class="{ 'ef-tab--active': activeTab === t.key }" @click="activeTab = t.key">{{ t.label }}</button>
      </nav>

      <!-- ONGLET 1 · IDENTITE -->
      <section v-show="activeTab === 'identite'" class="sg-card ef-pane">
        <h3 class="ef-h3">Informations personnelles</h3>
        <div class="ef-form">
          <label class="sg-field"><span>Nom *</span><input v-model="form.nom" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Prénom *</span><input v-model="form.prenom" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Nom du père</span><input v-model="form.nomPere" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Nom de la mère</span><input v-model="form.nomMere" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Adresse</span><input v-model="form.adresse" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Wilaya</span><select v-model="form.wilaya" class="sg-select" :disabled="!editable"><option value="">—</option><option v-for="w in WILAYAS" :key="w" :value="w">{{ w }}</option></select></label>
          <label class="sg-field"><span>Commune</span><input v-model="form.commune" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>NIN</span><input v-model="form.nin" class="sg-input" inputmode="numeric" :disabled="!editable" /></label>
          <label class="sg-field"><span>N° SS C/Chiffa</span><input v-model="form.numeroCnas" class="sg-input" inputmode="numeric" :disabled="!editable" /></label>
          <label class="sg-field"><span>Numéro de téléphone</span><input v-model="form.telephone" class="sg-input" inputmode="tel" :disabled="!editable" /></label>
          <label class="sg-field"><span>N° PP / CIN</span><input v-model="form.numeroPasseport" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Email</span><input v-model="form.email" class="sg-input" inputmode="email" :disabled="!editable" /></label>
          <label class="sg-field"><span>Compte bancaire</span><select v-model="form.banque" class="sg-select" :disabled="!editable"><option value="">— Choisir la banque —</option><option v-for="b in BANQUES_ALGERIE" :key="b" :value="b">{{ b }}</option></select></label>
          <label class="sg-field"><span>N° Compte</span><input v-model="form.numeroCompte" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Date de naissance</span><input v-model="form.dateNaissance" class="sg-input" type="date" :disabled="!editable" /></label>
          <label class="sg-field"><span>Âge</span><input :value="age != null ? age : ''" class="sg-input" readonly disabled /></label>
          <label class="sg-field"><span>Sexe</span><select v-model="form.sexe" class="sg-select" :disabled="!editable"><option value="">—</option><option v-for="s in SEXES" :key="s" :value="s">{{ s }}</option></select></label>
          <label class="sg-field"><span>Lieu de naissance</span><input v-model="form.lieuNaissance" class="sg-input" :disabled="!editable" /></label>
        </div>

        <h3 class="ef-h3">Informations en cas de problèmes</h3>
        <div class="ef-form">
          <label class="sg-field"><span>Nom du contact</span><input v-model="form.contactUrgenceNom" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Relation avec le contact</span><input v-model="form.contactUrgenceLien" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Téléphone du contact</span><input v-model="form.contactUrgenceTel" class="sg-input" inputmode="tel" :disabled="!editable" /></label>
          <label class="sg-field ef-field--full"><span>Notes spécifiques</span><textarea v-model="form.noteUrgence" class="sg-textarea" rows="4" :disabled="!editable"></textarea></label>
        </div>

        <h3 class="ef-h3">Statut de la famille</h3>
        <div class="ef-form">
          <label class="sg-field"><span>Situation familiale</span><select v-model="form.situation" class="sg-select" :disabled="!editable"><option value="">—</option><option v-for="s in SITUATIONS" :key="s" :value="s">{{ s }}</option></select></label>
          <label class="sg-field"><span>Nombre d'enfant</span><input v-model.number="form.nombreEnfants" class="sg-input" type="number" min="0" :disabled="!editable" /></label>
        </div>
        <div class="ef-tablewrap">
          <table class="ef-table">
            <thead><tr><th>Nom</th><th>Prénom</th><th>Date de naissance</th><th>Âge</th><th>Commentaire</th><th v-if="editable"></th></tr></thead>
            <tbody>
              <tr v-for="(m, i) in form.famille" :key="i">
                <td><input v-model="m.nom" class="sg-input sg-input-sm" :disabled="!editable" /></td>
                <td><input v-model="m.prenom" class="sg-input sg-input-sm" :disabled="!editable" /></td>
                <td><input v-model="m.ddn" class="sg-input sg-input-sm" type="date" :disabled="!editable" /></td>
                <td>{{ familleAge(m.ddn) }}</td>
                <td><input v-model="m.commentaire" class="sg-input sg-input-sm" :disabled="!editable" /></td>
                <td v-if="editable"><button class="sg-btn sg-btn-ghost sg-btn-sm" @click="removeFamille(i)">×</button></td>
              </tr>
              <tr v-if="!form.famille.length"><td colspan="6" class="ef-empty-cell">Aucun membre.</td></tr>
            </tbody>
          </table>
          <button v-if="editable" class="sg-btn sg-btn-ghost sg-btn-sm" @click="addFamille">＋ Ajouter un membre</button>
        </div>
      </section>

      <!-- ONGLET 2 · HABILITATIONS -->
      <section v-show="activeTab === 'habilitations'" class="sg-card ef-pane">
        <h3 class="ef-h3">Habilitations</h3>
        <div class="ef-hab">
          <div v-for="h in HABILITATIONS" :key="h.key" class="ef-hab__row">
            <span>{{ h.label }}</span>
            <label class="ef-radio"><input type="radio" :value="'oui'" v-model="form.habilitations[h.key]" :disabled="!editable" /> Oui</label>
            <label class="ef-radio"><input type="radio" :value="'non'" v-model="form.habilitations[h.key]" :disabled="!editable" /> Non</label>
          </div>
        </div>
        <h3 class="ef-h3">Langues</h3>
        <div class="ef-chips">
          <span v-for="(lg, i) in form.langues" :key="i" class="sg-pill sg-pill--gray">{{ lg }}</span>
          <span v-if="!form.langues.length" class="sg-page-sub">Aucune langue renseignée.</span>
        </div>
      </section>

      <!-- ONGLET 3 · CONTRAT -->
      <section v-show="activeTab === 'contrat'" class="sg-card ef-pane">
        <h3 class="ef-h3">RH / contrat</h3>
        <div class="ef-form">
          <label class="sg-field"><span>Fonction de l'employé</span><input v-model="form.fonction" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Type de contrat</span><input v-model="form.typeContrat" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Salaire net</span><input v-model="form.salaireNet" class="sg-input" inputmode="decimal" placeholder="45 000,00" :disabled="!editable" /></label>
          <label class="sg-field"><span>Date début contrat</span><input v-model="form.dateRecrutement" class="sg-input" type="date" :disabled="!editable" /></label>
          <label class="sg-field"><span>Durée du contrat</span><input v-model="form.dureeContrat" class="sg-input" :disabled="!editable" /></label>
          <label class="sg-field"><span>Fin de contrat</span><input v-model="form.dateFinContrat" class="sg-input" type="date" :disabled="!editable" /></label>
          <label class="sg-field"><span>Durée période d'essai (jours)</span><input v-model.number="form.dureeEssai" class="sg-input" type="number" min="0" :disabled="!editable" /></label>
          <label class="sg-field"><span>Fin essai</span><input v-model="form.dateFinEssai" class="sg-input" type="date" :disabled="!editable" /></label>
        </div>
        <h3 class="ef-h3">Historique des contrats</h3>
        <div class="ef-tablewrap">
          <table class="ef-table">
            <thead><tr><th>Référence</th><th>Type</th><th>Début</th><th>Durée</th><th>Fin</th><th>Salaire net</th><th>Statut</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in contratsHistorique(employee)" :key="i">
                <td>{{ c.reference || '—' }}</td><td>{{ c.type || '—' }}</td><td>{{ fdate(c.debut) }}</td>
                <td>{{ c.duree || '—' }}</td><td>{{ fdate(c.fin) }}</td><td>{{ c.salaireNet || '—' }}</td>
                <td><span class="sg-pill sg-pill--gray">{{ c.statut || '—' }}</span></td>
              </tr>
              <tr v-if="!contratsHistorique(employee).length"><td colspan="7" class="ef-empty-cell">Aucun contrat.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ONGLET 4 · CONGES -->
      <section v-show="activeTab === 'conges'" class="sg-card ef-pane">
        <div class="ef-kpi3">
          <div class="ef-kpi3__c"><span>{{ conges(employee).length }}</span>Total congés</div>
          <div class="ef-kpi3__c"><span>{{ conges(employee).filter((c) => String(c.statut).toLowerCase() === 'approuve').length }}</span>Approuvés</div>
          <div class="ef-kpi3__c"><span>{{ conges(employee).filter((c) => String(c.statut).toLowerCase().includes('attente')).length }}</span>En attente</div>
        </div>
        <div class="ef-tablewrap">
          <table class="ef-table">
            <thead><tr><th>Type</th><th>Du</th><th>Au</th><th>Jours</th><th>Statut</th><th>Motif</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in conges(employee)" :key="i">
                <td>{{ c.type || '—' }}</td><td>{{ fdate(c.du) }}</td><td>{{ fdate(c.au) }}</td>
                <td>{{ c.jours || '—' }}</td><td><span class="sg-pill sg-pill--gray">{{ c.statut || '—' }}</span></td><td>{{ c.motif || '—' }}</td>
              </tr>
              <tr v-if="!conges(employee).length"><td colspan="6" class="ef-empty-cell">Aucun congé enregistré.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ONGLET 5 · ABSENCES -->
      <section v-show="activeTab === 'absences'" class="sg-card ef-pane">
        <div class="ef-kpi3">
          <div class="ef-kpi3__c"><span>{{ absencesEvents(employee).length }}</span>Total absences</div>
          <div class="ef-kpi3__c"><span>{{ absencesEvents(employee).filter((c) => String(c.statut).toLowerCase().includes('cours')).length }}</span>En cours</div>
          <div class="ef-kpi3__c"><span>{{ absencesEvents(employee).filter((c) => String(c.type).toLowerCase() === 'maladie').length }}</span>Maladie</div>
        </div>
        <div class="ef-tablewrap">
          <table class="ef-table">
            <thead><tr><th>Type</th><th>Du</th><th>Au</th><th>Jours</th><th>Statut</th><th>Source</th><th>Motif</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in absencesEvents(employee)" :key="i">
                <td><span class="sg-pill sg-pill--gray">{{ c.type || '—' }}</span></td><td>{{ fdate(c.du) }}</td><td>{{ fdate(c.au) }}</td>
                <td>{{ c.jours || '—' }}</td><td>{{ c.statut || '—' }}</td><td>{{ c.source || '—' }}</td><td>{{ c.motif || '—' }}</td>
              </tr>
              <tr v-if="!absencesEvents(employee).length"><td colspan="7" class="ef-empty-cell">Aucune absence enregistrée.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ONGLET 6 · CARRIERE -->
      <section v-show="activeTab === 'carriere'" class="sg-card ef-pane">
        <h3 class="ef-h3">Carrière de l'employé</h3>
        <div class="ef-tablewrap">
          <table class="ef-table">
            <thead><tr><th>Type</th><th>Du</th><th>Au</th><th>Jours</th><th>Motif</th><th>Statut</th></tr></thead>
            <tbody>
              <tr v-for="(g, i) in gestionEvents(employee)" :key="i">
                <td><span class="sg-pill sg-pill--gray">{{ g.type || '—' }}</span></td><td>{{ fdate(g.du) }}</td><td>{{ fdate(g.au) }}</td>
                <td>{{ g.jours || '—' }}</td><td>{{ g.motif || '—' }}</td><td><span class="sg-pill sg-pill--gray">{{ g.statut || '—' }}</span></td>
              </tr>
              <tr v-if="!gestionEvents(employee).length"><td colspan="6" class="ef-empty-cell">Aucun événement enregistré.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ONGLET 7 · POINTAGE -->
      <section v-show="activeTab === 'pointage'" class="sg-card ef-pane">
        <p class="sg-page-sub">Situation Pointage — synchronisée depuis le module Pointage.</p>
        <div class="ef-empty-cell">Aucun pointage enregistré pour cet agent.</div>
      </section>

      <!-- ONGLET 8 · VERIFICATIONS -->
      <section v-show="activeTab === 'verifications'" class="sg-card ef-pane">
        <h3 class="ef-h3">Documents archivés — {{ docCount }}/9</h3>
        <div class="ef-progress"><div class="ef-progress__bar" :style="{ width: (docCount / 9 * 100) + '%' }"></div></div>
        <div class="ef-docs">
          <div v-for="d in DOCUMENTS" :key="d.key" class="ef-doc" :class="{ 'ef-doc--ok': docStatus(d.key).archived }">
            <div class="ef-doc__name">{{ d.label }}</div>
            <div class="ef-doc__status">{{ docStatus(d.key).archived ? 'Archivé' : 'Manquant' }}<span v-if="docStatus(d.key).date"> · {{ fdate(docStatus(d.key).date) }}</span></div>
            <a v-if="docStatus(d.key).archived" :href="docStatus(d.key).url" target="_blank" rel="noopener" class="sg-btn sg-btn-ghost sg-btn-sm">Visualiser</a>
          </div>
        </div>
      </section>

      <!-- ONGLET 9 · MATERIEL -->
      <section v-show="activeTab === 'materiel'" class="sg-card ef-pane">
        <h3 class="ef-h3">Dotation matériel</h3>
        <div class="ef-tablewrap">
          <table class="ef-table">
            <thead><tr><th>Date dotation</th><th>Code</th><th>Article</th><th>Qté</th><th>Prix unitaire</th><th>Valeur</th><th>Motif</th><th>N° bon</th><th>Date reversement</th></tr></thead>
            <tbody>
              <tr v-for="(m, i) in dotation(employee)" :key="i">
                <td>{{ fdate(m.date) }}</td><td>{{ m.code || '—' }}</td><td>{{ m.article || '—' }}</td><td>{{ m.quantite || m.qte || '—' }}</td>
                <td>{{ m.prixUnitaire || '—' }}</td><td>{{ m.valeur || '—' }}</td><td>{{ m.motif || '—' }}</td><td>{{ m.numeroBon || '—' }}</td><td>{{ fdate(m.dateReversement) }}</td>
              </tr>
              <tr v-if="!dotation(employee).length"><td colspan="9" class="ef-empty-cell">Aucune dotation enregistrée.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ONGLET 10 · AFFECTATION -->
      <section v-show="activeTab === 'affectation'" class="sg-card ef-pane">
        <h3 class="ef-h3">Historique des affectations</h3>
        <div class="ef-tablewrap">
          <table class="ef-table">
            <thead><tr><th>Affectation</th><th>Site</th><th>Poste</th><th>Du</th><th>Au</th><th>Motif</th></tr></thead>
            <tbody>
              <tr v-if="affectationCourante(employee).siteName">
                <td><span class="sg-pill sg-pill--green">Actuelle</span></td>
                <td>{{ affectationCourante(employee).siteName }}</td><td>{{ affectationCourante(employee).poste || '—' }}</td>
                <td>{{ fdate(affectationCourante(employee).du) }}</td><td>—</td><td>{{ affectationCourante(employee).motif || '—' }}</td>
              </tr>
              <tr v-for="(a, i) in affectations(employee)" :key="i">
                <td>Affectation {{ affectations(employee).length - i }}</td><td>{{ a.siteName || '—' }}</td><td>{{ a.poste || '—' }}</td>
                <td>{{ fdate(a.du) }}</td><td>{{ fdate(a.au) }}</td><td>{{ a.motif || '—' }}</td>
              </tr>
              <tr v-if="!affectations(employee).length && !affectationCourante(employee).siteName"><td colspan="6" class="ef-empty-cell">Aucune.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ONGLET 11 · SANCTIONS -->
      <section v-show="activeTab === 'sanctions'" class="sg-card ef-pane">
        <h3 class="ef-h3">Sanctions</h3>
        <div class="ef-tablewrap">
          <table class="ef-table">
            <thead><tr><th>Infraction</th><th>Site</th><th>Indicatif</th><th>Faute</th><th>Sanction</th><th>Mise à pied</th><th>Début</th><th>Reprise</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in sanctions(employee)" :key="i">
                <td>{{ s.infraction || '—' }}</td><td>{{ s.site || '—' }}</td><td>{{ s.indicatif || '—' }}</td><td>{{ s.faute || '—' }}</td>
                <td><span class="sg-pill sg-pill--amber">{{ s.sanction || '—' }}</span></td><td>{{ s.misePied || '—' }}</td><td>{{ fdate(s.debut) }}</td><td>{{ fdate(s.reprise) }}</td>
              </tr>
              <tr v-if="!sanctions(employee).length"><td colspan="8" class="ef-empty-cell">Aucune.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ONGLET 12 · PORTAIL -->
      <section v-show="activeTab === 'portail'" class="sg-card ef-pane">
        <h3 class="ef-h3">Portail RH</h3>
        <div class="ef-empty-cell">Compte portail — synchronisé depuis le module Portail.</div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ef-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sg-space-4); }
.ef-top__actions { display: flex; gap: var(--sg-space-2); }
.ef-profile { display: flex; gap: var(--sg-space-5); padding: var(--sg-space-4); }
.ef-photo { width: 96px; height: 120px; border-radius: var(--sg-radius); background: var(--sg-surface-2); border: 1px solid var(--sg-border); display: grid; place-items: center; overflow: hidden; flex-shrink: 0; }
.ef-photo img { width: 100%; height: 100%; object-fit: cover; }
.ef-photo__ph { font-size: 11px; font-weight: 800; color: var(--sg-text-muted); }
.ef-profile__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 24px; flex: 1; font-size: var(--sg-fs-sm); }
@media (min-width: 900px) { .ef-profile__grid { grid-template-columns: repeat(5, 1fr); } }
.ef-profile__grid > div { display: flex; flex-direction: column; }
.ef-lbl { font-size: 10px; text-transform: uppercase; color: var(--sg-text-muted); font-weight: 700; }
.ef-code { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 800; color: #b45309; }
.ef-code--op { color: #16a34a; }
.ef-chips { display: flex; flex-wrap: wrap; gap: var(--sg-space-2); margin: var(--sg-space-3) 0; }
.ef-comp { display: flex; align-items: center; gap: var(--sg-space-4); padding: var(--sg-space-4); margin-bottom: var(--sg-space-4); }
.ef-ring { width: 64px; height: 64px; border-radius: 999px; display: grid; place-items: center; font-weight: 900; color: #fff; flex-shrink: 0; }
.ef-ring.good { background: #16a34a; } .ef-ring.medium { background: #f97316; } .ef-ring.low { background: #dc2626; }
.ef-comp__count { font-weight: 700; }
.ef-comp__missing { font-size: 12px; color: var(--sg-text-muted); }
.ef-tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--sg-border); margin-bottom: var(--sg-space-4); }
.ef-tab { padding: 8px 14px; font: inherit; font-weight: 600; font-size: var(--sg-fs-sm); color: var(--sg-text-muted); background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer; }
.ef-tab--active { color: var(--sg-brand-700); border-bottom-color: var(--sg-brand-600); }
.ef-pane { padding: var(--sg-space-5); }
.ef-h3 { font-size: var(--sg-fs-sm); text-transform: uppercase; color: var(--sg-brand-700); font-weight: 800; margin: var(--sg-space-4) 0 var(--sg-space-3); }
.ef-h3:first-child { margin-top: 0; }
.ef-form { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sg-space-3); }
@media (min-width: 900px) { .ef-form { grid-template-columns: repeat(3, 1fr); } }
.sg-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--sg-fs-sm); }
.sg-field > span { font-size: 11px; font-weight: 700; color: var(--sg-text-muted); }
.ef-field--full { grid-column: 1 / -1; }
.ef-tablewrap { overflow-x: auto; margin-top: var(--sg-space-3); }
.ef-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ef-table th { text-align: left; padding: 8px 10px; color: var(--sg-text-muted); font-size: 10px; text-transform: uppercase; border-bottom: 1px solid var(--sg-border); white-space: nowrap; }
.ef-table td { padding: 8px 10px; border-bottom: 1px solid var(--sg-border); }
.ef-empty-cell { text-align: center; color: var(--sg-text-muted); padding: var(--sg-space-5); }
.sg-input-sm { padding: 4px 6px; font-size: 12px; }
.ef-hab { display: flex; flex-direction: column; gap: var(--sg-space-2); }
.ef-hab__row { display: flex; align-items: center; gap: var(--sg-space-4); padding: 8px 0; border-bottom: 1px solid var(--sg-border); font-size: var(--sg-fs-sm); }
.ef-hab__row > span:first-child { flex: 1; }
.ef-radio { display: inline-flex; align-items: center; gap: 4px; }
.ef-kpi3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sg-space-3); margin-bottom: var(--sg-space-3); }
.ef-kpi3__c { display: flex; flex-direction: column; align-items: center; padding: var(--sg-space-3); background: var(--sg-surface-2); border-radius: var(--sg-radius); font-size: 11px; text-transform: uppercase; color: var(--sg-text-muted); font-weight: 700; }
.ef-kpi3__c span { font-size: 26px; font-weight: 900; color: var(--sg-text); }
.ef-progress { height: 8px; background: var(--sg-surface-2); border-radius: 999px; overflow: hidden; margin-bottom: var(--sg-space-3); }
.ef-progress__bar { height: 100%; background: #16a34a; }
.ef-docs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--sg-space-3); }
.ef-doc { padding: var(--sg-space-3); border: 1px solid var(--sg-border); border-radius: var(--sg-radius); }
.ef-doc--ok { border-color: #16a34a; background: #f0fdf4; }
.ef-doc__name { font-weight: 700; font-size: var(--sg-fs-sm); }
.ef-doc__status { font-size: 11px; color: var(--sg-text-muted); margin: 4px 0; }
</style>
