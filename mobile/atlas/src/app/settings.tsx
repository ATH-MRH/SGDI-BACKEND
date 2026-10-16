import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { useCurrentUser } from '@/auth/AuthProvider';
import { grantedActions } from '@/auth/permissions';
import { AppText, AtlasHeader, Badge, Banner, Button, Card, IconTile, InfoRow, ListItem, Screen, SectionHeader } from '@/components/ui';
import { VersionLabel } from '@/components/VersionLabel';
import { env } from '@/config/env';
import { getLocale, t } from '@/i18n';
import { useLock } from '@/lock/LockProvider';
import { useOffline } from '@/offline/OfflineProvider';
import { usePush } from '@/push/PushProvider';
import { siteLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing, touchTarget } from '@/theme/tokens';

function hostOf(url: string | null): string {
  return url ? url.replace(/^https?:\/\//, '').split('/')[0] ?? '' : '';
}

/**
 * Paramètres de l'application sur cet appareil. Seuls les réglages réellement pris en charge
 * sont modifiables ; les autres sont affichés tels qu'ils s'appliquent.
 */
export default function SettingsScreen() {
  const user = useCurrentUser();
  const { scope } = useScope();
  const lock = useLock();
  const push = usePush();
  const offline = useOffline();
  const [lockBusy, setLockBusy] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  if (!user) return null;

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

  const pending = offline.enabled ? offline.items.length : null;

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} testID="settings-screen" header={<AtlasHeader back title={t('settings.title')} subtitle={t('settings.subtitle')} />}>
      <Card testID="settings-account">
        <SectionHeader title={t('more.account')} />
        <View>
          <InfoRow icon="person-outline" label={t('profile.fullName')} value={user.full_name || t('common.none')} />
          <InfoRow icon="at-outline" label={t('profile.username')} value={user.username} />
          <InfoRow icon="ribbon-outline" label={t('profile.role')} value={user.role} />
          <InfoRow icon="mail-outline" label={t('profile.email')} value={user.email || t('common.none')} />
          <InfoRow icon="key-outline" label={t('settings.password')} value={t('settings.password.web')} last />
        </View>
      </Card>

      {lock.supported ? (
        <Card testID="profile-security">
          <SectionHeader title={t('settings.biometrics')} hint={t('profile.security')} />
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

      <Card testID="profile-push">
        <SectionHeader title={t('profile.push')} />
        <AppText color={colors.textSecondary} testID="profile-push-status">
          {t(`profile.push.${push.available ? push.status : 'unsupported'}`)}
        </AppText>
        {push.available && push.status === 'undetermined' ? (
          <Button testID="profile-push-enable" variant="secondary" icon="notifications-outline" label={t('profile.push.enable')} onPress={() => void push.enable()} />
        ) : null}
      </Card>

      <Card testID="settings-display">
        <SectionHeader title={t('settings.display')} />
        <View>
          <InfoRow testID="settings-language" icon="language-outline" label={t('settings.language')} value={t(getLocale() === 'ar' ? 'settings.language.ar' : 'settings.language.fr')} />
          <InfoRow testID="settings-appearance" icon="sunny-outline" label={t('settings.appearance')} value={t('settings.appearance.light')} last />
        </View>
        <AppText variant="caption" color={colors.textMuted}>
          {t('settings.language.hint')}
        </AppText>
      </Card>

      <Card testID="settings-data">
        <SectionHeader title={t('settings.data')} />
        <View>
          {pending !== null ? <InfoRow testID="settings-offline" icon="cloud-upload-outline" label={t('settings.data.offline')} value={String(pending)} /> : null}
          <InfoRow icon="shield-checkmark-outline" label={t('settings.data.storage')} value={t('settings.data.storage.value')} last />
        </View>
      </Card>

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
  switchRow: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchLabel: { flex: 1 },
  environment: { alignItems: 'center', gap: spacing.xs },
});
