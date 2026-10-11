#!/usr/bin/env node
/**
 * Retire le client de développement des dépendances installées quand la variante à
 * construire n'est pas `development`.
 *
 * `expo-dev-client` est une dépendance du projet : le profil de build `development` en a
 * besoin. Mais Expo lie tout module natif présent dans node_modules et applique son plugin
 * de configuration : laissé en place, il ajoute à un build de production un schéma de lien
 * (`exp+atlas-mobile://`), des bibliothèques natives et un réglage Gradle qui n'y ont rien
 * à faire. Supprimé avant la génération du projet natif, il n'en reste aucune trace.
 *
 * Lancé par `postinstall`, donc après `npm ci` sur la machine de build EAS, où APP_VARIANT
 * vient du profil (eas.json). Sans APP_VARIANT, ou en `development`, rien n'est retiré.
 * Pour retrouver le client après un essai local : `npm ci`.
 */
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEV_CLIENT_PACKAGES = ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'];

const script = fileURLToPath(import.meta.url);

if (process.argv[1] === script) {
  const variant = process.env.APP_VARIANT ?? '';
  if (variant === 'staging' || variant === 'production') {
    const modules = join(dirname(script), '..', 'node_modules');
    const removed = DEV_CLIENT_PACKAGES.filter((name) => existsSync(join(modules, name)));
    for (const name of removed) rmSync(join(modules, name), { recursive: true, force: true });
    console.log(`Variante ${variant} : client de développement retiré (${removed.join(', ') || 'déjà absent'}).`);
  }
}
