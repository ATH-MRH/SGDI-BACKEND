import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from './ui';

/**
 * Code à six chiffres présenté en six cases, comme sur la planche. Un seul champ de saisie réel
 * est posé par-dessus : collage et suggestion automatique du code SMS (iOS et Android) fonctionnent.
 */
export function OtpInput({ value, onChange, onComplete, editable = true }: { value: string; onChange: (value: string) => void; onComplete?: () => void; editable?: boolean }) {
  const input = useRef<TextInput>(null);
  return (
    <Pressable accessibilityLabel="Code reçu par SMS, six chiffres" onPress={() => input.current?.focus()} style={otp.row}>
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={[otp.box, index === value.length && editable && otp.active, !!value[index] && otp.filled]}>
          <Text style={otp.digit}>{value[index] || ''}</Text>
        </View>
      ))}
      <TextInput ref={input} accessibilityLabel="Code de validation" value={value} editable={editable} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp"
        maxLength={6} caretHidden returnKeyType="done" onSubmitEditing={onComplete}
        onChangeText={text => { const digits = text.replace(/\D/g, '').slice(0, 6); onChange(digits); }}
        style={otp.input} />
    </Pressable>
  );
}

const otp = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  box: { flex: 1, maxWidth: 52, aspectRatio: 0.9, borderRadius: 9, borderWidth: 1.2, borderColor: colors.border, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  active: { borderColor: colors.navy, borderWidth: 1.8 }, filled: { borderColor: colors.navy },
  digit: { fontSize: 22.5, fontFamily: fonts.semi, color: colors.ink },
  // Champ réel, transparent, sur toute la largeur : il reçoit le clavier, le collage et la saisie automatique.
  input: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.01, color: 'transparent', fontSize: 1 },
});
