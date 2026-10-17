import { API } from './api';
import type { SavedConvocation } from './convocation-store';
import { ConvocationDetail, convocationFileName } from './emploi';
export type { SavedConvocation } from './convocation-store';
// Browser downloads belong to the user. No PDF or identity is persisted in localStorage.
const saved = new Map<number, SavedConvocation>();
export function readSaved(id: number): SavedConvocation | null { return saved.get(id) || null; }
export function listSaved(): SavedConvocation[] { return [...saved.values()]; }
export function rememberDetail(detail: ConvocationDetail): void {
  if (detail.id === null || !detail.convocation) return;
  const previous = saved.get(detail.id);
  const pdf = previous?.detail.convocation?.version === detail.convocation.version ? previous.pdf : null;
  if (previous?.pdf && !pdf) URL.revokeObjectURL(previous.pdf);
  saved.set(detail.id, { detail, saved_at: new Date().toISOString(), pdf });
}
function download(value: SavedConvocation) {
  if (!value.pdf || !value.detail.convocation) throw new Error('Téléchargez d’abord la convocation.');
  const link = document.createElement('a');link.href = value.pdf;link.download = convocationFileName(value.detail.convocation);link.click();
}
export async function savePdf(detail: ConvocationDetail, token: string): Promise<SavedConvocation> {
  if (detail.id === null || !detail.convocation) throw new Error('Convocation indisponible.');
  const response = await fetch(`${API}/public/emploi/interviews/${detail.id}/convocation`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } });
  if (!response.ok) throw new Error('Impossible de télécharger la convocation. Réessayez après vous être identifié.');
  const blob = await response.blob();
  if (!(await blob.slice(0, 5).text()).startsWith('%PDF-')) throw new Error('Le document reçu n’est pas un PDF.');
  const previous = saved.get(detail.id);if (previous?.pdf) URL.revokeObjectURL(previous.pdf);
  const value: SavedConvocation = { detail, saved_at: new Date().toISOString(), pdf: URL.createObjectURL(blob) };
  saved.set(detail.id, value);download(value);return value;
}
export async function sharePdf(value: SavedConvocation): Promise<void> { download(value); }
export function clearSaved(): void { for (const value of saved.values()) if (value.pdf) URL.revokeObjectURL(value.pdf); saved.clear(); }
