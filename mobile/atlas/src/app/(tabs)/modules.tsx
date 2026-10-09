import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useCurrentUser } from '@/auth/AuthProvider';
import { AppText, Card, EmptyState, ListItem, Screen } from '@/components/ui';
import { visibleModules } from '@/features/modules';
import { t } from '@/i18n';
import { colors } from '@/theme/tokens';

/** Le menu est construit à partir des modules accordés : un module non autorisé n'y figure pas. */
export default function ModulesScreen() {
  const router = useRouter();
  const modules = visibleModules(useCurrentUser());

  if (modules.length === 0) {
    return (
      <Screen scroll={false} testID="modules-screen">
        <EmptyState icon="grid-outline" title={t('modules.empty.title')} body={t('modules.empty.body')} testID="modules-empty" />
      </Screen>
    );
  }

  return (
    <Screen testID="modules-screen">
      <AppText variant="title" accessibilityRole="header">
        {t('tabs.modules')}
      </AppText>
      <Card>
        {modules.map((module) => (
          <ListItem
            key={module.key}
            testID={`module-${module.key}`}
            icon={module.icon}
            title={t(module.title)}
            subtitle={t(module.body)}
            onPress={() => router.push({ pathname: '/module/[key]', params: { key: module.key } })}
            trailing={<Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
          />
        ))}
      </Card>
    </Screen>
  );
}
