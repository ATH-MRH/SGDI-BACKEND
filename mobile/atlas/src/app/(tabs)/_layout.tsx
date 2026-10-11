import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useCurrentUser } from '@/auth/AuthProvider';
import { access } from '@/features/access';
import { t } from '@/i18n';
import { colors } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(outline: IconName, filled: IconName) {
  function TabIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={focused ? filled : outline} color={color} size={size} />;
  }
  return TabIcon;
}

/**
 * Barre de navigation : Accueil, OPS, DRH, Modules, Plus. Les onglets OPS et DRH n'existent
 * que pour les profils qui ont le module ; Tâches et Alertes restent des écrans de cette
 * pile, ouverts depuis l'accueil, la cloche et l'onglet Plus.
 */
export default function TabsLayout() {
  const user = useCurrentUser();
  const hidden = { href: null } as const;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: tabIcon('home-outline', 'home') }} />
      <Tabs.Screen
        name="ops"
        options={{ title: t('tabs.ops'), tabBarIcon: tabIcon('shield-checkmark-outline', 'shield-checkmark'), ...(access.sites(user) ? {} : hidden) }}
      />
      <Tabs.Screen
        name="drh"
        options={{ title: t('tabs.drh'), tabBarIcon: tabIcon('people-outline', 'people'), ...(access.employees(user) ? {} : hidden) }}
      />
      <Tabs.Screen name="modules" options={{ title: t('tabs.modules'), tabBarIcon: tabIcon('grid-outline', 'grid') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.more'), tabBarIcon: tabIcon('menu-outline', 'menu') }} />
      <Tabs.Screen name="tasks" options={{ title: t('tabs.tasks'), ...hidden }} />
      <Tabs.Screen name="alerts" options={{ title: t('tabs.alerts'), ...hidden }} />
    </Tabs>
  );
}
