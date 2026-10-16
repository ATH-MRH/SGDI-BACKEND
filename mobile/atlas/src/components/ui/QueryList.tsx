import type { ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { EmptyState, ErrorState, SkeletonList } from './States';

type Props<T> = {
  /** État de la requête qui a chargé `items` (chargement, erreur, actualisation). */
  state: { isPending: boolean; error: unknown; isRefetching: boolean; refetch: () => unknown };
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  header?: ReactElement;
  emptyTitle: string;
  emptyBody?: string;
  testID?: string;
};

/**
 * Liste d'une collection déjà chargée en entier par le serveur (et filtrée sur l'appareil) :
 * même rendu et mêmes états que PagedList. L'en-tête reste visible en chargement et en erreur.
 */
export function QueryList<T>({ state, items, keyOf, renderItem, header, emptyTitle, emptyBody, testID }: Props<T>) {
  const failed = Boolean(state.error) && items.length === 0;
  if (state.isPending || failed) {
    return (
      <View style={styles.fill}>
        {header ? <View style={styles.headerOnly}>{header}</View> : null}
        {state.isPending ? (
          <SkeletonList rows={5} testID={testID ? `${testID}-loading` : undefined} />
        ) : (
          <ErrorState error={state.error} onRetry={() => void state.refetch()} testID={testID ? `${testID}-error` : undefined} />
        )}
      </View>
    );
  }
  return (
    <FlatList
      testID={testID}
      data={items}
      keyExtractor={keyOf}
      renderItem={({ item }) => renderItem(item)}
      ListHeaderComponent={header}
      ItemSeparatorComponent={Separator}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={15}
      windowSize={7}
      refreshControl={<RefreshControl refreshing={state.isRefetching} onRefresh={() => void state.refetch()} tintColor={colors.primary} />}
      ListEmptyComponent={<EmptyState title={emptyTitle} body={emptyBody} testID={testID ? `${testID}-empty` : undefined} />}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerOnly: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, marginBottom: -spacing.lg },
  content: { padding: spacing.lg, flexGrow: 1 },
  separator: { height: spacing.sm },
});
