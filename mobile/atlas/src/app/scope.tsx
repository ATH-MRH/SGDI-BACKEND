import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Button, Card, EmptyState, Loader, OptionRow, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { siteLabel, societyLabel } from '@/scope/labels';
import { selectionOf, type ScopeSelection } from '@/scope/model';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';

/** Choix de la société et du site de travail, parmi ce que le compte est autorisé à voir. */
export default function ScopeScreen() {
  const router = useRouter();
  const { scope, ready, setScope, preview } = useScope();
  const [draft, setDraft] = useState<ScopeSelection | null>(null);
  const [saving, setSaving] = useState(false);

  if (!ready) {
    return (
      <Screen scroll={false} edges={['top', 'bottom', 'left', 'right']} testID="scope-screen">
        <Loader label={t('scope.loading')} />
      </Screen>
    );
  }

  // Le brouillon est revalidé à chaque choix : changer de société peut invalider le site.
  const view = draft ? preview(draft) : scope;
  const selection = selectionOf(view);

  if (!view.globalAccess && view.societies.length === 0) {
    return (
      <Screen scroll={false} edges={['top', 'bottom', 'left', 'right']} testID="scope-screen">
        <EmptyState icon="business-outline" title={t('scope.none.title')} body={t('scope.none.body')} testID="scope-none" />
        <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  async function apply() {
    setSaving(true);
    await setScope(selection);
    router.back();
  }

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} testID="scope-screen">
      <AppText variant="title" accessibilityRole="header">
        {t('scope.title')}
      </AppText>
      <AppText color={colors.textSecondary}>{t('scope.intro')}</AppText>

      <Card>
        <AppText variant="label" color={colors.textSecondary}>
          {t('scope.society')}
        </AppText>
        {view.canChangeSociety ? (
          <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
            <OptionRow
              testID="scope-society-all"
              label={view.globalAccess ? t('home.scope.global') : t('scope.allSocieties')}
              selected={selection.society === null}
              onPress={() => setDraft({ society: null, siteId: null })}
            />
            {view.societies.map((society) => (
              <OptionRow
                key={society}
                testID={`scope-society-${society}`}
                label={society}
                selected={selection.society === society}
                onPress={() => setDraft({ society, siteId: null })}
              />
            ))}
          </View>
        ) : (
          <AppText variant="bodyStrong" testID="scope-society-fixed">
            {societyLabel(view)}
          </AppText>
        )}
      </Card>

      <Card>
        <AppText variant="label" color={colors.textSecondary}>
          {t('scope.site')}
        </AppText>
        {view.canChangeSite ? (
          <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
            <OptionRow
              testID="scope-site-all"
              label={t('scope.allSites')}
              selected={selection.siteId === null}
              onPress={() => setDraft({ society: selection.society, siteId: null })}
            />
            {view.sites.map((site) => (
              <OptionRow
                key={site.id}
                testID={`scope-site-${site.id}`}
                label={siteLabel(site)}
                selected={selection.siteId === site.id}
                onPress={() => setDraft({ society: selection.society, siteId: site.id })}
              />
            ))}
          </View>
        ) : (
          <AppText variant="bodyStrong" testID="scope-site-fixed">
            {view.site ? siteLabel(view.site) : t('scope.allSites')}
          </AppText>
        )}
      </Card>

      <Button testID="scope-apply" label={t('common.apply')} loading={saving} onPress={() => void apply()} />
      <Button label={t('common.cancel')} variant="secondary" disabled={saving} onPress={() => router.back()} />
    </Screen>
  );
}
