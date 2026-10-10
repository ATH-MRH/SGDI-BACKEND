import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Offer } from './emploi';

// Favoris conservés sur l'appareil uniquement : aucun compte n'est nécessaire et rien n'est envoyé au serveur.
export type Favorite = Pick<Offer, 'id' | 'title' | 'wilaya' | 'contract_type'> & { company: string; savedAt: string };
type State = { ready: boolean; items: Favorite[]; isFavorite: (id: number) => boolean; toggle: (offer: Offer) => void; remove: (id: number) => void; clear: () => void };
const Context = createContext<State | null>(null);
const NAME = 'iron-emploi-favoris.json', MAX = 200;

function read(): Favorite[] {
  try {
    const text = Platform.OS === 'web' ? globalThis.localStorage?.getItem(NAME) : (file => file.exists ? file.textSync() : null)(new File(Paths.document, NAME));
    const rows = JSON.parse(text || '[]');
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.id === 'number' && typeof row.title === 'string') : [];
  } catch { return []; }
}
function write(items: Favorite[]) {
  try {
    const text = JSON.stringify(items);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(NAME, text);
    else { const file = new File(Paths.document, NAME); if (!file.exists) file.create(); file.write(text); }
  } catch { /* stockage indisponible : les favoris restent valables jusqu'à la fermeture de l'application */ }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  // Lecture synchrone au démarrage : la liste est prête dès le premier affichage.
  const [items, setItems] = useState<Favorite[]>(read);
  const ready = true;
  const update = useCallback((change: (items: Favorite[]) => Favorite[]) => setItems(previous => { const next = change(previous); write(next); return next; }), []);
  const toggle = useCallback((offer: Offer) => update(previous => previous.some(item => item.id === offer.id)
    ? previous.filter(item => item.id !== offer.id)
    : [{ id: offer.id, title: offer.title, wilaya: offer.wilaya, contract_type: offer.contract_type, company: offer.company.name, savedAt: new Date().toISOString() }, ...previous].slice(0, MAX)), [update]);
  const remove = useCallback((id: number) => update(previous => previous.filter(item => item.id !== id)), [update]);
  const clear = useCallback(() => update(() => []), [update]);
  const value = useMemo(() => ({ ready, items, isFavorite: (id: number) => items.some(item => item.id === id), toggle, remove, clear }), [ready, items, toggle, remove, clear]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useFavorites() { const value = useContext(Context); if (!value) throw new Error('FavoritesProvider absent'); return value; }
