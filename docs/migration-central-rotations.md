# Chemins de migration — moteur central ATLAS

Statut : PR brouillon, NO-GO MERGE. Aucun ordre de migration de production.
Base de revue : `c1468e7394dcbb6de026e52348a2a765487d3d9d`.

## Pourquoi modifier une révision déjà fusionnée

L'ancienne `20261025_0001` adoptait globalement le catalogue fixe V7 pour les affectations POSTE_CONTINU et les liens officiels actifs. Une correction dans `20261026_0001` arrive trop tard : Alembic exécute d'abord 25. Une compensation ultérieure réécrirait à nouveau les intervalles historiques. Cette PR retire donc uniquement les écritures d'adoption de l'exécution future de 25. Son identifiant et son parent restent inchangés. Le catalogue V7 reste disponible pour lire les faits existants ; sa création n'active aucun site.

La copie `tests/fixtures/rotations/20261025_original.py`, extraite de la base de revue, est exclusivement une fixture historique. Elle n'est pas dans le répertoire Alembic et ne doit jamais être utilisée comme procédure de production. Le test PostgreSQL la rejoue dans une base jetable pour représenter fidèlement une ancienne adoption.

## 1. Base où l'ancienne 25 a déjà été appliquée

Alembic ne rejoue pas 25. La révision 26 ajoute seulement les tables centrales et leurs protections. Affectations, liens de site, modèles, événements, présences et instantanés restent identiques. Aucune désadoption automatique : elle serait une nouvelle décision métier susceptible de casser les vacations en cours.

Avant une future exploitation : inventorier les adoptions réellement présentes, faire valider leur maintien temporaire par OPS/DRH, puis définir une configuration centrale explicite et une date d'effet par site. La simulation doit intégrer les anciennes vacations, les présences ouvertes, les repos et les conflits intersites. Une publication refusée ne doit jamais être forcée.

## 2. Base pré-V7

Utiliser exclusivement le paquet contenant la version corrigée de 25 et la révision 26, après restauration isolée et contrôle de leurs empreintes. L'exécution future de 25 ajoute au plus le catalogue fixe V7. Elle ne modifie aucune affectation ni aucun lien de site, ne convertit aucun POSTE_CONTINU et ignore toute ancienne variable ATLAS_V7_EFFECTIVE_DATE pour l'adoption. La révision 26 n'adopte rien non plus. Les anciens plannings restent officiels tant qu'OPS n'a pas publié explicitement une configuration centrale datée.

Le script `pointeur_v7_preflight.py` conserve son ancien diagnostic de transition fixe pour consultation historique. Son résultat READY n'autorise aucune adoption centrale et ne remplace jamais la simulation OPS. Sa garde de huit heures n'est pas le repos métier du nouveau moteur.

## Preuves et limites

- Matrice SQLite : huit phases historiques, variable de transition absente, passée, future ou du jour ; deux exécutions sans modification d'affectations ni d'ancrages.
- PostgreSQL pré-V7 peuplé : nuit historiquement incompatible avec l'ancienne adoption conservée, toutes les tables existantes inchangées sauf ajout au catalogue, aucune publication centrale.
- PostgreSQL après ancienne 25 : empreintes de toutes les tables existantes identiques après 26 ; événements et cellule BEO conservés ; deuxième upgrade idempotent.
- Sauvegarde/restauration PostgreSQL : données, séquences, contraintes et index historiques conservés ; seconde restauration d'une configuration centrale avec planning de 90 jours identique et protection d'immutabilité active.

Les quatre contrôles CI restent backend, frontend, mobile et construction Docker sans publication. Le contrôle backend exécute aussi les scénarios ci-dessus sur un service PostgreSQL jetable.

## Conditions avant tout futur GO

Inventaire autorisé de la révision réelle, sauvegarde réelle restaurée en environnement isolé, revue explicite du changement de comportement de 25, recette visuelle des quatre écrans, calendriers et repos validés OPS/DRH, date de transition par site et relève nocturne validées, CI verte sur le SHA revu, Auto Deploy maintenu désactivé, puis nouveau GO DG. Ne pas utiliser stamp, ne pas rejouer l'ancienne 25 sur une base réelle, ne pas annuler des affectations historiques.

## Restauration préparée, non exécutée en production

Avant migration autorisée : sauvegarde complète et empreintes, restauration isolée vérifiée, contrôle de la révision et des faits. Après publication métier, le downgrade 26 refuse la suppression de configurations existantes. Privilégier une correction en avant ; une restauration exige l'arrêt contrôlé des écritures, la conservation de l'état incident et un plan approuvé de reprise des faits postérieurs à la sauvegarde. Une simple restauration ne doit pas effacer les pointages récents.
