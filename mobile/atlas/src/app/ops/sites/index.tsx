import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchSitesPage, type Site } from '@/api/domains/ops';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Card, ListItem, PagedList, ScreenHeader, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
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
        <ScreenHeader title={t('entry.sites')} />
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
            <Card>
              <ListItem
                testID={`site-${site.id}`}
                icon="business-outline"
                title={site.name}
                subtitle={[site.client, site.commune, site.wilaya].filter(Boolean).join(' · ') || undefined}
                onPress={() => router.push(`/ops/sites/${site.id}` as never)}
                trailing={<Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
              />
            </Card>
          )}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  search: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
