import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldButton } from './fields';
import { Button, colors, styles } from './ui';
import { displayDate, isoDate, parseIsoDate } from '../lib/emploi';

export type DateFieldProps = { label: string; value: string; onChange: (value: string) => void; minimumDate?: Date; maximumDate?: Date; disabled?: boolean };

/** Date choisie dans le calendrier du téléphone : affichée JJ/MM/AAAA, transmise AAAA-MM-JJ. Aucune saisie au clavier. */
export function DateField({ label, value, onChange, minimumDate, maximumDate, disabled }: DateFieldProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(() => new Date());
  // Sans date enregistrée, le calendrier s'ouvre sur la dernière date autorisée (ou aujourd'hui).
  const start = () => parseIsoDate(value) || (maximumDate && maximumDate < new Date() ? maximumDate : new Date());
  function show() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: start(), mode: 'date', display: 'calendar', minimumDate, maximumDate,
        onChange: (event, date) => { if (event.type === 'set' && date) onChange(isoDate(date)); } });
    } else { setDraft(start()); setOpen(true); }
  }
  return (
    <>
      <FieldButton label={label} text={displayDate(value)} placeholder="JJ/MM/AAAA" icon="calendar" disabled={disabled} onPress={show} />
      {Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable accessibilityLabel="Fermer le calendrier" onPress={() => setOpen(false)} style={sheet.backdrop} />
          <View accessibilityViewIsModal style={[sheet.box, { paddingBottom: insets.bottom + 14 }]}>
            <Text accessibilityRole="header" style={styles.heading}>{label}</Text>
            <DateTimePicker value={draft} mode="date" display="inline" locale="fr-FR" themeVariant="light" accentColor={colors.navy} minimumDate={minimumDate} maximumDate={maximumDate}
              onChange={(_, date) => { if (date) setDraft(date); }} />
            <Button title={`Valider le ${displayDate(isoDate(draft))}`} onPress={() => { onChange(isoDate(draft)); setOpen(false); }} />
            {!!value && <Button title="Effacer la date" secondary onPress={() => { onChange(''); setOpen(false); }} />}
          </View>
        </Modal>
      )}
    </>
  );
}

const sheet = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(12,28,54,0.45)' }, box: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, gap: 10 },
});
