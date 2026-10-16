import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import type { PagedList as PagedListState } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import { EmptyState, ErrorState, SkeletonList } from './States';

type Props<T> = {
  list: PagedListState<T>;
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  emptyTitle: string;
  emptyBody?: string;
  header?: ReactElement;
  testID?: string;
};

/** Liste virtualisée et paginée, avec ses états : chargement, erreur, vide, page suivante. */
export function PagedList<T>({ list, keyOf, renderItem, emptyTitle, emptyBody, header, testID }: Props<T>) {
  // L'en-tête (recherche, filtres, synthèse) reste visible pendant le chargement et en cas d'erreur.
  if (list.isLoading || (list.error && list.items.length === 0)) {
    return (
      <View style={styles.fill}>
        {header ? <View style={styles.headerOnly}>{header}</View> : null}
        {list.isLoading ? (
          <SkeletonList rows={5} testID={testID ? `${testID}-loading` : undefined} />
        ) : (
          <ErrorState error={list.error} onRetry={list.refresh} testID={testID ? `${testID}-error` : undefined} />
        )}
      </View>
    );
  }
  return (
    <FlatList
      testID={testID}
      data={list.items}
      keyExtractor={keyOf}
      renderItem={({ item }) => renderItem(item)}
      ListHeaderComponent={header}
      ItemSeparatorComponent={Separator}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.4}
      onEndReached={list.loadMore}
      refreshControl={<RefreshControl refreshing={list.isRefreshing} onRefresh={list.refresh} tintColor={colors.primary} />}
      ListEmptyComponent={<EmptyState title={emptyTitle} body={emptyBody} testID={testID ? `${testID}-empty` : undefined} />}
      ListFooterComponent={
        list.isLoadingMore ? (
          <ActivityIndicator style={styles.footer} color={colors.primary} />
        ) : list.items.length > 0 ? (
          <AppText variant="caption" color={colors.textMuted} style={styles.count}>
            {t('list.count', { shown: list.items.length, total: Math.max(list.total, list.items.length) })}
          </AppText>
        ) : null
      }
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: 0, flexGrow: 1 },
  fill: { flex: 1 },
  headerOnly: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, marginBottom: -spacing.lg },
  separator: { height: spacing.sm },
  footer: { padding: spacing.lg },
  count: { textAlign: 'center', padding: spacing.md },
});
