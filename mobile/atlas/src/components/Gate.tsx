import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

import { Button, EmptyState, Screen } from './ui';

/**
 * Garde d'écran : chaque route métier refait le contrôle d'accès, pour qu'un
 * lien direct ou une notification ne contourne jamais le menu.
 */
export function Gate({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  const router = useRouter();
  if (allowed) return <>{children}</>;
  return (
    <Screen scroll={false} edges={['top', 'bottom', 'left', 'right']} testID="access-denied">
      <EmptyState icon="lock-closed-outline" title={t('module.denied.title')} body={t('module.denied.body')} />
      <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
