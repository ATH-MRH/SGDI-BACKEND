<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Candidate, CandidateInput } from '@sgdi/shared';
import { candidatesApi, referenceApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import CandidateField from '@/components/candidates/CandidateField.vue';
import ModalDialog from '@/components/ModalDialog.vue';
import { SECTIONS, LANGUES, DUREES_CONTRAT, MOTIFS_DEPART, HABILITATIONS, SERVER_ORDER } from '@/utils/candidateSections';
import type { FieldDef } from '@/utils/candidateSections';
import { candidateAvis } from '@/utils/candidates';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const routeId = computed(() => (route.params.id && route.params.id !== 'nouveau' ? Number(route.params.id) : null));
const reserveDirect = computed(() => route.path.includes('/nouveau'));

const candidate = ref<Candidate | null>(null);
const candidateId = ref<number | null>(null);
const loading = ref(true);
const error = ref('');
const busy = ref(false);

const form = reactive<Record<string, unknown>>({
  serviceMilitaire: 'Non',
  langues: [] as string[],
  avisDate: new Date().toISOString().slice(0, 10),
  sexe: 'M',
  situation: 'Célibataire',
  tailleChemise: 'M',
});
const sectionValidations = ref<Record<string, { by: string; at: string }>>({});
const positions = ref<{ value: string; label: string }[]>([]);

const etape1 = SECTIONS.filter((s) => s.etape === 1);
const etape2 = SECTIONS.filter((s) => s.etape === 2);

// Expérience professionnelle — lignes répétables.
const experience = ref<Record<string, string>[]>([{ exp_employeur: '', exp_poste: '', exp_du: '', exp_au: '', exp_salaire: '', exp_motif: '' }]);
function addExp(): void { experience.value.push({ exp_employeur: '', exp_poste: '', exp_du: '', exp_au: '', exp_salaire: '', exp_motif: '' }); }
function removeExp(i: number): void { experience.value.splice(i, 1); if (!experience.value.length) addExp(); }

// Options dynamiques pour certains champs.
function fieldOptions(f: FieldDef): { value: string; label: string }[] {
  if (f.name === 'posteSouhaite') {
    const base = [{ value: '', label: '— Choisir —' }, ...positions.value];
    const cur = String(form.posteSouhaite ?? '');
    if (cur && !positions.value.some((o) => o.value === cur)) base.splice(1, 0, { value: cur, label: cur });
    return base;
  }
  if (f.name === 'dureeContrat') return [{ value: '', label: '—' }, ...DUREES_CONTRAT.map((v) => ({ value: v, label: v }))];
  return f.options ?? [];
}

function populate(c: Candidate): void {
  const d = (c.data ?? {}) as Record<string, unknown>;
  Object.assign(form, d);
  if (Array.isArray(d.experience) && d.experience.length) experience.value = d.experience as Record<string, string>[];
  form.nom = c.last_name ?? d.nom ?? '';
  form.prenom = c.first_name ?? d.prenom ?? '';
  form.telephone = c.phone ?? d.telephone ?? '';
  form.email = c.email ?? d.email ?? '';
  form.posteSouhaite = c.desired_position ?? d.posteSouhaite ?? '';
  form.avisCommentaire = c.recruiter_opinion ?? d.avisCommentaire ?? '';
  if (!Array.isArray(form.langues)) form.langues = [];
  if (!form.serviceMilitaire) form.serviceMilitaire = 'Non';
  sectionValidations.value = (d.sectionValidations as Record<string, { by: string; at: string }>) ?? {};
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    positions.value = (await referenceApi.positions(session.activeSociety ?? undefined)).map((p) => ({ value: p.name, label: p.name }));
  } catch { /* postes optionnels */ }
  if (routeId.value) {
    try {
      candidate.value = await candidatesApi.get(routeId.value);
      candidateId.value = candidate.value.id;
      populate(candidate.value);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Candidat introuvable';
    }
  }
  loading.value = false;
}
onMounted(load);

function collectData(): Record<string, unknown> {
  const data = { ...form };
  // Service militaire à 'Non' : on vide les champs liés (parité).
  if (form.serviceMilitaire !== 'Oui') {
    data.armeService = ''; data.nombreAnneesService = ''; data.dateIncorporation = ''; data.dateRadiation = '';
  }
  // Expérience : on filtre les lignes vides (sans employeur ET sans poste).
  data.experience = experience.value.filter((r) => (r.exp_employeur || '').trim() || (r.exp_poste || '').trim());
  data.sectionValidations = sectionValidations.value;
  return data;
}

function payload(): CandidateInput {
  const salaire = Number(String(form.salairePrevu ?? '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return {
    first_name: String(form.prenom ?? ''),
    last_name: String(form.nom ?? ''),
    phone: String(form.telephone ?? '') || null,
    email: String(form.email ?? '') || null,
    desired_position: String(form.posteSouhaite ?? '') || null,
    society: session.activeSociety ?? (String(form.societe ?? '') || null),
    expected_salary: Number.isNaN(salaire) || salaire <= 0 ? null : salaire,
    recruiter_opinion: String(form.avisCommentaire ?? '') || null,
    status: candidate.value?.status || (reserveDirect.value ? 'reserve' : 'nouvelle'),
    data: collectData(),
  };
}

async function save(toast = true): Promise<boolean> {
  busy.value = true;
  error.value = '';
  try {
    if (candidateId.value) {
      candidate.value = await candidatesApi.update(candidateId.value, payload());
    } else {
      candidate.value = await candidatesApi.create(payload());
      candidateId.value = candidate.value.id;
      // Réécrit l'URL vers l'id réel.
      history.replaceState(null, '', `#/reserve/${candidate.value.id}`);
    }
    if (toast) info.value = 'Candidat enregistré';
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Candidat non enregistré";
    return false;
  } finally {
    busy.value = false;
  }
}

const info = ref('');

function sectionMissing(key: string): string[] {
  const sec = SECTIONS.find((s) => s.key === key);
  if (!sec) return [];
  return sec.required.filter((name) => {
    const v = form[name];
    if (name === 'telephone' || name === 'contactUrgenceTel') return String(v ?? '').replace(/\D/g, '').length !== 10;
    return v === undefined || v === null || String(v).trim() === '';
  });
}

const validatedCount = computed(() => Object.keys(sectionValidations.value).filter((k) => k !== 'mensurations').length);
const isValidated = (key: string): boolean => Boolean(sectionValidations.value[key]);
/** Séquencement serveur (inclut la section fantôme 'mensurations' après identification). */
const isAvailable = (key: string): boolean => {
  const idx = SERVER_ORDER.indexOf(key);
  if (idx <= 0) return true;
  return SERVER_ORDER.slice(0, idx).every((k) => isValidated(k));
};
const allValidated = computed(() => validatedCount.value >= 7);
const isArchivedCandidate = computed(() => (candidate.value?.status ?? '').toLowerCase().includes('archiv'));

async function validateSection(key: string): Promise<void> {
  const missing = sectionMissing(key);
  if (missing.length) { error.value = `Champs obligatoires manquants : ${missing.join(', ')}`; return; }
  if (!(await save(false))) return;
  busy.value = true;
  error.value = '';
  try {
    // Contrôle serveur (règles + séquencement). Pour 'identification', valider aussi la section fantôme 'mensurations'.
    await candidatesApi.validateSection(key, payload(), candidateId.value ?? undefined);
    sectionValidations.value = { ...sectionValidations.value, [key]: { by: session.user?.username ?? 'system', at: new Date().toISOString() } };
    if (key === 'identification') {
      await candidatesApi.validateSection('mensurations', payload(), candidateId.value ?? undefined);
      sectionValidations.value = { ...sectionValidations.value, mensurations: { by: session.user?.username ?? 'system', at: new Date().toISOString() } };
    }
    // Persiste les flags de validation.
    if (candidateId.value) candidate.value = await candidatesApi.update(candidateId.value, { data: collectData() });
    info.value = 'Section validée';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Validation refusée';
  } finally {
    busy.value = false;
  }
}

async function validerFiche(): Promise<void> {
  if (!allValidated.value) { error.value = 'Toutes les sections doivent être validées.'; return; }
  if (!candidateId.value && !(await save(false))) return;
  busy.value = true;
  try {
    await candidatesApi.validateFinal(candidateId.value!);
    info.value = '✓ Fiche de position validée — candidat en réserve';
    router.push('/reserve');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Validation finale refusée';
  } finally {
    busy.value = false;
  }
}

// Envoi au contrat (avis favorable obligatoire).
async function recruter(): Promise<void> {
  if (candidateAvis(candidate.value ?? ({ data: form } as never)) !== 'Favorable') {
    error.value = 'Avis favorable obligatoire pour envoyer au contrat'; return;
  }
  if (!candidateId.value) return;
  busy.value = true;
  try {
    await candidatesApi.marquerContractualisation(candidateId.value);
    info.value = 'Candidat envoyé au contrat (à contractualiser)';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Envoi au contrat refusé';
  } finally {
    busy.value = false;
  }
}

// Archive / activation.
const showArchive = ref(false);
const archiveMotif = ref('');
const archiveComment = ref('');
const ARCHIVE_MOTIFS = ['Dossier incomplet', 'Profil non conforme', 'Âge non conforme', 'Poste non disponible', 'Candidat non joignable', 'Désistement du candidat', 'Avis défavorable', 'Doublon', 'Autre'];
async function confirmArchive(): Promise<void> {
  if (!archiveMotif.value) { error.value = "Choisissez un motif d'archivage"; return; }
  if (!candidateId.value) { error.value = "Enregistrez d'abord le candidat avant de l'archiver"; return; }
  busy.value = true;
  try {
    const data = { ...collectData(), motifArchive: archiveMotif.value, commentaireArchive: archiveComment.value, archivedAt: new Date().toISOString() };
    await candidatesApi.update(candidateId.value, { status: 'archive', data });
    showArchive.value = false;
    router.push('/candidats_archives');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Archivage refusé';
  } finally {
    busy.value = false;
  }
}
async function activer(): Promise<void> {
  if (!candidateId.value || !window.confirm('Réactiver ce candidat (retour en réserve) ?')) return;
  busy.value = true;
  try {
    const data: Record<string, unknown> = { ...collectData(), fichePositionValidee: true };
    delete data.motifArchive; delete data.commentaireArchive; delete data.archivedAt;
    await candidatesApi.update(candidateId.value, { status: 'reserve', data });
    router.push('/reserve');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Activation refusée';
  } finally {
    busy.value = false;
  }
}

function toggleLangue(l: string): void {
  const arr = (form.langues as string[]) ?? [];
  form.langues = arr.includes(l) ? arr.filter((x) => x !== l) : [...arr, l];
}
function readFile(e: Event, target: string, nameTarget?: string): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { error.value = 'Fichier > 5 Mo'; return; }
  const reader = new FileReader();
  reader.onload = () => { form[target] = reader.result; if (nameTarget) form[nameTarget] = file.name; };
  reader.readAsDataURL(file);
}

const heroTitle = computed(() => {
  if (!candidateId.value) return reserveDirect.value ? 'Ajouter candidat en réserve' : 'Fiche candidat';
  const n = `${form.nom ?? ''} ${form.prenom ?? ''}`.trim();
  return n || 'Fiche candidat';
});
</script>

<template>
  <div>
    <div class="sg-page-head">
      <div>
        <button class="sg-btn sg-btn-ghost sg-btn-sm" @click="router.back()">← Retour</button>
        <h1 class="sg-page-title fiche-title">{{ heroTitle }}</h1>
        <p class="sg-page-sub">Recrutement / réserve · dossier candidat</p>
      </div>
      <button class="sg-btn" :disabled="busy" @click="save(true)">Enregistrer</button>
    </div>

    <p v-if="error" class="sg-alert">{{ error }}</p>
    <p v-if="info" class="fiche-info">{{ info }}</p>
    <p v-if="loading" class="sg-page-sub">Chargement…</p>

    <template v-else>
      <!-- Progression -->
      <div class="sg-card fiche-progress">
        <div class="fiche-progress__bar"><span :style="{ width: `${Math.round((validatedCount / 7) * 100)}%` }"></span></div>
        <div class="fiche-progress__label">{{ validatedCount }}/7 sections validées · {{ Math.round((validatedCount / 7) * 100) }}%</div>
      </div>

      <div class="stepper">
        <span class="stepper__item stepper__item--active">1. Candidature</span>
        <span class="stepper__item">2. Fiche de renseignement</span>
      </div>

      <!-- Sections étape 1 -->
      <section v-for="sec in etape1" :key="sec.key" class="sg-card fiche-section" :class="`banner-${sec.banner}`">
        <header class="fiche-section__head">
          <h3>{{ sec.title }}</h3>
          <span v-if="isValidated(sec.key)" class="sg-pill sg-pill--green">Validée</span>
          <span v-else-if="isAvailable(sec.key)" class="sg-pill sg-pill--amber">À valider</span>
          <span v-else class="sg-pill sg-pill--gray">En attente</span>
        </header>

        <fieldset :disabled="isValidated(sec.key) || !isAvailable(sec.key)" class="fiche-fields">
          <!-- Photo (identification) -->
          <div v-if="sec.key === 'identification'" class="sg-field photo-field">
            <label>Photo</label>
            <div class="photo-zone">
              <span class="photo-preview"><img v-if="form.photo" :src="String(form.photo)" alt="" /><template v-else>{{ (String(form.prenom || '?'))[0] }}</template></span>
              <input type="file" accept="image/*" @change="(e) => readFile(e, 'photo')" />
            </div>
          </div>

          <CandidateField
            v-for="f in sec.fields" :key="f.name" :field="{ ...f, options: fieldOptions(f) }" :model="form"
          />

          <!-- Langues (identification) -->
          <div v-if="sec.key === 'identification'" class="sg-field sg-col-span-2">
            <label>Langues parlées</label>
            <div class="langues">
              <label v-for="l in LANGUES" :key="l" class="langue-chk">
                <input type="checkbox" :checked="((form.langues as string[]) || []).includes(l)" @change="toggleLangue(l)" /> {{ l }}
              </label>
            </div>
          </div>

          <!-- Service militaire (militaire) -->
          <div v-if="sec.key === 'militaire'" class="sg-field sg-col-span-2">
            <label>Service militaire</label>
            <div class="radios">
              <label><input type="radio" value="Oui" v-model="form.serviceMilitaire" /> Oui</label>
              <label><input type="radio" value="Non" v-model="form.serviceMilitaire" /> Non</label>
            </div>
          </div>

          <!-- CV (poste) -->
          <div v-if="sec.key === 'poste'" class="sg-field sg-col-span-2">
            <label>CV</label>
            <div class="cv-zone">
              <input type="file" accept=".pdf,.doc,.docx,image/*" @change="(e) => readFile(e, 'cv_url', 'cv_name')" />
              <span v-if="form.cv_name" class="cv-name">✅ {{ form.cv_name }}</span>
            </div>
          </div>
        </fieldset>

        <footer class="fiche-section__foot">
          <span v-if="isValidated(sec.key)" class="fiche-section__ok">
            Section validée le {{ new Date(sectionValidations[sec.key].at).toLocaleDateString('fr-FR') }}
          </span>
          <button
            v-else-if="isAvailable(sec.key)"
            class="sg-btn sg-btn-sm" :disabled="busy" @click="validateSection(sec.key)"
          >Valider la section</button>
          <span v-else class="sg-page-sub">Validez d'abord la section précédente.</span>
        </footer>
      </section>

      <!-- Étape 2 : débloquée quand les 4 sections de l'étape 1 sont validées -->
      <div v-if="validatedCount < 4" class="sg-card fiche-etape2-lock">
        <strong>Étape 2 — Fiche de renseignement</strong>
        <p class="sg-page-sub">Validez les 4 sections de l'étape 1 pour débloquer l'étape 2 (coordonnées, habilitations, expérience).</p>
      </div>

      <template v-else>
        <section v-for="sec in etape2" :key="sec.key" class="sg-card fiche-section" :class="`banner-${sec.banner}`">
          <header class="fiche-section__head">
            <h3>{{ sec.title }}</h3>
            <span v-if="isValidated(sec.key)" class="sg-pill sg-pill--green">Validée</span>
            <span v-else-if="isAvailable(sec.key)" class="sg-pill sg-pill--amber">À valider</span>
            <span v-else class="sg-pill sg-pill--gray">En attente</span>
          </header>

          <fieldset :disabled="isValidated(sec.key) || !isAvailable(sec.key)" class="fiche-fields">
            <!-- Section 5 : coordonnées -->
            <CandidateField v-for="f in sec.fields" :key="f.name" :field="{ ...f, options: fieldOptions(f) }" :model="form" />

            <!-- Section 6 : habilitations (4 paires de radios) -->
            <template v-if="sec.key === 'habilitations'">
              <div v-for="h in HABILITATIONS" :key="h.name" class="sg-field">
                <label>{{ h.label }}</label>
                <div class="radios">
                  <label><input type="radio" value="oui" v-model="form[h.name]" /> Oui</label>
                  <label><input type="radio" value="non" v-model="form[h.name]" /> Non</label>
                </div>
              </div>
            </template>

            <!-- Section 7 : expérience (lignes répétables) -->
            <div v-if="sec.key === 'experience'" class="sg-col-span-2 exp-list">
              <div v-for="(row, i) in experience" :key="i" class="exp-row">
                <input v-model="row.exp_employeur" class="sg-input" placeholder="Employeur" />
                <input v-model="row.exp_poste" class="sg-input" placeholder="Poste" />
                <input v-model="row.exp_du" type="date" class="sg-input" />
                <input v-model="row.exp_au" type="date" class="sg-input" />
                <input v-model="row.exp_salaire" class="sg-input" inputmode="decimal" placeholder="Salaire" />
                <select v-model="row.exp_motif" class="sg-select">
                  <option value="">— Motif de départ —</option>
                  <option v-for="m in MOTIFS_DEPART" :key="m" :value="m">{{ m }}</option>
                </select>
                <button type="button" class="sg-btn sg-btn-ghost sg-btn-sm exp-x" @click="removeExp(i)">✕</button>
              </div>
              <button type="button" class="sg-btn sg-btn-ghost sg-btn-sm" @click="addExp">＋ Ajouter une expérience</button>
            </div>
          </fieldset>

          <footer class="fiche-section__foot">
            <span v-if="isValidated(sec.key)" class="fiche-section__ok">
              Section validée le {{ new Date(sectionValidations[sec.key].at).toLocaleDateString('fr-FR') }}
            </span>
            <button v-else-if="isAvailable(sec.key)" class="sg-btn sg-btn-sm" :disabled="busy" @click="validateSection(sec.key)">Valider la section</button>
            <span v-else class="sg-page-sub">Validez d'abord la section précédente.</span>
          </footer>
        </section>
      </template>

      <!-- Barre d'actions globale -->
      <div class="sg-card fiche-footer">
        <button v-if="allValidated && !isArchivedCandidate" class="sg-btn fiche-final" :disabled="busy" @click="validerFiche">
          VALIDER FICHE CANDIDAT
        </button>
        <button v-if="!isArchivedCandidate && candidateId" class="sg-btn sg-btn-secondary" :disabled="busy" @click="recruter">Envoyer au contrat</button>
        <span class="fiche-footer__spacer"></span>
        <button v-if="isArchivedCandidate" class="sg-btn" style="background:var(--sg-success)" :disabled="busy" @click="activer">Activer</button>
        <button v-else class="sg-btn sg-btn-ghost fiche-danger" :disabled="!candidateId || busy" @click="showArchive = true">Archiver candidat</button>
      </div>
    </template>

    <!-- Modale archiver -->
    <ModalDialog v-if="showArchive" title="Archiver candidat" @close="showArchive = false">
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
        <button class="sg-btn sg-btn-ghost" @click="showArchive = false">Annuler</button>
        <button class="sg-btn fiche-danger" @click="confirmArchive">Archiver candidat</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.fiche-title { text-transform: none; margin-top: 8px; }
.fiche-info { color: var(--sg-success); font-weight: 600; font-size: var(--sg-fs-sm); }
.fiche-progress { padding: var(--sg-space-4); margin-bottom: var(--sg-space-4); }
.fiche-progress__bar { height: 8px; background: var(--sg-surface-2); border-radius: 999px; overflow: hidden; }
.fiche-progress__bar span { display: block; height: 100%; background: var(--sg-brand-600); transition: width 0.3s; }
.fiche-progress__label { margin-top: 8px; font-size: var(--sg-fs-sm); color: var(--sg-text-muted); }
.stepper { display: flex; gap: var(--sg-space-4); margin-bottom: var(--sg-space-4); }
.stepper__item { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); font-weight: 600; }
.stepper__item--active { color: var(--sg-brand-700); }
.fiche-section { padding: var(--sg-space-4); margin-bottom: var(--sg-space-4); border-left: 4px solid var(--sg-border); }
.banner-amber { border-left-color: #d97706; }
.banner-green { border-left-color: #16a34a; }
.banner-blue { border-left-color: #0369a1; }
.fiche-section__head { display: flex; align-items: center; gap: var(--sg-space-3); margin-bottom: var(--sg-space-4); }
.fiche-section__head h3 { margin: 0; font-size: var(--sg-fs-lg); }
.fiche-fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sg-space-3); border: none; padding: 0; margin: 0; }
@media (max-width: 640px) { .fiche-fields { grid-template-columns: 1fr; } }
.fiche-section__foot { margin-top: var(--sg-space-4); display: flex; justify-content: flex-end; }
.fiche-section__ok { color: var(--sg-success); font-size: var(--sg-fs-sm); font-weight: 600; }
.photo-field .photo-zone { display: flex; align-items: center; gap: var(--sg-space-3); }
.photo-preview { width: 52px; height: 52px; border-radius: var(--sg-radius); background: var(--sg-brand-soft); color: var(--sg-brand-700); display: grid; place-items: center; font-weight: 800; overflow: hidden; }
.photo-preview img { width: 100%; height: 100%; object-fit: cover; }
.langues { display: flex; flex-wrap: wrap; gap: var(--sg-space-3); }
.langue-chk { font-size: var(--sg-fs-sm); display: flex; align-items: center; gap: 4px; }
.radios { display: flex; gap: var(--sg-space-4); }
.cv-zone { display: flex; align-items: center; gap: var(--sg-space-3); }
.cv-name { font-size: var(--sg-fs-sm); color: var(--sg-success); }
.fiche-etape2-lock { padding: var(--sg-space-6); opacity: 0.8; }
.exp-list { display: flex; flex-direction: column; gap: var(--sg-space-2); }
.exp-row { display: grid; grid-template-columns: 1.2fr 1.2fr 0.9fr 0.9fr 0.9fr 1.1fr auto; gap: 8px; align-items: center; }
@media (max-width: 900px) { .exp-row { grid-template-columns: 1fr 1fr; } }
.exp-x { color: var(--sg-danger); }
.fiche-footer { position: sticky; bottom: 0; display: flex; align-items: center; gap: var(--sg-space-2); padding: var(--sg-space-3) var(--sg-space-4); }
.fiche-footer__spacer { flex: 1; }
.fiche-final { background: var(--sg-success); font-weight: 800; }
.fiche-danger { color: var(--sg-danger); }
</style>
