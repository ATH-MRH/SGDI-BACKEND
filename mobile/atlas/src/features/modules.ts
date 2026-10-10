import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { ApiUser } from '@/api/types';
import { canAccessModule, type ModuleKey } from '@/auth/permissions';
import { isFeatureEnabled, type FeatureKey } from '@/config/env';
import type { TranslationKey } from '@/i18n';

export type MobileModule = {
  key: ModuleKey;
  title: TranslationKey;
  body: TranslationKey;
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Fonction à activer au build pour que le module apparaisse. */
  feature?: FeatureKey;
};

/** Modules ATLAS prévus sur mobile, dans l'ordre d'affichage. */
export const MOBILE_MODULES: readonly MobileModule[] = [
  { key: 'ops', title: 'modules.ops', body: 'modules.ops.body', icon: 'business-outline' },
  { key: 'site_workforce', title: 'modules.site_workforce', body: 'modules.site_workforce.body', icon: 'location-outline' },
  { key: 'pointage', title: 'modules.pointage', body: 'modules.pointage.body', icon: 'time-outline' },
  { key: 'brq', title: 'modules.brq', body: 'modules.brq.body', icon: 'document-text-outline' },
  { key: 'drh', title: 'modules.drh', body: 'modules.drh.body', icon: 'people-outline' },
  { key: 'conges', title: 'modules.conges', body: 'modules.conges.body', icon: 'calendar-outline' },
  { key: 'recrute', title: 'modules.recrute', body: 'modules.recrute.body', icon: 'person-add-outline' },
];

/** Modules à afficher pour ce profil. Le backend revalide chaque appel. */
export function visibleModules(user: ApiUser | null | undefined): MobileModule[] {
  return MOBILE_MODULES.filter(
    (module) => canAccessModule(user, module.key) && (!module.feature || isFeatureEnabled(module.feature)),
  );
}

/** Module affichable pour ce profil, ou null (clé inconnue, non accordée ou désactivée). */
export function findVisibleModule(user: ApiUser | null | undefined, key: string | undefined): MobileModule | null {
  return visibleModules(user).find((module) => module.key === key) ?? null;
}
