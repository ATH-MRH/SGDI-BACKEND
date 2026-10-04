# BEO — Pointage V4

Base : origin/main c78bf8ab45e22aee1de99d0ce45926363a5d2cc2. Branche : refactor/beo-attendance-workspace-v4. Aucun push ni déploiement.

## Audit et source des données

Le BEO utilise `/api/site-workforce/attendance`, les affectations datées OPS et les faits `DailyPresence` du Attendance Core. La nouvelle projection mensuelle partagée `attendance/workspace.py` alimente les lectures `/api/attendance/workspace` et `/api/site-workforce/attendance/workspace`. Elle ne crée ni table, ni stockage mensuel, ni synchronisation. Les écritures gardent les endpoints BEO existants, `core.record_day_status`, l’acteur authentifié et la source SITE_WORKFORCE. Les corrections après clôture gardent l’endpoint existant avec validation et motif obligatoire.

La population est limitée aux sites explicitement autorisés, aux sociétés du périmètre et aux affectations valides pour chaque date. Les filtres société/site sont contrôlés côté serveur, pas seulement dans les sélecteurs. Les droits explicites de lecture/création/modification pilotent aussi le rendu ; aucun nouveau rôle n’est créé. Les permissions vides ne donnent plus implicitement accès à ce workspace ou à une saisie BEO.

Le calendrier réutilise le week-end vendredi/samedi du Pointage existant ; le planning appelle `core.planned_day` et les rotations configurées. La complétude reprend le ratio quotidien renseigné/total, agrégé côté serveur sur les journées-agent affectées du mois. Les KPI portent sur toute la population filtrée, avant pagination. Un repos projeté depuis une rotation ne compte pas comme une saisie enregistrée.

## Écarts du visuel traités explicitement

Les statuts réellement inscriptibles du Core sont P, A, M, C, R et mission. Mission est affichée MI : le S du Pointage historique signifie Suspendu et ne peut pas devenir Sortie. Aucune action de saisie en masse n’existait dans le BEO : le bouton Enregistrer exécute les écritures unitaires existantes pour les cellules modifiées. Les demandes de congé et de maladie gardent leurs workflows propres ; la saisie d’un statut de présence ne valide aucune demande. Les pourcentages, compteurs et périodes illustratifs ne sont pas codés en dur.

L’interface historique globale basée sur les feuilles legacy (`db.pointages` / `db.feuillePresence`) reste inchangée. La cohérence vérifiée concerne le Centre de contrôle Pointage et Attendance Core, source existante du BEO. Ces feuilles legacy ne sont ni migrées, ni copiées silencieusement dans une seconde source.

## Interface et validation

Sept vues : quotidienne, saisie mensuelle par défaut, planning sept jours, récapitulatif agent, récapitulatif société, statistiques et légende. Grille dense avec identité fixe et défilement horizontal local ; sur mobile, cartes agent avec sept jours navigables. Données tardives ignorées après navigation ; écouteurs supprimés à la déconnexion.

Les tests backend couvrent les deux sens BEO/Core, IDOR site/société/employé, lecture seule, permissions vides, clôture, calendrier 28/29/30/31 et pagination sur 150 agents avec contrôle du nombre de requêtes SQL. Les tests frontend couvrent les cellules en attente, les raccourcis hors champs de saisie, le motif de correction et les réponses tardives. Chrome utilise de vrais comptes de test Ouest et Centre sur une base locale jetable : il ne touche aucun compte de production. Captures dans `/tmp/atlas-beo-attendance-v4` aux largeurs 1600/1440/1280/1024/768/430/390.

Le texte fourni s’arrête au début de la section 56 État vide. Les vues vides sont explicites ; aucune exigence située après cette coupure n’a été supposée.

## Résultats finaux

- Backend BEO + Attendance API + nouveaux tests : 41/41.
- Frontend BEO, workspace et Design System : 29/29 ; dernier changement de date et correction avec motif recontrôlés.
- Nouveau parcours Chrome V4 : réussi, sept vues et sept largeurs, comptes Ouest/Centre, central réel et cohérence bidirectionnelle.
- `npm test` complet : 909/912. Échecs dans les tests inchangés de navigation rapide, précédent/suivant (`module-campaign`) et réponse Administration après navigation Sites (`module-races`). Le premier échec est également reproduit sur le checkout de base c78bf8a. Les échecs de courses varient entre exécutions ; aucun de ces composants n’est modifié par la refonte.
- Ancien parcours `site-workforce-e2e` : deux sous-scénarios échouent (`fetch failed` à la connexion après seed et assertion Congés vide). Les mêmes deux échecs sont reproduits sur c78bf8a ; les scénarios hostile, changement de périmètre et responsive neuf écrans passent.
- `git diff --check` et contrôles de syntaxe : réussis.

Le lot est reviewable localement, mais la validation globale n’est pas verte : NO-GO pour intégration/déploiement sans traitement des échecs transverses. Aucun correctif hors périmètre n’est inclus.
