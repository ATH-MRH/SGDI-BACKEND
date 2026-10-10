import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../../../components/icon';
import { OfferMeta } from '../../../../components/offer-card';
import { Card, colors, EmptyState, ErrorState, FloatingButton, fonts, JobIcon, Loading, Monogram, shadow, styles } from '../../../../components/ui';
import { fetchCompany, jobIcon, logoUri } from '../../../../lib/emploi';
import { useLoad } from '../../../../lib/use-load';

const back = () => (router.canGoBack() ? router.back() : router.replace('/offers'));

export default function CompanyScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const company = useLoad(signal => fetchCompany(id, signal), `company:${id}`, Number.isFinite(id));
  if (!company.data) {
    return (
      <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
        <View style={{ padding: 18, gap: 16 }}>
          <FloatingButton icon="chevronLeft" label="Retour" onPress={back} />
          {company.loading ? <Loading label="Chargement de l’entreprise…" />
            : company.status === 404 || !Number.isFinite(id) ? <Card><EmptyState icon="building" title="Entreprise introuvable" text="Cette entreprise n’a pas d’annonce publiée." /></Card>
            : <ErrorState message={company.error} onRetry={company.reload} />}
        </View>
      </SafeAreaView>
    );
  }
  const data = company.data;
  // Indicateurs affichés seulement s'ils ont été renseignés par le recrutement : rien n'est estimé.
  const figures = [data.headcount ? { icon: 'users' as const, text: data.headcount } : null, (data.locations || data.city) ? { icon: 'pin' as const, text: data.locations || data.city || '' } : null]
    .filter(Boolean) as { icon: 'users' | 'pin'; text: string }[];
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 28 }}>
      {/* Photographie d'illustration (assets/photos/SOURCES.md) : ce n'est pas un site de l'entreprise. */}
      <View style={page.banner}>
        <Image accessibilityIgnoresInvertColors source={require('../../../../../assets/photos/societe.jpg')} resizeMode="cover" style={page.photo} />
        <SafeAreaView edges={['top', 'left', 'right']} style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <FloatingButton icon="chevronLeft" label="Retour" onPress={back} />
        </SafeAreaView>
      </View>
      <View style={page.body}>
        <View style={page.identity}>
          <View style={page.logo}><Monogram name={data.name} uri={logoUri(data)} size={64} /></View>
          <View style={{ flex: 1, paddingTop: 26 }}>
            <Text accessibilityRole="header" style={page.name}>{data.name}</Text>
            {!!data.sector && <Text style={page.sector}>{data.sector}</Text>}
          </View>
        </View>
        {!!data.description.trim() && (
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={styles.heading}>À propos</Text>
            <Text style={styles.text}>{data.description.trim()}</Text>
          </View>
        )}
        {data.activities.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={styles.heading}>Activités</Text>
            {data.activities.map(activity => <View key={activity} style={page.bullet}><View style={page.dot} /><Text style={[styles.text, { flex: 1 }]}>{activity}</Text></View>)}
          </View>
        )}
        {figures.length > 0 && (
          <View style={page.figures}>
            {figures.map(figure => <View key={figure.icon} style={page.figure}><Icon name={figure.icon} size={22} color={colors.gold} /><Text style={page.figureText}>{figure.text}</Text></View>)}
          </View>
        )}
        <Text accessibilityRole="header" style={styles.heading}>{`Offres disponibles (${data.offers.length})`}</Text>
        {data.offers.length ? (
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {data.offers.map((offer, index) => (
              <Pressable key={offer.id} accessibilityRole="button" accessibilityLabel={[offer.title, offer.wilaya, offer.contract_type].filter(Boolean).join(', ')}
                onPress={() => router.push({ pathname: '/offers/[id]', params: { id: String(offer.id) } })}
                style={({ pressed }) => [page.offer, index > 0 && { borderTopWidth: 1, borderTopColor: colors.border }, pressed && { opacity: 0.7 }]}>
                <JobIcon name={jobIcon(offer)} size={36} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={page.offerTitle}>{offer.title}</Text>
                  <OfferMeta wilaya={offer.wilaya} contract={offer.contract_type} />
                </View>
                <Icon name="chevronRight" size={18} color={colors.soft} />
              </Pressable>
            ))}
          </Card>
        ) : <Card><EmptyState icon="briefcase" title="Aucune offre ouverte" text="Cette entreprise n’a pas d’annonce ouverte pour le moment." /></Card>}
      </View>
    </ScrollView>
  );
}

const page = StyleSheet.create({
  banner: { height: 190, backgroundColor: colors.surface, overflow: 'hidden' }, photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }, body: { paddingHorizontal: 18, gap: 16 },
  identity: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: -30 }, logo: { padding: 4, borderRadius: 14, backgroundColor: colors.white, ...shadow },
  name: { fontSize: 19, fontFamily: fonts.bold, color: colors.ink }, sector: { fontSize: 14.5, fontFamily: fonts.sans, color: colors.muted },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.navy, marginTop: 9 },
  figures: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' }, figure: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 120 },
  figureText: { fontSize: 14.5, lineHeight: 20, fontFamily: fonts.sans, color: colors.ink, flexShrink: 1 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8 }, offerTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink },
});
