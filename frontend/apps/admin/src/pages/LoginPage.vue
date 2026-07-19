<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');

async function submit(): Promise<void> {
  const ok = await session.login(username.value.trim(), password.value);
  if (ok) {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect);
  }
}
</script>

<template>
  <div class="login">
    <form class="sg-card login__card" @submit.prevent="submit">
      <div class="login__brand">SGDI · ATLAS</div>
      <p class="login__subtitle">Espace d'administration — préversion v2</p>

      <div class="sg-field">
        <label for="username">Identifiant</label>
        <input id="username" v-model="username" class="sg-input" autocomplete="username" required />
      </div>

      <div class="sg-field">
        <label for="password">Mot de passe</label>
        <input
          id="password"
          v-model="password"
          type="password"
          class="sg-input"
          autocomplete="current-password"
          required
        />
      </div>

      <p v-if="session.error" class="sg-alert">{{ session.error }}</p>

      <button class="sg-btn" type="submit" :disabled="session.loading">
        {{ session.loading ? 'Connexion…' : 'Se connecter' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: var(--sg-space-4);
}
.login__card {
  width: 100%;
  max-width: 380px;
  padding: var(--sg-space-8);
  display: flex;
  flex-direction: column;
  gap: var(--sg-space-4);
}
.login__brand {
  font-size: var(--sg-fs-xl);
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--sg-brand-600);
}
.login__subtitle {
  margin: 0 0 var(--sg-space-2);
  color: var(--sg-text-muted);
  font-size: var(--sg-fs-sm);
}
</style>
