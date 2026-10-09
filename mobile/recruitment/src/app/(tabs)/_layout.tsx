import { Tabs } from 'expo-router';
import { Icon, IconName } from '../../components/icon';
import { colors } from '../../components/ui';

// Libellés courts : cinq onglets doivent tenir sur un écran de 320 points sans être tronqués.
const TABS: { name: string; title: string; label?: string; icon: IconName }[] = [
  { name: 'index', title: 'Accueil', icon: 'home' },
  { name: 'offers', title: 'Offres', icon: 'briefcase' },
  { name: 'favorites', title: 'Favoris', icon: 'bookmark' },
  { name: 'applications', title: 'Suivi', label: 'Mes candidatures', icon: 'file' },
  { name: 'profile', title: 'Profil', icon: 'user' },
];

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.navy, tabBarInactiveTintColor: colors.muted, tabBarHideOnKeyboard: true,
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.border } }}>
      {TABS.map(tab => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarAccessibilityLabel: tab.label || tab.title,
          tabBarIcon: ({ color, focused }) => <Icon name={tab.icon} size={23} color={color} filled={focused && tab.icon === 'bookmark'} /> }} />
      ))}
    </Tabs>
  );
}
