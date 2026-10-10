import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { DateField } from './date-field';
import { DigitsField, MoneyField, MultiSelectField, SelectField } from './fields';
import { Button, Card, Field, styles } from './ui';
import { request } from '../lib/api';
import { CHILDREN_OPTIONS, Experience, FormValues, HEIGHT_OPTIONS, LANGUAGE_OPTIONS, latestBirthDate, Option, parseIsoDate, SHIRT_OPTIONS, SHOE_OPTIONS, withCurrent } from '../lib/emploi';
import schema from '../lib/form-schema.json';
import locations from '../lib/locations.json';

export type { Experience, FormValues } from '../lib/emploi';
/** Ancien nom de la liste déroulante, conservé pour les écrans qui l'utilisent. */
export const Select = SelectField;

type Kind = 'text' | 'select' | 'date' | 'digits' | 'money' | 'languages' | 'position' | 'wilaya' | 'commune' | 'heading' | 'legacy';
type Item = { key: string; label: string; kind: Kind; staffOnly?: boolean; max?: number; multiline?: boolean };
const schemaOptions = (key: string): Option[] => (schema.flatMap(group => group.fields).find(item => item.key === key)?.options || []).map(option => ({ value: option.value, label: option.value ? option.label : 'Non renseigné' }));

// Disposition du formulaire. L'ordre Wilaya → Commune → Adresse est voulu : la commune dépend de la wilaya.
const SECTIONS: { title: string; items: Item[] }[] = [
  { title: 'Identité', items: [
    { key: 'last_name', label: 'Nom', kind: 'text' }, { key: 'first_name', label: 'Prénom', kind: 'text' },
    { key: 'birth_date', label: 'Date de naissance', kind: 'date' }, { key: 'birth_place', label: 'Lieu de naissance', kind: 'text', max: 120 },
    { key: 'sex', label: 'Sexe', kind: 'select' }, { key: 'family_status', label: 'Situation familiale', kind: 'select' },
    { key: 'children_count', label: 'Nombre d’enfants', kind: 'select' }, { key: 'blood_group', label: 'Groupe sanguin', kind: 'select' },
    { key: 'father_name', label: 'Nom du père', kind: 'text', max: 120 }, { key: 'mother_name', label: 'Nom de la mère', kind: 'text', max: 120 },
    { key: 'nin', label: 'NIN', kind: 'digits', max: 18 }, { key: 'cnas_number', label: 'N° CNAS', kind: 'text', max: 20 },
  ] },
  { title: 'Coordonnées', items: [
    { key: 'phone', label: 'Téléphone', kind: 'text' }, { key: 'email', label: 'E-mail', kind: 'text' },
    { key: 'wilaya', label: 'Wilaya', kind: 'wilaya' }, { key: 'commune', label: 'Commune', kind: 'commune' }, { key: 'address', label: 'Adresse', kind: 'text', max: 500, multiline: true },
    { key: 'emergency', label: 'Contact d’urgence', kind: 'heading' }, { key: 'emergency_name', label: 'Nom enregistré', kind: 'legacy' },
    { key: 'emergency_relation', label: 'Lien avec vous', kind: 'text', max: 120 }, { key: 'emergency_phone', label: 'Téléphone d’urgence', kind: 'text', max: 40 },
  ] },
  { title: 'Poste et profil', items: [
    { key: 'desired_position', label: 'Poste souhaité', kind: 'position' }, { key: 'expected_salary', label: 'Salaire demandé (par mois)', kind: 'money' },
    { key: 'availability', label: 'Disponibilité', kind: 'select' }, { key: 'source', label: 'Source de candidature', kind: 'text', staffOnly: true },
    { key: 'military_service', label: 'Service militaire', kind: 'select' },
    { key: 'height', label: 'Taille (en cm)', kind: 'select' }, { key: 'shoe_size', label: 'Pointure', kind: 'select' }, { key: 'shirt_size', label: 'Taille de chemise', kind: 'select' },
    { key: 'languages', label: 'Langues parlées', kind: 'languages' }, { key: 'written_languages', label: 'Langues écrites', kind: 'languages' },
    { key: 'notes', label: 'Notes du recruteur', kind: 'text', staffOnly: true, multiline: true },
  ] },
];
const FIXED: Record<string, Option[]> = { children_count: CHILDREN_OPTIONS, height: HEIGHT_OPTIONS, shoe_size: SHOE_OPTIONS, shirt_size: SHIRT_OPTIONS };
const communesOf = (wilaya: string | undefined): string[] => {
  const code = locations.wilayas.find(([, name]) => name === wilaya)?.[0];
  return (locations.communes as Record<string, string[]>)[code || ''] || [];
};
const EXPERIENCE: [keyof Experience, string, 'text' | 'date'][] = [['position', 'Poste', 'text'], ['society', 'Employeur', 'text'], ['start_date', 'Du', 'date'], ['end_date', 'Au', 'date'], ['departure_reason', 'Motif du départ', 'text']];

export function CandidateForm({ values, onChange, experience, onExperience, staff = false, token, photo, lockedIdentity = false, hidden = [] }:
  { values: FormValues; onChange: (v: FormValues) => void; experience: Experience[]; onExperience: (v: Experience[]) => void; staff?: boolean; token?: string; photo?: React.ReactNode; lockedIdentity?: boolean; hidden?: string[] }) {
  const [positions, setPositions] = useState(locations.positions);
  const [today] = useState(() => new Date());
  // Le référentiel des postes est réservé aux comptes RH : un candidat utilise la liste embarquée.
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    request<{ name: string }[]>('/irongs/positions', { token, signal: controller.signal })
      .then(rows => { if (!controller.signal.aborted && Array.isArray(rows) && rows.length) setPositions([...new Set(rows.map(r => r.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'))); })
      .catch(() => {});
    return () => controller.abort();
  }, [token]);

  function set(key: string, value: string) {
    const next = { ...values, [key]: value };
    // Une commune qui n'appartient pas à la nouvelle wilaya est retirée ; une commune toujours valable est gardée.
    if (key === 'wilaya' && next.commune && !communesOf(value).includes(next.commune)) next.commune = '';
    onChange(next);
  }

  function render(item: Item) {
    const value = values[item.key] || '', change = (next: string) => set(item.key, next);
    switch (item.kind) {
      case 'heading': return <Text key={item.key} accessibilityRole="header" style={[styles.heading, { marginTop: 6 }]}>{item.label}</Text>;
      // Ancienne donnée que le formulaire ne demande plus : montrée, jamais effacée.
      case 'legacy': return staff ? <Field key={item.key} label="Nom du contact d’urgence" value={value} onChangeText={change} maxLength={120} />
        : value ? <Text key={item.key} style={styles.subtitle}>{`${item.label} : ${value}`}</Text> : null;
      case 'date': return <DateField key={item.key} label={item.label} value={value} onChange={change} maximumDate={item.key === 'birth_date' ? latestBirthDate(today) : today} />;
      case 'digits': return <DigitsField key={item.key} label={item.label} value={value} onChange={change} max={item.max} hint="10 ou 18 chiffres, tels qu’ils figurent sur votre carte." />;
      case 'money': return <MoneyField key={item.key} label={item.label} value={value} onChange={change} />;
      case 'languages': return <MultiSelectField key={item.key} label={item.label} value={value} options={LANGUAGE_OPTIONS} onChange={change} placeholder="Choisir une ou plusieurs langues" />;
      case 'position': return <SelectField key={item.key} label={item.label} value={value} onChange={change} searchable allowCustom placeholder="Rechercher ou saisir un poste"
        options={withCurrent(positions.map(name => ({ value: name, label: name })), value)} />;
      case 'wilaya': return <SelectField key={item.key} label={item.label} value={value} onChange={change} searchable placeholder="Choisir la wilaya"
        options={withCurrent(locations.wilayas.map(([code, name]) => ({ value: name, label: `${code} - ${name}` })), value)} />;
      case 'commune': return <SelectField key={item.key} label={item.label} value={value} onChange={change} searchable disabled={!values.wilaya}
        placeholder={values.wilaya ? 'Choisir la commune' : 'Choisissez d’abord la wilaya'} options={withCurrent(communesOf(values.wilaya).map(name => ({ value: name, label: name })), value)} />;
      case 'select': return <SelectField key={item.key} label={item.label} value={value} onChange={change} options={withCurrent(FIXED[item.key] || schemaOptions(item.key), value)} placeholder="Choisir" />;
      default: return <Field key={item.key} label={item.label} value={value} onChangeText={change} editable={!(lockedIdentity && ['first_name', 'last_name', 'phone'].includes(item.key))}
        multiline={item.multiline} maxLength={item.max} keyboardType={item.key.includes('phone') ? 'phone-pad' : item.key === 'email' ? 'email-address' : 'default'}
        autoCapitalize={item.key === 'email' ? 'none' : 'sentences'} autoCorrect={item.key !== 'email'} />;
    }
  }

  const setRow = (index: number, key: keyof Experience, value: string) => onExperience(experience.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  return (
    <>
      {SECTIONS.map((section, index) => (
        <Card key={section.title}>
          <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text>
          {index === 0 && photo}
          {section.items.filter(item => (staff || !item.staffOnly) && !hidden.includes(item.key)).map(render)}
        </Card>
      ))}
      <Card>
        <Text accessibilityRole="header" style={styles.heading}>Expérience professionnelle</Text>
        {experience.map((row, i) => (
          <View key={i} style={{ gap: 12 }}>
            {EXPERIENCE.map(([key, label, kind]) => kind === 'date'
              ? <DateField key={key} label={label} value={row[key]} onChange={value => setRow(i, key, value)} maximumDate={today}
                  minimumDate={key === 'end_date' ? parseIsoDate(row.start_date) || undefined : undefined} />
              : <Field key={key} label={label} value={row[key]} maxLength={150} onChangeText={value => setRow(i, key, value)} />)}
            <Button title="Retirer cette expérience" icon="trash" secondary onPress={() => onExperience(experience.filter((_, j) => j !== i))} />
            <View style={styles.divider} />
          </View>
        ))}
        {experience.length === 0 && <Text style={styles.subtitle}>Aucune expérience ajoutée.</Text>}
        <Button title="Ajouter une expérience" icon="plus" secondary disabled={experience.length >= 20}
          onPress={() => onExperience([...experience, { society: '', position: '', start_date: '', end_date: '', departure_reason: '' }])} />
      </Card>
      {staff && schema.slice(3).map(section => (
        <Card key={section.title}>
          <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text>
          {section.fields.map(item => item.options.length
            ? <SelectField key={item.key} label={item.label} value={values[item.key] || ''} onChange={value => set(item.key, value)} options={schemaOptions(item.key)} />
            : item.date ? <DateField key={item.key} label={item.label} value={values[item.key] || ''} onChange={value => set(item.key, value)} />
            : <Field key={item.key} label={item.label} value={values[item.key] || ''} onChangeText={value => set(item.key, value)} multiline={item.multiline} />)}
        </Card>
      ))}
    </>
  );
}
