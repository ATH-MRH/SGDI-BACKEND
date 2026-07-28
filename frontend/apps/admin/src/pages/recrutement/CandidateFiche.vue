<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Candidate, CandidateInput } from '@sgdi/shared';
import { candidatesApi, referenceApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import CandidateField from '@/components/candidates/CandidateField.vue';
import { SECTIONS, ETAPE1_KEYS, LANGUES, DUREES_CONTRAT } from '@/utils/candidateSections';
import type { FieldDef } from '@/utils/candidateSections';

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
const isAvailable = (key: string): boolean => {
  const order = ETAPE1_KEYS;
  const idx = order.indexOf(key);
  if (idx <= 0) return true;
  return order.slice(0, idx).every((k) => isValidated(k));
};

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

      <div class="sg-card fiche-etape2-lock" v-if="validatedCount < 4">
        <strong>Étape 2 — Fiche de renseignement</strong>
        <p class="sg-page-sub">Validez les 4 sections de l'étape 1 pour débloquer l'étape 2 (coordonnées, habilitations, expérience).</p>
      </div>
    </template>
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
</style>
