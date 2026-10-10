import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, colors, EmptyState, fonts, styles } from '../../../../components/ui';
import { findTip } from '../../../../lib/tips';

export default function TipScreen() {
  const tip = findTip(useLocalSearchParams<{ id: string }>().id);
  if (!tip) return <View style={{ padding: 18 }}><Card><EmptyState icon="bulb" title="Conseil introuvable" action="Tous les conseils" onAction={() => router.replace('/espace')} /></Card></View>;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>CONSEIL · CONTENU ÉDITORIAL · {tip.minutes} MIN</Text>
      <Text accessibilityRole="header" style={styles.title}>{tip.title}</Text>
      <Text style={styles.subtitle}>{tip.summary}</Text>
      {tip.sections.map(section => (
        <Card key={section.heading}>
          {!!section.heading && <Text accessibilityRole="header" style={styles.heading}>{section.heading}</Text>}
          {section.points.map(point => (
            <View key={point} style={page.bullet}><View style={page.dot} /><Text style={page.text}>{point}</Text></View>
          ))}
        </Card>
      ))}
      <Button title="Explorer les offres" secondary onPress={() => { if (router.canDismiss()) router.dismissAll(); router.navigate('/offers'); }} />
    </ScrollView>
  );
}

const page = StyleSheet.create({
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold, marginTop: 8 },
  text: { flex: 1, fontSize: 17, lineHeight: 24.5, fontFamily: fonts.sans, color: colors.ink },
});
