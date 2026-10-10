import { Tabs } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '../../components/icon';
import { colors, fonts } from '../../components/ui';
import { useSummary } from '../../lib/summary';

// Les cinq entrées de la planche. Le libellé « Candidatures » tient sur 320 points grâce à une
// taille et un espacement réduits, sans changer l'intitulé.
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: '(home)', title: 'Accueil', icon: 'home' },
  { name: 'offers', title: 'Offres', icon: 'briefcase' },
  { name: 'applications', title: 'Candidatures', icon: 'file' },
  { name: 'messages', title: 'Messages', icon: 'chat' },
  { name: 'profile', title: 'Profil', icon: 'user' },
];

export default function TabsLayout() {
  const { summary } = useSummary();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // « Candidatures » est le plus long libellé : sa taille suit la largeur disponible par onglet.
  const label = width >= 400 ? 11.5 : width >= 360 ? 10.5 : 8.6;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.navy, tabBarInactiveTintColor: colors.muted, tabBarHideOnKeyboard: true,
      tabBarAllowFontScaling: false, tabBarLabelStyle: { fontSize: label, fontFamily: fonts.medium, letterSpacing: width >= 360 ? -0.2 : -0.45 },
      tabBarItemStyle: { paddingHorizontal: 0 }, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.border, height: 66 + insets.bottom, paddingTop: 6, paddingBottom: 10 + insets.bottom } }}>
      {TABS.map(tab => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarAccessibilityLabel: tab.name === 'messages' && summary.unread_messages ? `Messages, ${summary.unread_messages} non lus` : tab.title,
          tabBarBadge: tab.name === 'messages' && summary.unread_messages ? summary.unread_messages : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.gold, color: colors.white, fontSize: 11 },
          tabBarIcon: ({ color, focused }) => <Icon name={tab.icon} size={24} color={color} filled={focused} /> }} />
      ))}
    </Tabs>
  );
}
