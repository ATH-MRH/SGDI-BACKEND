import { Tabs } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
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
      tabBarAllowFontScaling: false, tabBarLabelStyle: { fontSize: label, fontFamily: fonts.semi, marginTop: 6, lineHeight: label + 5, letterSpacing: width >= 360 ? -0.2 : -0.45 },
      tabBarItemStyle: { paddingHorizontal: 0 }, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.border, borderTopWidth: 1, height: 76 + insets.bottom, paddingTop: 8, paddingBottom: 12 + insets.bottom } }}>
      {TABS.map(tab => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarAccessibilityLabel: tab.name === 'messages' && summary.unread_messages ? `Messages, ${summary.unread_messages} non lus` : tab.title,
          tabBarBadge: tab.name === 'messages' && summary.unread_messages ? summary.unread_messages : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.gold, color: colors.white, fontSize: 11, fontFamily: fonts.bold },
          tabBarIcon: ({ focused }) => (
            <View style={[bar.icon, focused && bar.active]}><Icon name={tab.icon} size={22} color={focused ? colors.white : colors.muted} filled={focused} /></View>
          ) }} />
      ))}
    </Tabs>
  );
}

const bar = StyleSheet.create({ icon: { width: 52, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, active: { backgroundColor: colors.navy } });
