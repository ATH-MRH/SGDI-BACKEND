import { Tabs } from 'expo-router/js-tabs';

import { BottomNavigation } from '@/components/BottomNavigation';
import { t } from '@/i18n';

/**
 * Écrans principaux, sous la barre de navigation fixe : Accueil, Statistiques, Pointage,
 * Employés, Modules. OPS, DRH, Alertes, Tâches et Profil vivent dans le même groupe pour
 * garder la barre ; ils s'ouvrent depuis Modules, l'accueil, la cloche ou l'avatar.
 * Chaque écran refait son contrôle d'accès : la barre ne fait que masquer.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <BottomNavigation {...props} />}>
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="stats" options={{ title: t('tabs.stats') }} />
      <Tabs.Screen name="attendance" options={{ title: t('tabs.attendance') }} />
      <Tabs.Screen name="employees" options={{ title: t('tabs.employees') }} />
      <Tabs.Screen name="modules" options={{ title: t('tabs.modules') }} />
      <Tabs.Screen name="ops" options={{ title: t('tabs.ops') }} />
      <Tabs.Screen name="drh" options={{ title: t('tabs.drh') }} />
      <Tabs.Screen name="alerts" options={{ title: t('tabs.alerts') }} />
      <Tabs.Screen name="tasks" options={{ title: t('tabs.tasks') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
    </Tabs>
  );
}
