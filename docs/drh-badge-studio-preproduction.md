# Studio Badges DRH — rapport de préproduction (PR #20)

État au 11/10/2026, branche `feat/drh-badge-studio`. Complète `docs/drh-badge-studio.md`.
Aucune fusion, aucun déploiement et aucun accès à la production n'ont été effectués pour
établir ce rapport : tous les essais ont eu lieu sur un poste de développement, avec une base
PostgreSQL 16 jetable et des employés fictifs.

## Décision

**NO-GO tant que la sauvegarde et la restauration de la base de production ne sont pas
attestées.** Ce contrôle est mené séparément par l'exploitant. Sur le reste du périmètre, la
branche est prête : voir les points restant à valider en fin de document.

## Résultats des tests

| Suite | Résultat |
|---|---|
| Backend complet (`pytest`) | 1865 réussis, 59 ignorés, 0 échec |
| dont `tests/test_drh_badges.py` | 31 réussis |
| Frontend (`npm test`) | 1018 réussis, 0 échec (+ 12 en pré-test) |
| dont `tests_frontend/drh-badges.test.js` | 10 réussis |
| `npm run test:core-v3` / `test:drh-next` | 45 / 115 réussis |
| `git diff --check` | propre |
| Alembic | une seule tête, `20261015_0002` |

Les tests ignorés sont ceux qui exigent un environnement particulier (modèles biométriques,
base PostgreSQL dédiée) ; aucun ne concerne les badges.

## Matrice

| Exigence | État | Preuve |
|---|---|---|
| Sauvegarde et restauration de la production | **BLOQUÉ** | Hors de cette passe, à attester par l'exploitant. |
| Français et arabe : aperçu | CONFORME | Chrome réel : police servie par l'application, lettres liées, droite à gauche. |
| Français et arabe : PDF individuel | CONFORME | Police incorporée au PDF, format 54 × 86 mm exact. |
| Français et arabe : planche A4 | CONFORME | Quatre badges (arabe, prénom arabe, nom long, mixte) sur une planche. |
| Noms mixtes français / arabe | CONFORME | Même ordre d'affichage dans l'aperçu et le PDF. |
| Texte long | CONFORME | Réduction automatique : le nom occupe exactement la largeur du cadre. |
| Caractères accentués | CONFORME | Polices standard inchangées, aucune police incorporée pour un badge en français. |
| QR non affecté par l'arabe | CONFORME | QR relu par un décodeur sur un badge en arabe. |
| Aucun service externe pour un badge | CONFORME | Émission et impression réussies avec le réseau neutralisé. |
| Permissions explicites, refus par défaut | CONFORME | Accès DRH seul : consultation ; chaque action refusée et journalisée. |
| Aucune permission accordée automatiquement | CONFORME | La migration n'insère aucune permission. |
| Administrateur global : accès complet | CONFORME | Testé. |
| Ancien écran conservé, impressions tracées, QR local | CONFORME | Chrome réel ; périmètre non élargi. |
| Interrupteur `BADGE_STUDIO_ENABLED=false` | CONFORME | Serveur réel : API badges 503, reste de l'application disponible, données intactes, réactivation immédiate. |
| Retour à l'ancien code sur base migrée | CONFORME, avec deux effets à connaître | Voir ci-dessous. |
| Schéma et données conservés au retour arrière | CONFORME | 4 badges, 1 modèle, 12 événements identiques avant et après. |
| QR d'un badge révoqué ou remplacé | CONFORME | « Badge désactivé », y compris après émission d'un nouveau badge. |
| Dimensions PDF | CONFORME | 54 × 86 mm, format personnalisé et A4 vérifiés à 0,01 point. |
| Chaîne Alembic sur `main` | CONFORME | Montée depuis `20261014_0001` sur PostgreSQL. |

## Arabe : solution retenue

- Police **DejaVu Sans** (normal et gras), fournie avec l'application dans
  `app/static/fonts/` avec sa licence, incorporée dans le PDF et chargée par l'aperçu depuis
  l'application elle-même.
- Mise en forme des lettres liées par `arabic-reshaper` 3.0.0 et ordre d'affichage
  bidirectionnel Unicode par `python-bidi` 0.6.11, deux bibliothèques ajoutées à
  `requirements.txt`. Le calcul est fait sur le serveur ; rien ne sort de l'application.
- Le français garde les polices standard : son rendu ne change pas.
- Le refus à l'émission ne subsiste que pour une écriture sans police dans l'application.

Limites : pas d'italique en arabe ; ligatures décoratives écrites en lettres liées ordinaires ;
police sobre, non calligraphique. Le rendu a été contrôlé visuellement par comparaison de
l'aperçu et du PDF, pas relu par un lecteur arabophone.

## Retour à l'ancien code : essai réalisé

Base contenant les quatre tables, des badges émis et des permissions badges, puis :
`alembic stamp 20261016_0001`, démarrage du code de `main` (son `alembic upgrade head` ne
rejoue rien), contrôles, retour au code du studio et `alembic upgrade head`.

- L'ancien code démarre et répond normalement : accueil, employés, contrats, sites,
  utilisateurs, catalogue et lecture des permissions, connexion d'un compte DRH.
- Les tables et les données des badges ne sont ni lues ni modifiées par l'ancien code.

Deux effets pendant le retour arrière :

1. Le QR des badges émis par le studio répond « lien invalide » : l'ancien code ne connaît pas
   le lien propre à chaque badge. Il revalide dès le retour au code du studio.
2. Réenregistrer les droits d'un utilisateur dans l'ancienne Matrice des droits efface ses
   permissions badges. La consultation ne les touche pas. Elles sont à réattribuer ensuite.

## Ordre des gestes en cas de problème

1. `BADGE_STUDIO_ENABLED=false` et redémarrage.
2. Si nécessaire : `alembic stamp 20261016_0001` avec le code courant, puis redéploiement du
   commit précédent.
3. Dernier recours : restauration de la sauvegarde prise avant le déploiement.

`alembic downgrade` n'est pas une procédure de retour arrière. S'il est lancé malgré tout, les
tables et les permissions contenant des données sont conservées.

## Incident de développement

Le 11/10/2026, un fichier de travail local non suivi par Git (`test_sgdi.db-journal`, journal
d'une base SQLite de test) a été supprimé par le premier lancement de la suite de tests :
SQLite efface un journal orphelin à l'ouverture de la base. Aucune donnée de production ni
aucun fichier du dépôt n'est concerné. Aucune récupération n'a été tentée. Mesure retenue :
copier ce type de fichier hors du répertoire de travail avant de lancer les tests.

## Points restant à valider

1. **Sauvegarde de production** : date du dernier dump et restauration réussie sur une base
   isolée (bloquant).
2. **Relecture de l'arabe** par un lecteur arabophone sur un badge imprimé.
3. **Essai sur l'imprimante à cartes réelle** : cadrage, couleurs, lisibilité du QR au scan.
4. **Liste des utilisateurs à habiliter** : après déploiement, seul un administrateur global
   peut émettre tant qu'aucune permission n'est attribuée.
5. **Images de production** : les deux bibliothèques ajoutées s'installent à la construction
   de l'image ; à constater sur la première construction.
6. **Transition de l'ancien écran** : décision à prendre après observation de l'historique des
   impressions.
