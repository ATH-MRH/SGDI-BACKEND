<script setup lang="ts">
import { computed } from 'vue';
import type { FieldDef } from '@/utils/candidateSections';

const props = defineProps<{ field: FieldDef; model: Record<string, unknown>; disabled?: boolean }>();

const value = computed({
  get: () => (props.model[props.field.name] ?? '') as string,
  set: (v: string) => { props.model[props.field.name] = v; },
});

function onPhone(e: Event): void {
  const digits = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10);
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8), digits.slice(8, 10)].filter(Boolean);
  value.value = parts.join(' ');
}
function onCnas(e: Event): void {
  const digits = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 12);
  value.value = digits.length > 10 ? `${digits.slice(0, 10)} ${digits.slice(10)}` : digits;
}
function onMoney(): void {
  const n = Number(String(value.value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  if (!Number.isNaN(n) && n > 0) value.value = n.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
}
</script>

<template>
  <div class="sg-field" :class="{ 'sg-col-span-2': field.colSpan }">
    <label>{{ field.label }}</label>

    <textarea
      v-if="field.type === 'textarea'"
      v-model="value" class="sg-textarea" rows="3" :placeholder="field.placeholder" :disabled="disabled"
    ></textarea>

    <select v-else-if="field.type === 'select'" v-model="value" class="sg-select" :disabled="disabled">
      <option v-for="o in field.options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>

    <input
      v-else-if="field.type === 'phone'"
      :value="value" class="sg-input" inputmode="numeric" :maxlength="field.maxlength" :placeholder="field.placeholder"
      :disabled="disabled" @input="onPhone"
    />
    <input
      v-else-if="field.type === 'cnas'"
      :value="value" class="sg-input" inputmode="numeric" :maxlength="field.maxlength" :placeholder="field.placeholder"
      :disabled="disabled" @input="onCnas"
    />
    <input
      v-else-if="field.type === 'money'"
      v-model="value" class="sg-input" inputmode="decimal" :placeholder="field.placeholder" :disabled="disabled" @blur="onMoney"
    />
    <input
      v-else
      v-model="value" class="sg-input" :type="field.type" :maxlength="field.maxlength" :min="field.min" :step="field.step"
      :placeholder="field.placeholder" :disabled="disabled"
    />

    <span v-if="field.note" class="sg-field__note">{{ field.note }}</span>
  </div>
</template>

<style scoped>
.sg-field__note { font-size: 11px; color: var(--sg-text-muted); }
</style>
