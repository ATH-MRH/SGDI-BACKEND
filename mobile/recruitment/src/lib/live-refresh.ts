import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

export const LIVE_REFRESH_MS = 60000;

/**
 * Relit discrètement une liste pendant qu'elle est à l'écran : au retour sur l'écran, au retour dans
 * l'application et toutes les minutes. Le premier affichage reste à la charge de l'écran ; `refresh`
 * ne doit jamais afficher d'attente ni remplacer la liste par une erreur.
 */
export function useLiveRefresh(refresh: () => void, enabled: boolean, every = LIVE_REFRESH_MS) {
  const latest = useRef(refresh);
  // La dernière version de `refresh`, qui voit les filtres et la page affichés.
  useEffect(() => { latest.current = refresh; });
  const [focused, setFocused] = useState(false), shown = useRef(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    if (!enabled || !focused) return;
    if (shown.current) latest.current();
    shown.current = true;
    const timer = setInterval(() => { if (AppState.currentState === 'active') latest.current(); }, every);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') latest.current(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [enabled, focused, every]);
}
