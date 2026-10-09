import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Row, styles } from '../../components/ui';
import { TIPS } from '../../lib/tips';

export default function Tips() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>CONSEILS · CONTENU ÉDITORIAL</Text>
      <Text accessibilityRole="header" style={styles.title}>Conseils pour réussir</Text>
      <Text style={styles.subtitle}>Des repères pratiques rédigés pour vous accompagner. Ce ne sont pas des annonces : les offres d’emploi se trouvent dans l’onglet « Offres ».</Text>
      <Card style={{ gap: 4 }}>
        {TIPS.map((tip, index) => (
          <View key={tip.id}>
            {index > 0 && <View style={styles.divider} />}
            <Row icon="bulb" title={tip.title} subtitle={`${tip.summary} · ${tip.minutes} min de lecture`} onPress={() => router.push({ pathname: '/tips/[id]', params: { id: tip.id } })} />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
