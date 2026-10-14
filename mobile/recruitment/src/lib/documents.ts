import { useCallback } from 'react';
import { useCandidateSession } from './candidate-session';
import { CVMeta } from './emploi';

export type CVUpload = { name: string; mime_type: string; data_base64: string };

/** Documents de l'espace candidat : enregistrés une fois, réutilisés à chaque candidature. */
export function useDocuments() {
  const { call } = useCandidateSession();
  const saveCv = useCallback(async (value: CVUpload | null): Promise<CVMeta | null> => {
    if (value === null) { await call('/public/emploi/me/cv', { method: 'DELETE' }); return null; }
    return (await call<{ cv: CVMeta }>('/public/emploi/me/cv', { method: 'PUT', body: value })).cv;
  }, [call]);
  const savePhoto = useCallback(async (value: string) => {
    if (value) await call('/public/emploi/me/photo', { method: 'PUT', body: { photo_data: value } });
    else await call('/public/emploi/me/photo', { method: 'DELETE' });
  }, [call]);
  const loadPhoto = useCallback(async (signal?: AbortSignal) => (await call<{ photo_data: string }>('/public/emploi/me/photo', { signal })).photo_data, [call]);
  return { saveCv, savePhoto, loadPhoto };
}
