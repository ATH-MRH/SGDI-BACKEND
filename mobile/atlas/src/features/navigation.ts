import type { ApiUser } from '@/api/types';
import type { IconName } from '@/components/ui/IconTile';
import type { TranslationKey } from '@/i18n';

import { access, type AccessKey } from './access';

export type NavItem = {
  /** Nom de l'écran dans le groupe (tabs). */
  name: 'index' | 'stats' | 'attendance' | 'employees' | 'modules';
  label: TranslationKey;
  icon: IconName;
  activeIcon: IconName;
  /** Droit requis : sans lui, l'entrée n'est pas affichée. */
  access?: AccessKey;
};

/** Barre de navigation basse : toujours ces cinq rubriques, dans cet ordre, selon les droits du compte. */
export const NAV_ITEMS: readonly NavItem[] = [
  { name: 'index', label: 'tabs.home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'stats', label: 'tabs.stats', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { name: 'attendance', label: 'tabs.attendance', icon: 'time-outline', activeIcon: 'time', access: 'attendance' },
  { name: 'employees', label: 'tabs.employees', icon: 'people-outline', activeIcon: 'people', access: 'employees' },
  { name: 'modules', label: 'tabs.modules', icon: 'grid-outline', activeIcon: 'grid' },
];

export function navItems(user: ApiUser | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.access || access[item.access](user));
}

/**
 * Rubrique mise en avant pour l'écran affiché. Les écrans ouverts depuis Modules
 * (OPS, DRH, Alertes, Tâches, Profil) gardent la barre et allument « Modules ».
 */
export function activeNavItem(routeName: string): NavItem['name'] {
  const direct = NAV_ITEMS.find((item) => item.name === routeName);
  return direct ? direct.name : 'modules';
}

/** Écrans du groupe (tabs) : ils vivent sous la barre de navigation, une seule fois dans la pile. */
const TAB_PATHS: ReadonlySet<string> = new Set(['/', '/stats', '/attendance', '/employees', '/modules', '/ops', '/drh', '/alerts', '/tasks', '/profile']);

export function isTabRoute(href: string): boolean {
  const path = (href.split('?')[0] ?? '').replace(/^\/\(tabs\)/, '') || '/';
  return TAB_PATHS.has(path);
}

type Navigator = { push: (href: never) => void; dismissTo: (href: never) => void };

/**
 * Ouvre une route depuis un écran de détail. Une rubrique de la barre basse ramène aux
 * onglets déjà ouverts (sans en empiler une seconde copie) ; tout autre écran est empilé.
 */
export function openRoute(router: Navigator, href: string): void {
  if (isTabRoute(href)) router.dismissTo(href as never);
  else router.push(href as never);
}
