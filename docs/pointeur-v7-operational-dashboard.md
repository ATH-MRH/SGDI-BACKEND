# Poste de pointage V7

Branche : `feat/pointeur-v7-operational-dashboard`. Base : `bfefcbb550eb8fe4a5081be7114bd7718cda9ed3`.

## Décisions métier validées

Les groupes sont permanents : A 06:00–14:00, B 14:00–22:00, C 22:00–06:00 le lendemain, D OFF.
Toute sortie avant la fin prévue est refusée, y compris dans les 29 dernières minutes. Ces deux décisions ont été explicitement confirmées par le demandeur.

Le modèle officiel `3X8-FIXED-ABCD-V7` porte ces règles. Les instantanés des passages portent `policy_version=7` ; les anciens modèles et instantanés conservent leur contrat historique. L'interface et les consommateurs lisent les mêmes sources Attendance Core.

| Passage V7 | Résultat |
|---|---|
| T−46 min | Refus, aucune présence |
| T−45 min à T | Entrée acceptée, début comptabilisé à T |
| T+1 à T+29 min | Entrée acceptée, retard réel enregistré et affiché |
| T+30 min et au-delà | Refus automatique, tentative brute et point critique |
| Entrée manuelle tardive | Habilitation + motif ; retard recalculé à la confirmation |
| Avant la fin prévue | Refus automatique ; abandon explicitement confirmé pour sortir |
| Fin prévue à fin+45 min | Sortie normale autorisée |
| Après la fin sans sortie | Toujours présent, maintien orange ; jamais retiré par expiration de délai |
| Sortie après maintien prolongé | Sortie et durée de maintien enregistrées, situation résolue/archivée |
| Groupe D OFF | Refus de passage hors planning ; pas d'absence ni de retard normal |

Un remplacement ou mouvement officiel doit modifier l'affectation/planning autorisé : aucun override fourni par le navigateur ne remplace ce contrôle. Les journées de nuit restent rattachées au jour de début de vacation.

## Adoption et historique

La migration `20261025_0001` étend la tête `20261024_0001`. Elle crée le modèle fixe et date l'adoption à la journée locale Africa/Algiers où la migration sera exécutée. Pour les affectations actives explicitement POSTE_CONTINU sur un modèle officiel antérieur, elle clôt l'ancienne période et crée une nouvelle période V7 ; les liens site/modèle suivent la même séparation datée. Les affectations futures peuvent changer de modèle directement. LEGACY, NORMAL et modèles non officiels restent exclus.

Les anciens modèles, événements et périodes historiques ne sont pas supprimés. Une migration rejouée ne crée pas d'autres périodes. Un downgrade est refusé lorsque le modèle V7 est utilisé : un retour métier doit être préparé explicitement. Aucune migration n'a été exécutée en production pendant cette mission.

## Faits, situations et projections

`AttendanceEvent` reste le journal append-only. ARRIVAL/DEPARTURE + source MANUAL réutilisent les types existants ; ABANDON_POSTE et CORRECTION restent les faits existants. REFUSED_ENTRY/REFUSED_EXIT distinguent les nouvelles tentatives refusées sans créer de DailyPresence. Les refus historiques conservent leur audit existant.

`AttendanceAnomaly` reste le registre des points critiques ; aucun registre de présence parallèle. Déduplication par employé/site/vacation/type ; maintien par identifiant d'entrée ; non-pointé après T+30 hors congé/maladie/mission/repos. Le workflow versionné dans les détails suit : Détecté → À traiter → En cours → À valider → Validé → Archivé. Toute transition nécessite validation, responsable et motif, avec audit avant/après et verrou de concurrence. Les cas simples gardent leur résolution existante ; les situations critiques ne peuvent pas contourner le workflow par l'ancienne résolution directe.

Les situations V7 alimentent des alertes durables OPS et DRH, dédoublonnées par point et audience. Une validation ou une résolution automatique (arrivée après non-pointé, sortie après maintien) clôt aussi ces projections. L'abandon conserve sa transmission existante et sa preuve dédiée ; sa gravité V7 est critique. Il n'y a aucun envoi de mail ou message externe.

BEO : `GET /api/site-workforce/attendance/situations` projette ces mêmes points, filtrés en SQL par les sites et employés autorisés, sans écriture. Le cockpit Pointage permet le suivi et la validation. Le dossier salarié DRH affiche « Points critiques & situations » depuis le récapitulatif canonique. Le BRQ conserve l'accès filtré aux événements métier via `/api/attendance/business-events`, sans recalcul des présences.

## Interface et sécurité

Styles limités au Pointeur V7 : en-tête marine, horloge, sélecteurs, cinq compteurs cliquables, modes QR/facial/manuel, recherche/réinitialisation, présents, historique avec badges de statut, événements et pied fixe. Les listes restent alimentées par les flux existants, sans rechargement global ni minuteur ajouté. Le détail par compteur et l'ouverture d'une fiche conservent les interactions clavier existantes.

Le réseau, la relève et l'indisponibilité de la caméra ne produisent pas un faux état vert. Une panne de transport ambiguë conserve le message : « Vérifiez le dernier pointage avant de recommencer. » Les seuils et le contrat de reconnaissance biométrique n'ont pas été modifiés ; aucun test biométrique n'est modifié.

La sélection du dernier passage est globale avant le filtre de site, et une seule ligne par employé est renvoyée par SQL. Les maintiens prolongés ne nécessitent pas de charger l'historique en Python. Les données affichées sont échappées ; aucun embedding, secret, token ou IP interne n'est ajouté à l'écran.

## Validation

Tests backend : matrices QR/facial A/B/C, fenêtres, retard manuel, nuits, OFF, sortie avant fin, abandon, maintien prolongé, non-pointé, workflow/RBAC, dédoublonnage et projections OPS/DRH/BEO ; migration datée et rejouable ; suites historiques.

Tests frontend : suite complète, plus Chrome V7 réel avec API et données fictives. Captures 1920, 1600, 1440, 1280, 1024, 820, 430 et 390 pixels ; contrôle des chevauchements et du débordement horizontal ; abandon et QR successifs sans masquer les commandes. Aucun matériel biométrique réel n'a été utilisé par ces tests locaux.

Les résultats chiffrés, SHA de publication, lien PR et CI sont consignés dans le rapport de livraison. Les tests PostgreSQL et moteurs faciaux réels dépendants de services absents restent explicitement ignorés par la configuration existante.

## Production

Publication autorisée : commit, push et Pull Request vers main, puis surveillance CI. Aucune fusion, aucun déploiement, aucune modification de production. Un GO DG distinct demeure nécessaire pour ces opérations.
