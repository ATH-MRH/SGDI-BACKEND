/** Réglages de sécurité locale. Le délai de verrouillage vient du build (env.lockTimeoutMs). */

/** Échecs biométriques consécutifs avant fermeture de la session. */
export const MAX_UNLOCK_FAILURES = 5;

/** Le profil n'est pas rechargé plus souvent que cela au retour au premier plan. */
export const PROFILE_REFRESH_MIN_INTERVAL_MS = 60_000;
