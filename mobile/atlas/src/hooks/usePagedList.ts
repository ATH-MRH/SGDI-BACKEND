import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Page } from '@/api/types';

type Options<T> = {
  queryKey: QueryKey;
  /** Charge UNE page côté serveur ; jamais la liste complète. */
  fetchPage: (page: number) => Promise<Page<T>>;
  enabled?: boolean;
};

/** Les trois premiers segments d'une clé `scoped` portent la société et le site. */
function sameScope(a: QueryKey, b: QueryKey): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Liste paginée par le serveur, chargée page après page au défilement. */
export function usePagedList<T>({ queryKey, fetchPage, enabled = true }: Options<T>) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
    enabled,
    // Pendant une recherche, la liste précédente reste affichée au lieu de clignoter
    // sur un indicateur de chargement — sauf si la société ou le site ont changé.
    placeholderData: (previous, previousQuery) =>
      previousQuery && sameScope(previousQuery.queryKey, queryKey) ? previous : undefined,
  });

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return {
    items,
    total: query.data?.pages[0]?.total ?? 0,
    isLoading: query.isPending && enabled,
    isRefreshing: query.isRefetching && !query.isFetchingNextPage,
    isLoadingMore: query.isFetchingNextPage,
    error: query.error,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refresh: () => void query.refetch(),
  };
}

export type PagedList<T> = ReturnType<typeof usePagedList<T>>;
