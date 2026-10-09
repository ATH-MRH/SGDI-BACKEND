import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { AppText, Card, ListItem, Screen, ScreenHeader } from '@/components/ui';
import { moduleEntries } from '@/features/entries';
import { findVisibleModule } from '@/features/modules';
import { t } from '@/i18n';
import { currentSiteLabel, societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors } from '@/theme/tokens';

/**
 * Accueil d'un module métier. La garde est ici, pas dans le menu : une route
 * ouverte directement (lien profond) est refusée de la même façon.
 */
export default function ModuleScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const user = useCurrentUser();
  const { scope } = useScope();
  const module = findVisibleModule(user, key);
  const entries = module ? moduleEntries(user, module.key) : [];

  return (
    <Gate allowed={module !== null}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID={`module-screen-${module?.key ?? 'none'}`}>
        <ScreenHeader title={module ? t(module.title) : ''} subtitle={`${societyLabel(scope)} · ${currentSiteLabel(scope)}`} />
        {entries.length > 0 ? (
          <Card>
            {entries.map((entry) => (
              <ListItem
                key={entry.key}
                testID={`entry-${entry.key}`}
                icon={entry.icon}
                title={t(entry.title)}
                onPress={() => router.push(entry.route as never)}
                trailing={<Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
              />
            ))}
          </Card>
        ) : (
          <Card testID="module-soon">
            <AppText color={colors.textSecondary}>{t('module.soon.body')}</AppText>
          </Card>
        )}
      </Screen>
    </Gate>
  );
}
