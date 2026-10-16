import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useAuth, useCurrentUser } from '@/auth/AuthProvider';
import { societyScope } from '@/auth/permissions';
import { AppText, AtlasHeader, Avatar, Badge, Button, Card, Chip, InfoRow, ListItem, Screen, SectionHeader } from '@/components/ui';
import { VersionLabel } from '@/components/VersionLabel';
import { access } from '@/features/access';
import { visibleModules } from '@/features/modules';
import { t } from '@/i18n';
import { currentSiteLabel, siteLabel, societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';

const MAX_SITES_LISTED = 5;

/** Profil : qui est connecté, sur quel périmètre, avec quels modules ; accès aux paramètres et déconnexion. */
export default function ProfileScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const user = useCurrentUser();
  const { scope } = useScope();
  if (!user) return null;

  const societies = societyScope(user);
  const displayName = user.full_name || user.username;
  const societiesLabel =
    societies.kind === 'global'
      ? t('home.scope.global')
      : societies.kind === 'limited'
        ? societies.societies.join(', ')
        : t('home.scope.none');
  const modules = visibleModules(user);
  const sitesLabel =
    scope.sites.length === 0
      ? scope.globalAccess || societies.kind === 'limited'
        ? t('scope.allSites')
        : t('common.none')
      : scope.sites.length <= MAX_SITES_LISTED
        ? scope.sites.map(siteLabel).join(', ')
        : t('profile.sites.count', { count: scope.sites.length });

  return (
    <Screen testID="profile-screen" header={<AtlasHeader title={t('tabs.profile')} subtitle={t('more.subtitle')} />}>
      <Card style={styles.identity} testID="profile-identity">
        <Avatar name={displayName} size={72} />
        <View style={styles.identityText}>
          <AppText variant="heading" color={colors.navy} accessibilityRole="header" numberOfLines={2} style={styles.name}>
            {displayName}
          </AppText>
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
            @{user.username}
          </AppText>
          <Badge label={user.role} tone="info" />
          <Chip icon="location-outline" label={`${currentSiteLabel(scope)} – ${societyLabel(scope)}`} />
        </View>
      </Card>

      <Card>
        <SectionHeader title={t('more.scope')} />
        <View>
          <InfoRow testID="profile-societies" icon="briefcase-outline" label={t('profile.societies')} value={societiesLabel} />
          <InfoRow testID="profile-sites" icon="location-outline" label={t('profile.sites')} value={sitesLabel} />
          <InfoRow
            testID="profile-modules"
            icon="grid-outline"
            label={t('profile.modules')}
            value={modules.length ? modules.map((module) => t(module.title)).join(', ') : t('common.none')}
            last
          />
        </View>
        {scope.canChangeSociety || scope.canChangeSite ? (
          <Button testID="profile-change-scope" variant="secondary" icon="swap-horizontal-outline" label={t('home.context.change')} onPress={() => router.push('/scope')} />
        ) : null}
      </Card>

      <Card>
        <SectionHeader title={t('home.shortcuts.title')} />
        <ListItem testID="more-settings" icon="settings-outline" title={t('modules.settings')} subtitle={t('settings.subtitle')} onPress={() => router.push('/settings' as never)} />
        <ListItem testID="more-tasks" icon="checkbox-outline" title={t('tabs.tasks')} subtitle={t('modules.tasks.body')} onPress={() => router.push('/tasks' as never)} />
        {access.alerts(user) ? (
          <ListItem testID="more-alerts" icon="notifications-outline" iconTone="warning" title={t('tabs.alerts')} subtitle={t('modules.alerts.body')} onPress={() => router.push('/alerts' as never)} />
        ) : null}
      </Card>

      <Button testID="sign-out" variant="danger" icon="log-out-outline" label={t('profile.signOut')} onPress={() => void signOut()} />
      <VersionLabel />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  identityText: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  name: { fontSize: 19, lineHeight: 24 },
});
