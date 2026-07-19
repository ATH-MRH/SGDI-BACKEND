<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import type { SiteRef, EmployeeRef, Incident } from '@sgdi/shared';
import { incidentsApi, referenceApi } from '@/api';
import { useSessionStore } from '@/stores/session';
import { CATEGORIES, SEVERITIES, STATUSES } from '@/utils/incidents';
import ModalDialog from '@/components/ModalDialog.vue';

const props = defineProps<{ mode: 'site' | 'autres' }>();
const emit = defineEmits<{ close: []; saved: [Incident] }>();

const session = useSessionStore();

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Valeurs par défaut fidèles au spec.
const form = reactive({
  date: today(),
  heure: nowTime(),
  siteId: '' as string,
  agentId: '' as string,
  categorie: 'Sécurité',
  gravite: 'mineur',
  sujet: '',
  description: '',
  consigne: '',
  statut: 'en_cours',
  destinataire: '',
});

const sites = ref<SiteRef[]>([]);
const employees = ref<EmployeeRef[]>([]);
const saving = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    [sites.value, employees.value] = await Promise.all([
      referenceApi.sites(session.activeSociety ?? undefined),
      referenceApi.employees(session.activeSociety ?? undefined),
    ]);
  } catch {
    // Listes optionnelles : on n'empêche pas la saisie si elles échouent.
  }
});

async function submit(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    const inc = await incidentsApi.create({
      incident_date: form.date || null,
      incident_time: form.heure || null,
      event_type: props.mode === 'autres' ? 'autre' : 'site',
      category: form.categorie,
      severity: form.gravite,
      subject: form.sujet || null,
      description: form.description || null,
      consigne: form.consigne || null,
      destinataire: form.destinataire || null,
      status: form.statut,
      site_id: form.siteId ? Number(form.siteId) : null,
      employee_id: form.agentId ? Number(form.agentId) : null,
      society: session.activeSociety ?? undefined,
    });
    emit('saved', inc);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Enregistrement impossible';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog title="Nouvel évènement" wide @close="emit('close')">
    <form id="incident-form" class="sg-form-grid" @submit.prevent="submit">
      <div class="sg-field">
        <label>Date</label>
        <input v-model="form.date" type="date" class="sg-input" />
      </div>
      <div class="sg-field">
        <label>Heure</label>
        <input v-model="form.heure" type="time" class="sg-input" />
      </div>

      <div class="sg-field">
        <label>Site</label>
        <select v-model="form.siteId" class="sg-select">
          <option value="">—</option>
          <option v-for="s in sites" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
        </select>
      </div>
      <div class="sg-field">
        <label>Agent</label>
        <select v-model="form.agentId" class="sg-select">
          <option value="">—</option>
          <option v-for="a in employees" :key="a.id" :value="String(a.id)">
            {{ a.code }} - {{ a.last_name }} {{ a.first_name }}
          </option>
        </select>
      </div>

      <div class="sg-field">
        <label>Catégorie</label>
        <select v-model="form.categorie" class="sg-select">
          <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div class="sg-field">
        <label>Niveau d'importance</label>
        <select v-model="form.gravite" class="sg-select">
          <option v-for="g in SEVERITIES" :key="g.value" :value="g.value">{{ g.label }}</option>
        </select>
      </div>

      <div class="sg-field sg-col-span-2">
        <label>Sujet</label>
        <input v-model="form.sujet" class="sg-input" placeholder="Objet de l'évènement" />
      </div>
      <div class="sg-field sg-col-span-2">
        <label>Description de l'évènement</label>
        <textarea v-model="form.description" class="sg-textarea" rows="3"></textarea>
      </div>
      <div class="sg-field sg-col-span-2">
        <label>Conduite à tenir / consigne</label>
        <textarea v-model="form.consigne" class="sg-textarea" rows="2" placeholder="Instruction opérationnelle, action demandée..."></textarea>
      </div>

      <div class="sg-field">
        <label>Statut</label>
        <select v-model="form.statut" class="sg-select">
          <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </div>
      <div class="sg-field">
        <label>Destinataire</label>
        <input v-model="form.destinataire" class="sg-input" placeholder="OPS, DRH, client, agent..." />
      </div>

      <p v-if="error" class="sg-alert sg-col-span-2">{{ error }}</p>
    </form>

    <template #footer>
      <button type="button" class="sg-btn sg-btn-ghost" @click="emit('close')">Annuler</button>
      <button type="submit" form="incident-form" class="sg-btn" :disabled="saving">
        {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
    </template>
  </ModalDialog>
</template>
