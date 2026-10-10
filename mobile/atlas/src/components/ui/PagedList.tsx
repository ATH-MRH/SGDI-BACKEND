import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import type { PagedList as PagedListState } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import { EmptyState, ErrorState, Loader } from './States';

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
  if (list.isLoading) return <Loader />;
  if (list.error && list.items.length === 0) {
    return <ErrorState error={list.error} onRetry={list.refresh} testID={testID ? `${testID}-error` : undefined} />;
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
  separator: { height: spacing.sm },
  footer: { padding: spacing.lg },
  count: { textAlign: 'center', padding: spacing.md },
});
