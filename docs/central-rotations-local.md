# Rotations centrales ATLAS — implémentation locale

Base : c1468e7394dcbb6de026e52348a2a765487d3d9d (#74 et #75 fusionnées).
Publication GitHub autorisée uniquement en PR brouillon. Aucun GO fusion ou production.

## Autorité et calcul

`app/modules/rotations/engine.py` calcule 3X8, 24H48, 1/2 et 1/3 sans base, horloge ou remise à zéro mensuelle. NORMAL/CUSTOM sont des points d’extension explicitement non publiables. Les paramètres sont requis, non hérités implicitement d’un autre site. La convention des jours est lundi=0 à dimanche=6.

- 3X8 : trois fenêtres contiguës de 480 minutes ; nombre de jours par position explicite et phases assurant matin/après-midi/nuit/OFF.
- 24H48 : définition métier JOUR/NUIT/OFF/OFF, et non déduction depuis l’intitulé.
- 1/2 : créneaux de douze heures depuis l’ancre, ordre des groupes porté par les phases.
- 1/3 : A uniquement jour ouvré non férié, sans minute de nuit réglementaire ; nuits B/C/D continues. Le remplacement de jour est déterministe dans l’ordre du cycle, en excluant les nuits voisines et tout repos insuffisant. Aucune modification des nuits par un remplacement. Si aucun candidat, UNCOVERED_SHIFT / VACATION NON COUVERTE. Les effectifs requis positifs distinguent UNDERSTAFFED du groupe non couvert.

Le repos est explicitement configuré ; huit heures ne sont pas imposées par le nouveau moteur. Les horaires, jours, calendrier et provenance/version, phases, seuil et marge sont dans le JSON de configuration publié. Le calendrier comporte une période de confirmation explicite ; un horizon non confirmé bloque la simulation et le pointage officiel plutôt que de présumer un jour ouvré. Les occurrences portent leurs heures et la date métier de début ; les événements conservent configuration, version et politique figées.

## Publication et sécurité

Deux tables supplémentaires : rotation_configuration_drafts et official_rotation_configurations. Un brouillon n’active rien. La simulation 30/60/90 jours inclut effectifs, conflits intersites, transitions et faits ouverts. Son empreinte inclut brouillon, moteur, publications et affectations ; une modification rend la simulation périmée.

La publication exige validate OPS et les périmètres société/site, une date future, une simulation verte et une nouvelle vérification sous verrou du site. Les publications sont chronologiques ; la révision d’une période future déjà publiée est refusée plutôt qu’écrasée. Un même brouillon publié est idempotent. Les changements de groupe disposent d’une route datée et contrôlée ; l’ancienne affectation est conservée.

Sur PostgreSQL, le trigger protège les publications contre UPDATE/DELETE directs et les intervalles qui se chevauchent ; aucune extension privilégiée requise. L’audit réutilise audit_events et enregistre avant/après, motif, acteur, rôle, site, version et empreinte. L’audit append-only ORM existant reste distinct des droits SQL administrateur.

## Intégrations

Le résolveur officiel partagé consulte la configuration centrale applicable avant les anciens modèles. Les sites non adoptés continuent leur chemin historique ; aucune affectation ou configuration réelle n’est convertie automatiquement. Le Core utilise les seuils et marges figés, refuse OFF et sorties anticipées, maintient le motif et les droits manuels. Les feuilles suivent les fenêtres figées des événements centraux. OPS, workspace BEO, DRH/récap et BRQ continuent d’utiliser ces adaptateurs et faits canoniques.

Les points de couverture publiés réutilisent AttendanceAnomaly et ses projections OPS/DRH ; les erreurs de brouillon restent des résultats de simulation persistés, distincts des faits de présence.

L’écran OPS est accessible par ops/rotations, dans la barre latérale OPS existante : sites autorisés, structure/client, paramètres pertinents, phases, calendrier, brouillon, simulation, publication et historique. Aucun calcul de cycle dans le navigateur. Les visuels manquants ne sont pas déclarés reproduits à l’identique.

## Migration et production : BLOQUÉES avant recette d’exploitation

La migration 20261026_0001 ajoute les deux tables et protections, sans adopter de site et sans modifier les faits historiques. Elle descend de 20261025_0001.

Le chemin sûr est décrit dans [migration-central-rotations.md](migration-central-rotations.md). Pour une base pré-V7, 20261025 est désormais strictement un ajout de catalogue sans affectation : aucune adoption, même si ATLAS_V7_EFFECTIVE_DATE subsiste dans l’environnement. Pour une base ayant déjà exécuté l’ancienne révision, Alembic ne la rejoue pas ; 20261026 préserve intégralement les affectations, modèles et faits existants. Il n’y a aucun retour automatique au régime antérieur. Toute nouvelle adoption reste une publication OPS explicite, datée et simulée par site.

Avant toute production : obtenir GO DG distinct, confirmer auto-deploy désactivé, inventorier les versions et configurations réelles en lecture autorisée, restaurer une sauvegarde réelle dans une base isolée, faire valider calendriers et repos par OPS/DRH, préparer relèves et date d’effet par site, simuler puis publier explicitement. Les sites 22/27 et leur éventuel doublon ne sont ni corrigés ni codés en dur.

Le downgrade refuse toute publication existante. Après écritures, retour par restauration sans rejeu ferait perdre des faits : conserver une sauvegarde de l’état incident et préparer une correction en avant ou un rejeu autorisé dans une copie. Aucun retour de production n’a été exécuté.
