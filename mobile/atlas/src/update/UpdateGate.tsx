import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { api } from '@/api';
import { fetchMobileConfig } from '@/api/mobileConfig';
import { queryKeys } from '@/api/queryKeys';
import { onUpgradeRequired } from '@/auth/session';
import { isFeatureEnabled } from '@/config/env';
import { getAppVersion } from '@/config/version';

import { isUpdateRequired } from './version';

type Props = {
  children: ReactNode;
  /** Écran de mise à jour ; reçoit le lien store annoncé par le serveur, s'il existe. */
  renderUpdate: (storeUrl: string | null) => ReactNode;
  renderMaintenance: (message: string | null, retry: () => void) => ReactNode;
};

/**
 * Bloque l'application quand sa version n'est plus acceptée.
 *
 * Deux signaux, tous deux côté serveur : une réponse HTTP 426 à n'importe quel
 * appel, ou GET /api/mobile/config (drapeau `updateCheck`) qui annonce la version
 * minimale et une éventuelle maintenance. Sans signal, rien n'est jamais bloqué.
 */
export function UpdateGate({ children, renderUpdate, renderMaintenance }: Props) {
  const [refused, setRefused] = useState(false);
  useEffect(() => onUpgradeRequired(() => setRefused(true)), []);

  const config = useQuery({
    queryKey: queryKeys.mobileConfig,
    queryFn: () => fetchMobileConfig(api),
    enabled: isFeatureEnabled('updateCheck'),
    staleTime: 60 * 60_000,
    retry: false,
  });

  const minimum = Platform.OS === 'ios' ? config.data?.minSupportedVersion.ios : config.data?.minSupportedVersion.android;
  const required = refused || isUpdateRequired(getAppVersion().version, minimum);
  const serverStore = Platform.OS === 'ios' ? config.data?.storeUrls.ios : config.data?.storeUrls.android;

  if (required) return <>{renderUpdate(serverStore ?? null)}</>;
  // La maintenance n'est affichée que sur un `true` explicite du serveur.
  if (config.data?.maintenance.enabled) {
    return <>{renderMaintenance(config.data.maintenance.message, () => void config.refetch())}</>;
  }
  return <>{children}</>;
}
