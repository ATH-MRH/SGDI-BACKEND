import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { API } from './api';
import { ConvocationDetail, convocationFileName } from './emploi';

// Convocations enregistrées sur le téléphone, pour les présenter sans connexion le jour de l'entretien :
// le détail (avec la matrice du QR) et le PDF de la dernière version téléchargée. Elles restent dans l'espace
// privé de l'application et sont effacées à la déconnexion. Un PDF partagé ou enregistré ailleurs par le
// candidat ne peut pas être rappelé : en cas de report ou d'annulation, son QR l'indique au recruteur.

export type SavedConvocation = { detail: ConvocationDetail; saved_at: string; pdf: string | null };

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const folder = () => new Directory(Paths.document, 'convocations');

function ensureFolder(): Directory {
  const directory = folder();
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** Heure locale d'Alger (UTC+1, sans heure d'été), comme les horaires des entretiens. */
function nowAlgiers(): string {
  return new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16);
}

export function readSaved(id: number): SavedConvocation | null {
  if (!native) return null;
  try {
    const file = new File(folder(), `${id}.json`);
    if (!file.exists) return null;
    const saved = JSON.parse(file.textSync()) as SavedConvocation;
    if (saved.pdf && !new File(saved.pdf).exists) saved.pdf = null;
    return saved;
  } catch { return null; }
}

export function listSaved(): SavedConvocation[] {
  if (!native) return [];
  try {
    const directory = folder();
    if (!directory.exists) return [];
    return directory.list().filter((item): item is File => item instanceof File && item.name.endsWith('.json'))
      .map(item => readSaved(Number(item.name.replace('.json', '')))).filter((item): item is SavedConvocation => item !== null);
  } catch { return []; }
}

/** Garde le détail à jour sur le téléphone, sans toucher au PDF déjà enregistré s'il est de la même version. */
export function rememberDetail(detail: ConvocationDetail): void {
  if (!native || detail.id === null || !detail.convocation) return;
  try {
    const previous = readSaved(detail.id);
    const samePdf = previous?.pdf && previous.detail.convocation?.version === detail.convocation.version ? previous.pdf : null;
    if (previous?.pdf && !samePdf) new File(previous.pdf).delete();              // ancienne version : remplacée
    if (!previous && detail.status === 'cancelled') return;
    const file = new File(ensureFolder(), `${detail.id}.json`);
    file.create({ overwrite: true });
    file.write(JSON.stringify({ detail, saved_at: nowAlgiers(), pdf: samePdf } satisfies SavedConvocation));
  } catch { /* stockage indisponible : la convocation reste consultable en ligne */ }
}

/** Télécharge le PDF de la version en vigueur et l'enregistre avec le détail. */
export async function savePdf(detail: ConvocationDetail, token: string): Promise<SavedConvocation> {
  if (!native || detail.id === null || !detail.convocation) throw new Error('L’enregistrement de la convocation se fait depuis l’application installée sur le téléphone.');
  const response = await fetch(`${API}/public/emploi/interviews/${detail.id}/convocation`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.detail === 'string' ? data.detail : 'Impossible de télécharger la convocation. Vérifiez votre connexion.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('Le document reçu n’est pas un PDF.');
  const directory = ensureFolder();
  const previous = readSaved(detail.id);
  if (previous?.pdf) { try { new File(previous.pdf).delete(); } catch { /* déjà retiré */ } }
  const pdf = new File(directory, convocationFileName(detail.convocation));
  pdf.create({ overwrite: true });
  pdf.write(bytes);
  const saved: SavedConvocation = { detail, saved_at: nowAlgiers(), pdf: pdf.uri };
  const file = new File(directory, `${detail.id}.json`);
  file.create({ overwrite: true });
  file.write(JSON.stringify(saved));
  return saved;
}

/** Ouvre ou partage le PDF enregistré avec les fonctions du téléphone (aperçu, Fichiers, impression). */
export async function sharePdf(saved: SavedConvocation): Promise<void> {
  if (!saved.pdf) throw new Error('Enregistrez d’abord la convocation sur ce téléphone.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('L’ouverture de fichiers est indisponible sur cet appareil.');
  await Sharing.shareAsync(saved.pdf, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Ouvrir ou partager la convocation' });
}

/** Déconnexion ou suppression de l'espace : rien ne reste sur le téléphone dans l'application. */
export function clearSaved(): void {
  if (!native) return;
  try { const directory = folder(); if (directory.exists) directory.delete(); } catch { /* rien à effacer */ }
}
