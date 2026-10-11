import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StyleSheet, View } from 'react-native';

import { ActionTile, AtlasHeader, Banner, Screen } from '@/components/ui';
import { moduleEntries } from '@/features/entries';
import { findVisibleModule } from '@/features/modules';
import { t } from '@/i18n';
import { currentSiteLabel, societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { spacing } from '@/theme/tokens';

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
      <Screen
        edges={['top', 'bottom', 'left', 'right']}
        testID={`module-screen-${module?.key ?? 'none'}`}
        header={<AtlasHeader back title={module ? t(module.title) : ''} subtitle={`${societyLabel(scope)} · ${currentSiteLabel(scope)}`} />}>
        {entries.length > 0 ? (
          <View style={styles.grid}>
            {entries.map((entry) => (
              <ActionTile key={entry.key} testID={`entry-${entry.key}`} icon={entry.icon} label={t(entry.title)} onPress={() => router.push(entry.route as never)} />
            ))}
          </View>
        ) : (
          <Banner testID="module-soon" tone="info" message={t('module.soon.body')} />
        )}
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
