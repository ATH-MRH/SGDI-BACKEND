import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, colors, fonts, styles } from '../components/ui';
import { PENDING, PRIVACY_NOTICE, PRIVACY_VERSION } from '../lib/privacy';

/** Notice complète, lisible sans être identifié. */
export default function Privacy() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: 8, paddingBottom: 32 + insets.bottom }]}>
      <Stack.Screen options={{ title: 'Protection des données personnelles' }} />
      <Text style={styles.subtitle}>{`Notice d’information · version ${PRIVACY_VERSION}`}</Text>
      {PRIVACY_NOTICE.map(section => (
        <Card key={section.title}>
          <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text>
          {section.paragraphs?.map(text => <Text key={text} style={styles.text}>{text}</Text>)}
          {section.points?.map(text => <View key={text} style={page.point}><View style={page.dot} /><Text style={[styles.text, { flex: 1 }]}>{text}</Text></View>)}
          {section.pending && (
            <View style={page.pending}>
              <Text style={page.pendingTitle}>{PENDING}</Text>
              {section.pending.map(text => <Text key={text} style={page.pendingText}>{`• ${text}`}</Text>)}
            </View>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}

const page = StyleSheet.create({
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.navy, marginTop: 10 },
  pending: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: colors.goldSoft }, pendingTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.goldDeep },
  pendingText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.sans, color: colors.ink },
});
