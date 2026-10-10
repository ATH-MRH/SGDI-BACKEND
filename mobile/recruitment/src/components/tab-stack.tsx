import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icon';
import { colors, fonts } from './ui';

/** Hauteur de la ligne de retour, hors zone sûre : sert au décalage du clavier sur iOS. */
export const HEADER_HEIGHT = 52;

type HeaderProps = { options: { title?: string; headerTitle?: unknown; headerRight?: unknown }; back?: unknown; navigation: { canGoBack: () => boolean; goBack: () => void } };

/** En-tête des écrans secondaires, comme sur la planche : la flèche de retour sur la ligne du titre. */
export function StackHeader({ options, navigation }: HeaderProps) {
  const insets = useSafeAreaInsets();
  // Écran ouvert directement (lien, notification) : le retour ramène à l'accueil.
  const back = () => (navigation.canGoBack() ? navigation.goBack() : router.replace('/'));
  const custom = typeof options.headerTitle === 'function' ? (options.headerTitle as () => ReactNode)() : null;
  const right = typeof options.headerRight === 'function' ? (options.headerRight as () => ReactNode)() : null;
  return (
    <View style={[header.bar, { paddingTop: insets.top + 4, paddingLeft: Math.max(insets.left, 6), paddingRight: Math.max(insets.right, 14) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={back} hitSlop={6} style={({ pressed }) => [header.back, pressed && { opacity: 0.6 }]}>
        <Icon name="chevronLeft" size={26} color={colors.navy} />
      </Pressable>
      <View style={header.title}>
        {custom || (!!options.title && <Text accessibilityRole="header" numberOfLines={2} style={header.text}>{options.title}</Text>)}
      </View>
      {right}
    </View>
  );
}

export const stackOptions = { header: (props: unknown) => <StackHeader {...(props as HeaderProps)} />, title: '', contentStyle: { backgroundColor: colors.background } };

/** Pile de navigation d'un onglet : les écrans secondaires s'y empilent et la barre d'onglets reste visible. */
export function TabStack({ plain = [] }: { plain?: string[] }) {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {plain.map(name => <Stack.Screen key={name} name={name} options={{ headerShown: false }} />)}
    </Stack>
  );
}

const header = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: HEADER_HEIGHT, paddingBottom: 4, backgroundColor: colors.white },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { flex: 1, minWidth: 0 },
  text: { fontSize: 26, lineHeight: 32, fontFamily: fonts.serif, color: colors.ink },
});
