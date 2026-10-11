import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchSitesPage, type Site } from '@/api/domains/ops';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { AtlasHeader, PagedList, SearchBar, SiteRow } from '@/components/ui';
import { access } from '@/features/access';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';

export default function SitesScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const allowed = access.sites(user);

  const list = usePagedList<Site>({
    queryKey: queryKeys.scoped(scope.society, null, 'sites', q),
    fetchPage: (page) => fetchSitesPage(api, { q: q || undefined, society: scope.society ?? undefined, page }),
    enabled: allowed && ready,
  });

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="sites-screen">
        <AtlasHeader back title={t('entry.sites')} subtitle={list.total > 0 ? t('sites.count', { count: list.total, society: societyLabel(scope) }) : societyLabel(scope)} />
        <View style={styles.search}>
          <SearchBar testID="sites-search" value={search} onChangeText={setSearch} placeholder={t('sites.search')} />
        </View>
        <PagedList
          testID="sites-list"
          list={list}
          keyOf={(site) => String(site.id)}
          emptyTitle={t('sites.empty.title')}
          emptyBody={q ? t('search.noResult', { q }) : undefined}
          renderItem={(site) => (
            <SiteRow
              testID={`site-${site.id}`}
              name={site.name}
              detail={[site.client, site.commune, site.wilaya].filter(Boolean).join(' · ') || null}
              society={site.society}
              staff={site.contractualStaff > 0 ? site.contractualStaff : null}
              staffLabel={t('sites.staff', { count: site.contractualStaff })}
              onPress={() => router.push(`/ops/sites/${site.id}` as never)}
            />
          )}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  search: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
