# Premier build sur appareil

État du poste de développement, vérifié le 9 octobre 2026 : outils en ligne de commande Xcode seulement (pas de Xcode complet), pas de SDK Android, pas de CLI EAS. Aucun binaire ne peut donc être compilé ni lancé localement. Rien n'a été installé : les deux voies ci-dessous sont à choisir par le propriétaire.

## Voie recommandée : EAS Build (aucune installation lourde)

1. Créer un compte Expo, puis :
   ```bash
   npm install --global eas-cli
   cd mobile/atlas
   eas login
   eas init            # crée le projet ; reporter l'identifiant dans EAS_PROJECT_ID et EXPO_OWNER
   ```
2. Dans le tableau de bord Expo, créer les environnements `development` et `preview` et y définir `EXPO_PUBLIC_API_URL`. La production est déjà fixée dans `eas.json` sur `https://atlas.irongs.com`.
3. Choisir les fonctions du build avec `ATLAS_FEATURES` (par exemple `biometrics,offline,updateCheck`). Ne pas activer `push` ni `employeePortal` tant que le backend de la branche mobile n'est pas déployé.
4. Android, sans compte Google Play : `eas build --profile development --platform android` produit un APK installable directement sur un téléphone.
5. iOS : un compte Apple Developer est obligatoire, même pour un appareil de test. Puis `eas device:create` pour enregistrer l'iPhone et `eas build --profile development --platform ios`.
6. Lancer `npm start` et ouvrir le client de développement installé.

## Voie locale

| Plateforme | À installer | Commande |
|---|---|---|
| iOS (simulateur) | Xcode complet depuis l'App Store (environ 15 Go), puis `sudo xcode-select -s /Applications/Xcode.app` | `npx expo run:ios` |
| Android (émulateur) | Android Studio avec un SDK et une image système ; un JDK 17 | `npx expo run:android` |

## À vérifier sur l'appareil

Ces points ne sont couverts par aucun test automatisé.

| Point | iPhone | Android |
|---|---|---|
| Lancement, connexion, clavier qui ne masque pas le bouton | ☐ | ☐ |
| Zones sûres (encoche, barre de gestes) | ☐ | ☐ |
| Bouton retour système | — | ☐ |
| Face ID / empreinte, puis verrouillage au retour au premier plan | ☐ | ☐ |
| Aperçu masqué dans le sélecteur d'applications | ☐ | ☐ (avec `secureScreen`) |
| Session conservée après fermeture complète de l'application | ☐ | ☐ |
| Déclaration d'incident en mode avion, puis envoi au retour du réseau | ☐ | ☐ |
| Lien `atlas-dev://alerts/1` ouvert hors session, puis en session | ☐ | ☐ |
| Arabe : mise en page de droite à gauche | ☐ | ☐ |
| Petit écran et grande taille de police | ☐ | ☐ |
| Notifications : demande d'autorisation, réception, ouverture du bon écran | ☐ | ☐ |
