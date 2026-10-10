import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from './icon';
import { colors, fonts, styles } from './ui';
import { displayDate, PrivacyState } from '../lib/emploi';
import { CONSENT_TEXT, PRIVACY_VERSION } from '../lib/privacy';

/** Ce qui est envoyé avec le profil : le consentement n'est joint que s'il vient d'être donné. */
export const consentPayload = (privacy: PrivacyState | undefined, checked: boolean) => (privacy?.current ? {} : { privacy_consent: checked, privacy_version: PRIVACY_VERSION });
export const consentMissing = (privacy: PrivacyState | undefined, checked: boolean) => !privacy?.current && !checked;

/** Consentement au traitement des données, près du bouton d'enregistrement. Non coché par défaut ;
 *  déjà donné pour la notice en vigueur, il est rappelé et non redemandé. Distinct des notifications. */
export function PrivacyConsent({ privacy, value, onChange }: { privacy: PrivacyState | undefined; value: boolean; onChange: (value: boolean) => void }) {
  const open = () => router.push('/privacy');
  const notice = (
    <Pressable accessibilityRole="button" accessibilityLabel="Protection des données personnelles : ouvrir la notice complète" onPress={open} hitSlop={6} style={({ pressed }) => [consent.notice, pressed && { opacity: 0.7 }]}>
      <Icon name="shield" size={18} color={colors.navy} /><Text style={consent.noticeText}>Protection des données personnelles</Text><Icon name="chevronRight" size={16} color={colors.muted} />
    </Pressable>
  );
  if (privacy?.current) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={styles.subtitle}>{`Consentement au traitement de vos données enregistré${privacy.accepted_at ? ` le ${displayDate(privacy.accepted_at.slice(0, 10))}` : ''}.`}</Text>
        {notice}
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.subtitle}>Vos informations servent uniquement au recrutement : étude de vos candidatures, échanges, entretiens et, si vous êtes retenu, préparation de l’embauche.</Text>
      <Pressable accessibilityRole="checkbox" aria-checked={value} accessibilityState={{ checked: value }} accessibilityLabel={CONSENT_TEXT} onPress={() => onChange(!value)} style={consent.row}>
        <View style={[consent.box, value && consent.boxOn]}>{value && <Icon name="check" size={18} color={colors.white} />}</View>
        <Text style={[styles.text, { flex: 1, fontSize: 15.5, lineHeight: 22 }]}>{CONSENT_TEXT}</Text>
      </Pressable>
      {notice}
    </View>
  );
}

const consent = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, marginTop: 2 }, boxOn: { backgroundColor: colors.navy },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  noticeText: { flex: 1, fontSize: 15.5, fontFamily: fonts.semi, color: colors.navy },
});
