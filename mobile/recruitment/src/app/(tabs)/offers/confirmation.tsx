import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Icon } from '../../../components/icon';
import { Button, Card, colors, fonts, Page, styles } from '../../../components/ui';

export default function Confirmation() {
  const params = useLocalSearchParams<{ reference?: string; id?: string; title?: string; company?: string; already?: string; direct?: string }>();
  const leave = (target: '/' | '/applications') => { if (router.canDismiss()) router.dismissAll(); router.navigate(target); };
  return (
    <Page title={params.already ? 'Candidature déjà enregistrée' : 'Candidature envoyée'}
      subtitle={params.already ? 'Vous aviez déjà postulé : votre première candidature reste valable, aucun doublon n’a été créé.' : 'Votre dossier a été transmis au service recrutement.'}>
      <Card>
        <View style={page.icon}><Icon name="check" size={34} color={colors.green} /></View>
        {!!params.title && <Text style={page.title}>{params.title}</Text>}
        <Text style={styles.subtitle}>{params.company || 'Candidature spontanée'}</Text>
        <View style={styles.divider} />
        <Text style={styles.label}>Référence de votre dossier</Text>
        <Text selectable accessibilityLabel={`Référence ${params.reference}`} style={page.reference}>{params.reference}</Text>
        <Text style={styles.subtitle}>{params.direct ? 'Conservez cette référence : elle permet de suivre votre candidature.' : 'Vous la retrouverez à tout moment dans l’onglet « Candidatures », avec l’état de chaque candidature.'}</Text>
      </Card>
      {params.direct
        ? <Button title="Suivre ma candidature" onPress={() => router.replace({ pathname: '/tracking', params: { reference: params.reference || '' } })} />
        : <Button title="Voir mes candidatures" onPress={() => leave('/applications')} />}
      <Button title="Retour à l’accueil" secondary onPress={() => leave('/')} />
    </Page>
  );
}

const page = StyleSheet.create({
  icon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21.5, fontFamily: fonts.bold, color: colors.ink }, reference: { fontSize: 23.5, fontFamily: fonts.bold, color: colors.navy, letterSpacing: 0.8 },
});
