<script setup lang="ts">
import { ref } from 'vue';
import type { Incident } from '@sgdi/shared';
import { incidentsApi } from '@/api';
import { pillClass, formatFR, formatDateTimeFR, safe, incidentSubject } from '@/utils/incidents';
import ModalDialog from '@/components/ModalDialog.vue';

const props = defineProps<{ incident: Incident; siteName?: string; agentName?: string }>();
const emit = defineEmits<{ close: []; updated: [Incident] }>();

const current = ref<Incident>(props.incident);
const comment = ref('');
const busy = ref(false);

async function sendComment(): Promise<void> {
  const note = comment.value.trim();
  if (!note) return;
  busy.value = true;
  try {
    current.value = await incidentsApi.action(current.value.id, 'commenter', note);
    comment.value = '';
    emit('updated', current.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="incidentSubject(current)" wide @close="emit('close')">
    <div class="det">
      <div class="det__pills">
        <span class="sg-pill" :class="pillClass(current.severity)">{{ current.severity || 'mineur' }}</span>
        <span class="sg-pill" :class="pillClass(current.status)">{{ current.status || 'en_cours' }}</span>
      </div>

      <dl class="det__grid">
        <div><dt>Date</dt><dd>{{ formatFR(current.incident_date) }} {{ current.incident_time || '' }}</dd></div>
        <div><dt>Catégorie</dt><dd>{{ safe(current.category) }}</dd></div>
        <div><dt>Site</dt><dd>{{ safe(siteName ?? current.site_id) }}</dd></div>
        <div><dt>Agent</dt><dd>{{ safe(agentName ?? current.employee_id) }}</dd></div>
        <div><dt>Destinataire</dt><dd>{{ safe(current.destinataire) }}</dd></div>
        <div><dt>Société</dt><dd>{{ safe(current.society) }}</dd></div>
      </dl>

      <section class="det__box">
        <h4>Description</h4>
        <p>{{ safe(current.description) }}</p>
      </section>
      <section class="det__box">
        <h4>Conduite à tenir</h4>
        <p>{{ safe(current.consigne) }}</p>
      </section>

      <section class="det__hist">
        <h4>Historique</h4>
        <ul v-if="current.actions.length">
          <li v-for="(a, idx) in current.actions" :key="idx">
            <strong>{{ a.type || 'action' }}</strong> · {{ formatDateTimeFR(a.date) }} · {{ a.user }}
            <span v-if="a.note"><br>{{ a.note }}</span>
          </li>
        </ul>
        <p v-else class="det__muted">Aucune action.</p>
      </section>
    </div>

    <template #footer>
      <input v-model="comment" class="sg-input det__comment" placeholder="Ajouter un commentaire…" @keyup.enter="sendComment" />
      <button type="button" class="sg-btn sg-btn-ghost" @click="emit('close')">Fermer</button>
      <button type="button" class="sg-btn" :disabled="busy || !comment.trim()" @click="sendComment">Commenter</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.det { display: flex; flex-direction: column; gap: var(--sg-space-4); }
.det__pills { display: flex; gap: var(--sg-space-2); }
.det__grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sg-space-3); margin: 0; }
.det__grid dt { font-size: var(--sg-fs-sm); color: var(--sg-text-muted); }
.det__grid dd { margin: 2px 0 0; font-weight: 600; }
.det__box { background: var(--sg-surface-2); border: 1px solid var(--sg-border); border-radius: var(--sg-radius-sm); padding: var(--sg-space-3); }
.det__box h4, .det__hist h4 { margin: 0 0 6px; font-size: var(--sg-fs-sm); text-transform: uppercase; color: var(--sg-text-muted); }
.det__box p { margin: 0; white-space: pre-wrap; }
.det__hist ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: var(--sg-fs-sm); }
.det__muted { color: var(--sg-text-muted); }
.det__comment { flex: 1; }
</style>
