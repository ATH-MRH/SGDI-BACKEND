import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@/App.vue';
import { router } from '@/router';
import { useSessionStore } from '@/stores/session';
import '@/styles/base.css';

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  app.use(createPinia());

  // Réhydrate la session (jeton persisté) AVANT de monter le routeur,
  // pour que la garde de route dispose de l'état d'authentification.
  const session = useSessionStore();
  await session.restore();

  app.use(router);
  app.mount('#app');
}

void bootstrap();
