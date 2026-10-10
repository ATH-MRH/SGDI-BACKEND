import { createElement } from 'react';
import { Text, View } from 'react-native';
import { Icon } from './icon';
import { colors, styles } from './ui';
import { field } from './fields';
import { displayDate, isoDate } from '../lib/emploi';
import type { DateFieldProps } from './date-field';

/** Aperçu web uniquement : le calendrier du navigateur, avec le même affichage JJ/MM/AAAA que sur téléphone. */
export function DateField({ label, value, onChange, minimumDate, maximumDate, disabled }: DateFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.input, field.button, disabled && styles.inputLocked]}>
        <Text style={[field.value, !value && { color: colors.soft }]}>{displayDate(value) || 'JJ/MM/AAAA'}</Text>
        <Icon name="calendar" size={20} color={colors.muted} />
        {createElement('input', { type: 'date', 'aria-label': label, value, disabled, min: minimumDate ? isoDate(minimumDate) : undefined, max: maximumDate ? isoDate(maximumDate) : undefined,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
          onClick: (event: { currentTarget: { showPicker?: () => void } }) => { try { event.currentTarget.showPicker?.(); } catch { /* calendrier déjà ouvert */ } },
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' } })}
      </View>
    </View>
  );
}
