import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../../components/icon';
import { OfferCard } from '../../../components/offer-card';
import { Button, Chip, colors, EmptyState, ErrorState, fonts, Loading, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { activeFilterCount, Facets, fetchOffers, Offer, OfferFilters } from '../../../lib/emploi';
import { useServer } from '../../../lib/server';

type Params = { q?: string; wilaya?: string; profession?: string };

export default function Offers() {
  const { mode, retry } = useServer();
  const params = useLocalSearchParams<Params>();
  const [query, setQuery] = useState(''), [filters, setFilters] = useState<OfferFilters>({});
  const [items, setItems] = useState<Offer[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [pages, setPages] = useState(1);
  const [facets, setFacets] = useState<Facets | null>(null), [more, setMore] = useState(false), [error, setError] = useState('');
  const [sheet, setSheet] = useState(false), [{ reload, pulled }, setRun] = useState({ reload: 0, pulled: -1 }), [settled, setSettled] = useState('');
  const current = useRef('');

  // Recherche lancée depuis l'accueil (texte ou raccourci de filtre) : appliquée une fois par navigation.
  const incoming = params.q === undefined && params.wilaya === undefined && params.profession === undefined ? '' : `${params.q || ''}|${params.wilaya || ''}|${params.profession || ''}`;
  const [applied, setApplied] = useState('');
  if (incoming && incoming !== applied) {
    setApplied(incoming); setQuery(params.q || '');
    setFilters({ ...(params.wilaya ? { wilaya: params.wilaya } : {}), ...(params.profession ? { profession: params.profession } : {}) });
  }

  // Une clé par recherche : « en cours » tant que la dernière recherche aboutie n'est pas celle affichée.
  const key = JSON.stringify([query.trim(), filters, reload]);
  const loading = mode === 'emploi' && settled !== key, refreshing = loading && pulled === reload;
  useEffect(() => {
    if (mode !== 'emploi') return;
    const controller = new AbortController();
    current.current = key;
    // Courte attente pendant la frappe ; la requête précédente est abandonnée.
    const timer = setTimeout(() => {
      fetchOffers({ ...filters, q: query }, 1, controller.signal)
        .then(result => { if (controller.signal.aborted) return; setItems(result.items); setTotal(result.total); setPage(result.page); setPages(result.pages); setFacets(result.facets); setError(''); setSettled(key); })
        .catch(reason => { if (!controller.signal.aborted) { setItems([]); setError(errorMessage(reason)); setSettled(key); } });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, key]);

  async function loadMore() {
    if (more || loading || page >= pages) return;
    const started = key;
    setMore(true);
    try {
      const result = await fetchOffers({ ...filters, q: query }, page + 1);
      if (started !== current.current) return;
      setItems(previous => [...previous, ...result.items.filter(offer => !previous.some(item => item.id === offer.id))]); setPage(result.page); setPages(result.pages); setError('');
    } catch (reason) { if (started === current.current) setError(errorMessage(reason)); }
    finally { setMore(false); }
  }
  const retryList = () => setRun(run => ({ reload: run.reload + 1, pulled: run.pulled }));

  const count = activeFilterCount(filters), searching = !!query.trim() || count > 0;
  const reset = () => { setQuery(''); setFilters({}); };

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <View style={list.header}>
        <Text accessibilityRole="header" style={styles.title}>Explorer les offres</Text>
        <View style={list.searchRow}>
          <View style={list.search}>
            <Icon name="search" size={20} color={colors.navy} />
            <TextInput accessibilityLabel="Rechercher une offre" placeholder="Métier, entreprise…" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery}
              returnKeyType="search" autoCorrect={false} style={list.searchInput} />
            {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" hitSlop={10} onPress={() => setQuery('')}><Icon name="close" size={18} color={colors.muted} /></Pressable>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={count ? `Filtres, ${count} actif${count > 1 ? 's' : ''}` : 'Filtres'} disabled={!facets}
            onPress={() => setSheet(true)} style={[list.filter, count > 0 && { backgroundColor: colors.navy, borderColor: colors.navy }, !facets && { opacity: 0.5 }]}>
            <Icon name="sliders" size={22} color={count ? colors.white : colors.navy} />
            {count > 0 && <View style={list.dot}><Text style={list.dotText}>{count}</Text></View>}
          </Pressable>
        </View>
        {mode === 'emploi' && !loading && !error && <Text style={list.count}>{total} offre{total > 1 ? 's' : ''} disponible{total > 1 ? 's' : ''}</Text>}
      </View>

      {mode === 'loading' ? <Loading label="Chargement des offres…" />
        : mode === 'offline' ? <ErrorState message="Connexion indisponible. Vérifiez votre réseau puis réessayez." onRetry={retry} />
        : mode === 'legacy' ? <EmptyState icon="briefcase" title="Offres bientôt disponibles" text="Le service des annonces n’est pas encore ouvert. La candidature spontanée reste possible depuis l’accueil." />
        : (
          <FlatList data={items} keyExtractor={offer => String(offer.id)} renderItem={({ item }) => <OfferCard offer={item} />} keyboardShouldPersistTaps="handled"
            contentContainerStyle={list.content} onEndReached={loadMore} onEndReachedThreshold={0.4}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setRun(run => ({ reload: run.reload + 1, pulled: run.reload + 1 }))} tintColor={colors.navy} />}
            ListEmptyComponent={loading ? <Loading label="Chargement des offres…" />
              : error ? <ErrorState message={error} onRetry={retryList} />
              : searching ? <EmptyState icon="search" title="Aucun résultat" text="Aucune offre ne correspond à votre recherche." action="Réinitialiser la recherche" onAction={reset} />
              : <EmptyState icon="briefcase" title="Aucune offre pour le moment" text="Aucune annonce n’est publiée actuellement. Revenez bientôt ou déposez une candidature spontanée depuis l’accueil." />}
            ListFooterComponent={items.length ? (more ? <Loading label="Chargement…" /> : error ? <ErrorState message={error} onRetry={loadMore} />
              : page < pages ? <Button title="Afficher plus d’offres" secondary onPress={loadMore} /> : null) : null} />
        )}

      {facets && sheet && <FilterSheet facets={facets} value={filters} onClose={() => setSheet(false)} onApply={next => { setFilters(next); setSheet(false); }} />}
    </SafeAreaView>
  );
}

// Monté à l'ouverture seulement : le brouillon repart toujours des filtres appliqués.
function FilterSheet({ facets, value, onClose, onApply }: { facets: Facets; value: OfferFilters; onClose: () => void; onApply: (filters: OfferFilters) => void }) {
  const [draft, setDraft] = useState<OfferFilters>(value);
  const pick = <K extends keyof OfferFilters>(key: K, option: OfferFilters[K]) => setDraft(previous => ({ ...previous, [key]: previous[key] === option ? undefined : option }));
  const groups: { title: string; key: keyof OfferFilters; options: { value: string | number; label: string }[] }[] = [
    { title: 'Wilaya', key: 'wilaya', options: facets.wilayas.map(item => ({ value: item, label: item })) },
    { title: 'Métier', key: 'profession', options: facets.professions.map(item => ({ value: item, label: item })) },
    { title: 'Société', key: 'company_id', options: facets.companies.map(item => ({ value: item.id, label: item.name })) },
    { title: 'Type de contrat', key: 'contract_type', options: facets.contract_types.map(item => ({ value: item, label: item })) },
  ];
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={list.sheetHead}>
          <Text accessibilityRole="header" style={styles.heading}>Filtrer les offres</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer les filtres" hitSlop={12} onPress={onClose}><Icon name="close" size={24} color={colors.navy} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 20 }}>
          {groups.map(group => (
            <View key={group.key} style={{ gap: 10 }}>
              <Text style={styles.label}>{group.title}</Text>
              {group.options.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {group.options.map(option => <Chip key={String(option.value)} label={option.label} selected={draft[group.key] === option.value} onPress={() => pick(group.key, option.value as never)} />)}
                </View>
              ) : <Text style={styles.subtitle}>Aucun choix disponible parmi les offres publiées.</Text>}
            </View>
          ))}
        </ScrollView>
        <View style={list.sheetActions}>
          <View style={{ flex: 1 }}><Button title="Tout effacer" secondary onPress={() => setDraft({})} /></View>
          <View style={{ flex: 1 }}><Button title="Appliquer" onPress={() => onApply(draft)} /></View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const list = StyleSheet.create({
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6, gap: 12 }, searchRow: { flexDirection: 'row', gap: 10 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, minHeight: 50 },
  searchInput: { flex: 1, fontSize: 17.5, fontFamily: fonts.sans, color: colors.ink, paddingVertical: 11 },
  filter: { width: 50, height: 50, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: -5, right: -5, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dotText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.white }, count: { fontSize: 15, fontFamily: fonts.sans, color: colors.ink },
  content: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 32, gap: 12, flexGrow: 1 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.white },
  sheetActions: { flexDirection: 'row', gap: 12, padding: 18, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white },
});
