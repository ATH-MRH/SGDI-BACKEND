import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { t } from '@/i18n';
import { colors } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: tabIcon('home-outline') }} />
      <Tabs.Screen name="tasks" options={{ title: t('tabs.tasks'), tabBarIcon: tabIcon('checkbox-outline') }} />
      <Tabs.Screen name="alerts" options={{ title: t('tabs.alerts'), tabBarIcon: tabIcon('notifications-outline') }} />
      <Tabs.Screen name="modules" options={{ title: t('tabs.modules'), tabBarIcon: tabIcon('grid-outline') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: tabIcon('person-outline') }} />
    </Tabs>
  );
}
