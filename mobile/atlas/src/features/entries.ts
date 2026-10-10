import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { ApiUser } from '@/api/types';
import type { ModuleKey } from '@/auth/permissions';
import type { TranslationKey } from '@/i18n';

import { access, type AccessKey } from './access';

export type ModuleEntry = {
  key: string;
  title: TranslationKey;
  icon: ComponentProps<typeof Ionicons>['name'];
  route: string;
  access: AccessKey;
};

const ENTRIES = {
  sites: { key: 'sites', title: 'entry.sites', icon: 'business-outline', route: '/ops/sites', access: 'sites' },
  attendance: { key: 'attendance', title: 'entry.attendance', icon: 'people-circle-outline', route: '/attendance', access: 'attendance' },
  abandons: { key: 'abandons', title: 'entry.abandons', icon: 'exit-outline', route: '/abandons', access: 'abandons' },
  incidents: { key: 'incidents', title: 'entry.incidents', icon: 'warning-outline', route: '/incidents', access: 'incidents' },
  brq: { key: 'brq', title: 'entry.brq', icon: 'document-text-outline', route: '/brq', access: 'brq' },
  employees: { key: 'employees', title: 'entry.employees', icon: 'people-outline', route: '/drh/employees', access: 'employees' },
  leaves: { key: 'leaves', title: 'entry.leaves', icon: 'calendar-outline', route: '/drh/leaves', access: 'leaves' },
  candidates: { key: 'candidates', title: 'entry.candidates', icon: 'person-add-outline', route: '/recruitment', access: 'candidates' },
} as const satisfies Record<string, ModuleEntry>;

/** Fonctions proposées dans chaque module mobile. Un module sans entrée affiche « bientôt ». */
const MODULE_ENTRIES: Partial<Record<ModuleKey, readonly ModuleEntry[]>> = {
  ops: [ENTRIES.sites, ENTRIES.attendance, ENTRIES.incidents, ENTRIES.abandons],
  pointage: [ENTRIES.attendance, ENTRIES.abandons],
  brq: [ENTRIES.brq],
  drh: [ENTRIES.employees, ENTRIES.leaves, ENTRIES.attendance, ENTRIES.candidates],
  conges: [ENTRIES.leaves],
  recrute: [ENTRIES.candidates],
};

/** Entrées d'un module que CE profil peut ouvrir. */
export function moduleEntries(user: ApiUser | null | undefined, module: ModuleKey): ModuleEntry[] {
  return (MODULE_ENTRIES[module] ?? []).filter((entry) => access[entry.access](user));
}
