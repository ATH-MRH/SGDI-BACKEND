# Rapport de publication — rotations centrales ATLAS

**DRAFT / NO-GO MERGE.** Autorisation DG limitée à la publication pour revue.

## Périmètre

Clone indépendant `/tmp/atlas-rotations-central-20261023`, branche `feat/central-rotations-local`, base `c1468e7394dcbb6de026e52348a2a765487d3d9d` contenant les PR 74 et 75. Les fichiers applicatifs et tests du lot local validé ont été comparés à leurs empreintes avant préparation. Les ajouts de cette publication concernent la neutralisation de l'adoption de migration, ses tests, la CI et la documentation. Aucun autre worktree modifié.

Moteur backend commun : 3X8, 24H48, 1/2, 1/3 ; configuration versionnée par site, simulation préalable, publication datée sous verrous, snapshots historiques, intégrations Attendance Core/BEO/DRH/BRQ. NORMAL/CUSTOM restent des extensions non publiables. Voir [architecture](central-rotations-local.md) et [chemins de migration](migration-central-rotations.md).

## Migrations

Le défaut bloquant identifié est traité dans le code proposé : 25 devient catalogue seul pour les exécutions futures. 26 n'annule ni ne rejoue une ancienne adoption. Le test après ancienne adoption utilise la copie exacte de la migration à la base validée, SHA-256 `752282f4550bbd04a234d7b3b9722d6a4fbd08a976813d3938cb169779592f6d`.

Les deux scénarios, l'idempotence, la conservation des faits/BEO et la restauration sont testés sur PostgreSQL 16 jetable. Aucune base réelle consultée ou migrée. La modification d'une révision historique exige une revue explicite avant fusion et l'inventaire de la révision réellement déployée avant production.

## Recette des quatre écrans

| Écran | Preuve disponible | Validation restante |
|---|---|---|
| OPS — Configuration du régime du site | Tests de formulaire et Chrome réel, 1920/1440/1024/820/390 ; brouillon, paramètres explicites et publication conditionnée au reçu backend | Capture du composant isolé avec CSS de test ; conformité dans le shell ATLAS complet et comparaison avec référence non certifiées |
| OPS — Planning des rotations | Résultat de simulation en tableau, API officielle, couverture/repos/conflits testés côté backend | Recette Chrome du planning peuplé et comparaison à l'écran validé ; aucune prétention de conformité à un calendrier mensuel distinct |
| Pointeur — Pointage temps réel | Chrome sur page réelle avec réponses synthétiques, huit largeurs ; scans, abandon, affichage des états et maintien | Recette visuelle DG sur configuration centrale représentative et comparaison à la référence complète |
| BEO — Couverture terrain | Test Chrome BEO existant avec API/Core locaux : sept vues, scopes, synchronisation et historique | Validation dédiée de couverture terrain avec configurations centrales, sous-effectif et vacation non couverte ; comparaison à la référence validée |

Les quatre références visuelles complètes ne sont pas disponibles dans les éléments locaux de cette recette. Les captures ne valent donc pas acceptation des quatre écrans. **Blocage de fusion maintenu.** Captures de contrôle synthétiques dans `docs/validation/central-rotations/` ; aucun compte ni fait de production.

## Tests et preuves

Les résultats exacts et empreintes des journaux sont consignés dans `docs/validation/central-rotations/results.json`. Les journaux complets restent conservés dans le clone isolé sous `validation/`. Les contrôles CI du SHA publié seront accessibles depuis la PR : backend (incluant les deux chemins PostgreSQL), frontend, mobile et Docker sans publication d'image.

La restauration testée concerne des données synthétiques : elle ne remplace pas une restauration de sauvegarde réelle, qui demandera une autorisation et un environnement isolé dédiés. Les tests PostgreSQL sont exécutés séparément du pytest complet, car le conftest partagé recrée la base SQLite par processus.

## Conditions avant mise en production

- Revue et acceptation des deux chemins de migration ; contrôle de la révision réelle et du paquet exact.
- Recette visuelle complète des quatre écrans et CI verte sur le SHA finalement revu.
- OPS/DRH : calendriers confirmés, horaires, phases, effectifs, repos et seuils validés par site.
- Date de transition explicite par site, simulation valide, relève nocturne et vacations ouvertes vérifiées ; aucune activation globale.
- Sauvegarde réelle restaurée et plan de reprise des faits postérieurs approuvé ; pas de downgrade destructeur après publication.
- Nouveau GO DG distinct pour fusion, puis pour production. Auto Deploy reste désactivé.

## Gouvernance

Auto Deploy et Preview Deployments observés désactivés dans Coolify en lecture seule pendant cette préparation. Aucun changement de configuration Coolify, aucune fusion, aucun déploiement, aucune migration de production, aucune activation de régime sur un site réel. Gel des autres sessions maintenu.
