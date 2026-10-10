# Checklist de release ATLAS MOBILE

À dérouler pour chaque version envoyée à des testeurs ou à un store. La publication sur l'App Store ou Google Play en production ne se fait que sur instruction explicite.

## Avant le build

- [ ] La branche est à jour, `mobile-ci` est vert sur le commit à builder.
- [ ] `npm run verify` et `npm run test:integration` passent en local.
- [ ] La version dans `package.json` est correcte (`MAJEUR.MINEUR.CORRECTIF`) et supérieure à la version publiée.
- [ ] Les fonctions activées (`ATLAS_FEATURES`) sont celles prévues pour cette version.
- [ ] `EXPO_PUBLIC_API_URL` de l'environnement EAS visé pointe vers le bon backend, sur un hôte en `atlas.…`.
- [ ] Le backend visé est déployé dans une version compatible.
- [ ] Aucune permission nouvelle sans texte explicatif et sans mise à jour de `PRIVACY-DATA-SAFETY.md`.
- [ ] Aucun fichier de signature ni secret dans le diff.

## Build de test (`staging`)

- [ ] Workflow « Mobile Build (EAS) », profil `staging`, plateforme `all`.
- [ ] Installation sur au moins un iPhone et un Android.
- [ ] Le badge « Test » est visible et la version/build affichée correspond au build.
- [ ] Connexion, déconnexion, relance de l'application (session restaurée).
- [ ] Un compte limité à une société ne voit que ses modules et ses données.
- [ ] Un compte sans module voit l'état vide, sans erreur.
- [ ] Mode avion : message d'erreur clair et bouton Réessayer ; retour du réseau géré.
- [ ] Petit écran (iPhone SE, Android étroit) et grand écran : aucun débordement, aucun bouton hors écran, clavier ne masquant pas le formulaire.
- [ ] Taille de police système agrandie : textes lisibles, rien de coupé.
- [ ] Lecteur d'écran (VoiceOver, TalkBack) : chaque bouton est annoncé.
- [ ] Affichage en arabe : mise en page de droite à gauche correcte.

## Version candidate (`production`)

- [ ] Build `production` à partir du même commit que le build de test validé.
- [ ] Envoi en TestFlight interne et en test interne Google Play.
- [ ] Parcours de validation refait sur l'API de production, avec un compte réel.
- [ ] Aucun badge d'environnement affiché.
- [ ] Notes de version rédigées.

## Conformité store

- [ ] Fiche du store, captures d'écran et description à jour.
- [ ] Questionnaire de confidentialité Apple et formulaire Sécurité des données Google relus.
- [ ] URL de la politique de confidentialité valide.
- [ ] Compte de démonstration fonctionnel fourni aux équipes de revue.
- [ ] Déclaration de chiffrement Apple renseignée.
- [ ] Android : SDK cible conforme à la règle Google Play en vigueur.

## Publication — uniquement sur instruction explicite

- [ ] Accord écrit du responsable produit pour la mise en production.
- [ ] iOS : soumission à la revue, publication manuelle après approbation.
- [ ] Android : promotion vers la production en déploiement progressif.
- [ ] Étiquette Git `mobile-vX.Y.Z` posée sur le commit publié.

## Après publication

- [ ] Vérification de l'installation depuis le store sur un appareil neuf.
- [ ] Suivi des avis, des plantages et du taux de déploiement pendant 48 heures.
- [ ] Android : passage du déploiement progressif à 100 % après validation.
- [ ] En cas de défaut bloquant : arrêt du déploiement progressif (Android), retrait de la vente ou correctif accéléré (iOS).
