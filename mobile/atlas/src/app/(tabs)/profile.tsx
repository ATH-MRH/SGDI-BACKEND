import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { useAuth, useCurrentUser } from '@/auth/AuthProvider';
import { grantedActions, societyScope } from '@/auth/permissions';
import { ActionTile, AppText, AtlasHeader, Avatar, Badge, Banner, Button, Card, IconTile, InfoRow, ListItem, Screen, SectionHeader } from '@/components/ui';
import { VersionLabel } from '@/components/VersionLabel';
import { env } from '@/config/env';
import { access } from '@/features/access';
import { visibleModules } from '@/features/modules';
import { t } from '@/i18n';
import { useLock } from '@/lock/LockProvider';
import { usePush } from '@/push/PushProvider';
import { siteLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing, touchTarget } from '@/theme/tokens';

const MAX_SITES_LISTED = 5;

function hostOf(url: string | null): string {
  return url ? url.replace(/^https?:\/\//, '').split('/')[0] ?? '' : '';
}

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const user = useCurrentUser();
  const { scope } = useScope();
  const lock = useLock();
  const push = usePush();
  const [lockBusy, setLockBusy] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
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

  async function toggleLock(next: boolean) {
    if (lockBusy) return;
    setLockBusy(true);
    setLockNotice(null);
    if (next && lock.capability !== 'available') {
      setLockNotice(t(lock.capability === 'notEnrolled' ? 'profile.lock.notEnrolled' : 'profile.lock.unavailable'));
    } else {
      const result = await (next ? lock.enable() : lock.disable());
      if (result === 'unavailable') setLockNotice(t('profile.lock.unavailable'));
      else if (result !== 'success' && result !== 'cancelled') setLockNotice(t('profile.lock.failed'));
    }
    setLockBusy(false);
  }

  return (
    <Screen testID="profile-screen" header={<AtlasHeader title={t('tabs.more')} subtitle={t('more.subtitle')} />}>
      <Card style={styles.identity}>
        <Avatar name={displayName} size={64} />
        <View style={styles.identityText}>
          <AppText variant="heading" color={colors.navy} accessibilityRole="header" numberOfLines={2}>
            {displayName}
          </AppText>
          <Badge label={user.role} tone="info" />
        </View>
      </Card>

      <View style={styles.section}>
        <SectionHeader title={t('home.shortcuts.title')} />
        <View style={styles.grid}>
          <ActionTile testID="more-tasks" icon="checkbox-outline" label={t('tabs.tasks')} onPress={() => router.push('/tasks' as never)} />
          {access.alerts(user) ? (
            <ActionTile testID="more-alerts" icon="notifications-outline" tone="warning" label={t('tabs.alerts')} onPress={() => router.push('/alerts' as never)} />
          ) : null}
        </View>
      </View>

      <Card>
        <SectionHeader title={t('more.account')} />
        <View>
          <InfoRow icon="person-outline" label={t('profile.fullName')} value={user.full_name || t('common.none')} />
          <InfoRow icon="at-outline" label={t('profile.username')} value={user.username} />
          <InfoRow icon="ribbon-outline" label={t('profile.role')} value={user.role} />
          <InfoRow icon="mail-outline" label={t('profile.email')} value={user.email || t('common.none')} last />
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
          <Button
            testID="profile-change-scope"
            variant="secondary"
            icon="swap-horizontal-outline"
            label={t('home.context.change')}
            onPress={() => router.push('/scope')}
          />
        ) : null}
      </Card>

      {lock.supported ? (
        <Card testID="profile-security">
          <SectionHeader title={t('profile.security')} />
          <View style={styles.switchRow}>
            <IconTile icon="finger-print-outline" size={38} />
            <AppText variant="bodyStrong" style={styles.switchLabel}>
              {t('profile.lock.toggle')}
            </AppText>
            <Switch
              testID="profile-lock-switch"
              accessibilityLabel={t('profile.lock.toggle')}
              value={lock.enabled}
              disabled={lockBusy}
              trackColor={{ true: colors.navy, false: colors.borderStrong }}
              onValueChange={(next) => void toggleLock(next)}
            />
          </View>
          <AppText variant="caption" color={colors.textSecondary}>
            {t('profile.lock.hint')}
          </AppText>
          {lockNotice ? <Banner tone="warning" message={lockNotice} testID="profile-lock-notice" /> : null}
          {lock.enabled ? (
            <Button testID="profile-lock-now" variant="secondary" icon="lock-closed-outline" label={t('profile.lock.lockNow')} onPress={lock.lockNow} />
          ) : null}
        </Card>
      ) : null}

      {push.available ? (
        <Card testID="profile-push">
          <SectionHeader title={t('profile.push')} />
          <AppText color={colors.textSecondary} testID="profile-push-status">
            {t(`profile.push.${push.status}`)}
          </AppText>
          {push.status === 'undetermined' ? (
            <Button testID="profile-push-enable" variant="secondary" icon="notifications-outline" label={t('profile.push.enable')} onPress={() => void push.enable()} />
          ) : null}
        </Card>
      ) : null}

      <Button testID="sign-out" variant="danger" icon="log-out-outline" label={t('profile.signOut')} onPress={() => void signOut()} />

      <Card>
        <SectionHeader title={t('profile.about')} />
        <VersionLabel />
        <View style={styles.environment}>
          <AppText variant="caption" color={colors.textMuted}>
            {t('profile.environment')}
          </AppText>
          <Badge
            testID="profile-environment"
            tone={env.variant === 'production' ? 'neutral' : 'warning'}
            label={env.variant === 'production' ? t('profile.environment.production') : t(`app.environment.${env.variant}`)}
          />
        </View>
      </Card>

      {env.variant === 'development' ? (
        <Card testID="profile-diagnostics">
          <SectionHeader title={t('profile.diagnostics')} />
          <ListItem title={t('profile.diag.apiHost')} subtitle={hostOf(env.apiUrl)} />
          <ListItem title={t('profile.diag.modules')} subtitle={(user.effective_modules ?? []).join(', ') || t('common.none')} />
          <ListItem title={t('profile.diag.actions')} subtitle={grantedActions(user).join(', ') || t('common.none')} />
          <ListItem title={t('profile.diag.scope')} subtitle={[scope.society ?? '*', scope.site ? siteLabel(scope.site) : '*'].join(' / ')} />
          <ListItem
            title={t('profile.diag.flags')}
            subtitle={Object.entries(env.features).filter(([, enabled]) => enabled).map(([key]) => key).join(', ') || t('common.none')}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  identityText: { flex: 1, gap: spacing.xs },
  section: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  switchRow: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchLabel: { flex: 1 },
  environment: { alignItems: 'center', gap: spacing.xs },
});
