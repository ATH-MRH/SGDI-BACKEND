<script setup lang="ts">
defineProps<{ title?: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="modal-bg" @click.self="emit('close')">
    <div class="modal" :class="{ 'modal--wide': wide }" role="dialog" aria-modal="true">
      <header class="modal__head">
        <h2 class="modal__title">{{ title }}</h2>
        <button class="modal__x" type="button" aria-label="Fermer" @click="emit('close')">✕</button>
      </header>
      <div class="modal__body"><slot /></div>
      <footer v-if="$slots.footer" class="modal__foot"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.modal-bg {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--sg-space-8) var(--sg-space-4);
  overflow-y: auto;
}
.modal {
  width: 100%;
  max-width: 560px;
  background: var(--sg-surface);
  border-radius: var(--sg-radius-lg);
  box-shadow: var(--sg-shadow-lg);
  overflow: hidden;
}
.modal--wide { max-width: 760px; }
.modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sg-space-4) var(--sg-space-6);
  border-bottom: 1px solid var(--sg-border);
}
.modal__title { margin: 0; font-size: var(--sg-fs-lg); font-weight: 800; color: var(--sg-brand); }
.modal__x {
  border: none;
  background: transparent;
  font-size: var(--sg-fs-lg);
  color: var(--sg-text-muted);
  cursor: pointer;
  line-height: 1;
}
.modal__body { padding: var(--sg-space-6); }
.modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--sg-space-2);
  padding: var(--sg-space-4) var(--sg-space-6);
  border-top: 1px solid var(--sg-border);
  background: var(--sg-surface-2);
}
</style>
