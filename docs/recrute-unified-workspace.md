# Espace Recrutement : présentation et navigation unifiées

Base : origin/main e6b33b6003c59cf96bdb9ec5f9c34ec34f9e9efb.

La navigation propose une seule entrée « Candidatures ». Elle ouvre le suivi par
candidature, avec tableau et pipeline. Le second point de vue « Par candidat »
conserve la liste des fiches, les imports Excel et les dossiers historiques.
Les identifiants et états restent indépendants : une fiche par personne, plusieurs
candidatures possibles. Aucun dossier n'est créé pour réaliser cette fusion de navigation.
Les anciennes sections internes restent adressables pour préserver les appels existants.

La présentation commune s'applique au tableau de bord, aux deux vues des candidatures,
aux entretiens, annonces, vivier, archives, conservation et aux fenêtres de dossier.
La feuille `recrute-workspace.css` est limitée à la surface recrutement et chargée
avant le thème ATLAS partagé. Elle reprend la largeur de 250 px et la palette claire
de la navigation DRH/OPS ; le HTML standalone conserve ses propres gestionnaires.
Les autres modules ne chargent pas cette feuille. Les styles d'impression sont inchangés.

Le pipeline regroupe les étapes sans modifier leur valeur en base :

| Colonne | Étapes existantes |
|---|---|
| Réception | received |
| Étude | review, shortlisted |
| Entretien | convocation, interview |
| Décision | decision |
| Contrat | hiring_file, contract, signature |
| Recrutement | hired |

Les étapes détaillées et les décisions non communiquées restent visibles sur les cartes.
Toute étape inconnue renvoyée par le serveur a sa propre colonne, pour ne masquer aucune demande.
Le déplacement d'une carte n'est pas une nouvelle action d'écriture : le traitement
continue de passer par les formulaires contrôlés par le serveur.
Quatre indicateurs principaux sont complétés par cinq échéances compactes ; les neuf
compteurs et leurs filtres existants restent disponibles.

Le dossier conserve ses sept onglets, avec « Synthèse » pour l'onglet d'ouverture,
un repère d'étape actuelle et les pièces protégées par la session du recruteur.
Le sélecteur de portefeuille ferme le dossier précédent et recharge le périmètre choisi.
L'action d'ajout ouvre la vue par candidat et son formulaire existant.

## Validation locale

- Suite frontend : 1 066 réussis, 1 ignoré ; puis tests ciblés après les derniers ajustements.
- Tests ciblés : navigation, états, pipeline, droits, pièces, échanges, entretiens,
  contrat, conservation et thème partagé.
- Chrome réel : six scénarios réussis. Six écrans historiques, données nombreuses
  et vides, sept largeurs (390 à 1600 px), plus dossier candidat, ventilation et transfert DRH.
- Parcours unifié : quatre largeurs (390, 768, 1024, 1440 px), pipeline et tableau,
  sept onglets du dossier, échanges, conseils, sociétés et conservation.
- Les API du navigateur sont des fixtures fictives locales. Aucune écriture ni notification
  de production n'est effectuée. Aucun essai physique sur téléphone.
- Aucune modification backend, API, migration, variable de production ou SMSGate.

## Livraison

Branche locale : feat/recrute-unified-design. Le push GitHub est indisponible dans
la session de préparation (absence d'authentification HTTPS). Le correctif est livré
comme diff Git complet, applicable depuis sa base après vérification avec `git apply --check`.
Créer une branche propre depuis main, traiter les conflits éventuels si main a avancé,
exécuter la suite frontend et le test Chrome, puis pousser et ouvrir une PR.
Aucune fusion ni aucun déploiement n'a été effectué pendant cette préparation.
