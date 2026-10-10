import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Icon } from './icon';
import { colors, fonts } from './ui';
import { errorMessage } from '../lib/api';
import { CVUpload } from '../lib/documents';
import { CVMeta, fileSize } from '../lib/emploi';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const LABELS: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' };

/** Sélection d'un CV sur le téléphone : PDF, JPG ou PNG, 5 Mo au plus (mêmes contrôles que le serveur). */
async function pickCv(): Promise<(CVUpload & { size: number }) | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0], mime = TYPES[asset.name.split('.').pop()?.toLowerCase() || ''];
  if (!mime || (asset.mimeType && asset.mimeType !== 'application/octet-stream' && asset.mimeType !== mime)) throw new Error('Choisissez un CV au format PDF, JPG ou PNG.');
  if (asset.size !== undefined && (asset.size === 0 || asset.size > MAX_BYTES)) throw new Error('Le CV doit être non vide et faire au maximum 5 Mo.');
  let base64: string, size: number;
  if (Platform.OS === 'web' && asset.file) {
    const bytes = new Uint8Array(await asset.file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    base64 = btoa(binary); size = bytes.length;
  } else {
    const file = new File(asset.uri);
    if (!file.size || file.size > MAX_BYTES) throw new Error('Le CV doit être non vide et faire au maximum 5 Mo.');
    base64 = await file.base64(); size = file.size;
  }
  if (!size || size > MAX_BYTES) throw new Error('Le CV doit être non vide et faire au maximum 5 Mo.');
  return { name: asset.name.slice(0, 180), mime_type: mime, data_base64: base64, size };
}

/**
 * Carte « Votre CV » de la planche : zone de dépôt, puis fichier avec son nom, sa taille et sa suppression.
 * `value` : undefined = CV du profil inchangé, objet = nouveau fichier, null = aucun CV pour cet envoi.
 */
export function CvCard({ value, existing, onChange, onError, disabled = false }: { value?: (CVUpload & { size?: number }) | null; existing?: CVMeta | null;
  onChange: (value: (CVUpload & { size: number }) | null) => void; onError: (message: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const current = value === null ? null : value ? { name: value.name, mime_type: value.mime_type, size: value.size || 0 } : existing || null;
  async function pick() {
    if (busy || disabled) return;
    setBusy(true);
    try { const picked = await pickCv(); if (picked) onChange(picked); } catch (e) { onError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={current ? 'Remplacer le CV' : 'Ajouter un CV, PDF, JPG ou PNG, 5 Mo maximum'} accessibilityState={{ disabled: busy || disabled, busy }}
        disabled={busy || disabled} onPress={pick} style={({ pressed }) => [card.drop, pressed && { opacity: 0.7 }]}>
        {busy ? <ActivityIndicator color={colors.navy} /> : <Icon name="cloudUp" size={30} color={colors.blue} />}
        <Text style={card.dropTitle}>{current ? 'Remplacer le CV' : 'Ajouter un CV'}</Text>
        <Text style={card.dropHint}>PDF · JPG · PNG (max. 5 Mo)</Text>
      </Pressable>
      {current && (
        <View style={card.file}>
          <View style={card.type}><Text style={card.typeText}>{LABELS[current.mime_type] || 'CV'}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={card.name} numberOfLines={1}>{current.name}</Text>
            <Text style={card.size}>{current.size ? fileSize(current.size) : ''}{value === undefined ? `${current.size ? ' · ' : ''}CV de votre profil` : ''}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${current.name}`} disabled={disabled} onPress={() => onChange(null)} hitSlop={10} style={card.remove}>
            <Icon name="close" size={18} color={colors.navy} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const card = StyleSheet.create({
  drop: { alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 104, borderRadius: 12, borderWidth: 1.4, borderStyle: 'dashed', borderColor: '#B9C4D6', backgroundColor: '#FAFBFD', padding: 12 },
  dropTitle: { fontSize: 17, fontFamily: fonts.semi, color: colors.ink }, dropHint: { fontSize: 14, fontFamily: fonts.sans, color: colors.muted },
  file: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  type: { minWidth: 34, height: 34, borderRadius: 7, backgroundColor: colors.redSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, typeText: { fontSize: 12, fontFamily: fonts.bold, color: colors.red },
  name: { fontSize: 15.5, fontFamily: fonts.semi, color: colors.ink }, size: { fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted }, remove: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
});
