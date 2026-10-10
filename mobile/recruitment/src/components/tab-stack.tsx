import { Stack } from 'expo-router';
import { colors, fonts } from './ui';

export const stackOptions = { headerTintColor: colors.navy, headerStyle: { backgroundColor: colors.white }, headerShadowVisible: false,
  headerTitleStyle: { fontSize: 17, fontFamily: fonts.semi }, headerBackButtonDisplayMode: 'minimal' as const, title: '', contentStyle: { backgroundColor: colors.background } };

/** Pile de navigation d'un onglet : les écrans secondaires s'y empilent et la barre d'onglets reste visible. */
export function TabStack({ plain = [] }: { plain?: string[] }) {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {plain.map(name => <Stack.Screen key={name} name={name} options={{ headerShown: false }} />)}
    </Stack>
  );
}
