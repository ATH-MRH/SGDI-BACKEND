import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';

import { useCurrentUser } from '@/auth/AuthProvider';
import { activeNavItem, navItems } from '@/features/navigation';
import { t } from '@/i18n';
import { bottomBarHeight, colors, spacing, typography } from '@/theme/tokens';

import { AppText } from './ui';

/**
 * Barre de navigation basse fixe : Accueil, Statistiques, Pointage, Employés, Modules.
 * Une rubrique n'apparaît que si le compte a le droit correspondant. Toucher une rubrique
 * la rouvre dans son état initial (filtres d'un lien précédent oubliés).
 */
export function BottomNavigation({ state, navigation, insets }: BottomTabBarProps) {
  const user = useCurrentUser();
  const current = state.routes[state.index]?.name ?? 'index';
  const active = activeNavItem(current);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.xs) }]} accessibilityRole="tablist" testID="bottom-navigation">
      {navItems(user).map((item) => {
        const focused = item.name === active;
        const route = state.routes.find((entry) => entry.name === item.name);
        const color = focused ? colors.navy : colors.textMuted;
        const onPress = () => {
          const event = route ? navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true }) : null;
          if (event?.defaultPrevented) return;
          if (current !== item.name) navigation.navigate(item.name, {});
        };
        return (
          <Pressable
            key={item.name}
            testID={`nav-${item.name}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(item.label)}
            onPress={onPress}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
            <View style={[styles.indicator, focused && styles.indicatorOn]} />
            <Ionicons name={focused ? item.activeIcon : item.icon} size={23} color={color} />
            <AppText style={[styles.label, focused && styles.labelOn]} color={color} numberOfLines={1}>
              {t(item.label)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.xs,
  },
  item: { flex: 1, minHeight: bottomBarHeight, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 2 },
  pressed: { opacity: 0.6 },
  indicator: { position: 'absolute', top: 0, width: 28, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  indicatorOn: { backgroundColor: colors.navy },
  label: { ...typography.micro },
  labelOn: { fontWeight: '700' },
});
