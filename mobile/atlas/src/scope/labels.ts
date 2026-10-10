import type { ScopeSite } from '@/api/types';
import { t } from '@/i18n';

import type { CurrentScope } from './model';

export function siteLabel(site: ScopeSite): string {
  return site.name ?? t('scope.siteUnnamed', { id: site.id });
}

export function societyLabel(scope: CurrentScope): string {
  if (scope.society) return scope.society;
  if (scope.globalAccess) return t('home.scope.global');
  return scope.societies.length ? t('scope.allSocieties') : t('home.scope.none');
}

export function currentSiteLabel(scope: CurrentScope): string {
  return scope.site ? siteLabel(scope.site) : t('scope.allSites');
}
