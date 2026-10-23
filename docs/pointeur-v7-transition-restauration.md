# Plan V7 — transition, déploiement et restauration (NON EXÉCUTÉ)

Ce document prépare des opérations soumises à un GO DG distinct. Les corrections et essais sont locaux. Aucune publication, migration de production ou action Coolify n'est autorisée par ce document.

## Contrat métier maintenu

A 06:00–14:00, B 14:00–22:00, C 22:00–06:00 J+1, D OFF, tous les jours ; jour de travail de la nuit = jour de début. Toute sortie avant la fin prévue exige un abandon confirmé par un opérateur habilité avec motif. Un changement de vacation ne réinitialise pas les protections V7. La politique d’une nouvelle tentative vient du planning courant, même si la vacation précédente utilisait l’ancien modèle ; OFF est contrôlé avant tout repli vers une vacation supplémentaire. Les régimes explicitement NORMAL ou LEGACY restent exclus, même en présence d’un ancien passage posté ou d’un modèle fixe au catalogue. Une nouvelle vacation supplémentaire hérite de la politique et du retard depuis son début théorique ; dès 30 minutes, elle exige une admission manuelle habilitée et motivée. Une admission ne vaut ni décision de paiement ni dispense de validation RH.

Les instantanés des anciens pointages restent inchangés. Les anciennes affectations sont clôturées et conservées ; les grilles lisent leurs intervalles datés, même inactifs. Les affectations inactives sans borne de fin restent exclues (ne pas transformer une annulation/draft en historique autorisé). Le filtrage société/site demeure obligatoire.

## Choix du jour de transition

1. OPS et DRH inventorient les affectations POSTE_CONTINU, modèles officiels, ancrages, groupes et fins de périodes, ainsi que les nuits ouvertes et maintiens. Prévoir une relève nominative, des remplaçants et la couverture de D OFF ; ne pas convertir les horaires en modifiant les anciennes preuves.
2. Choisir un jour J en heure Africa/Algiers pour lequel tous les sites concernés passent le précontrôle. Le moteur refuse moins de huit heures entre fin théorique de J−1 et première vacation fixe de J. C'est une garde technique conservatrice, pas une certification légale du temps de repos ; OPS/DRH doivent appliquer toute exigence plus stricte et faire valider le plan par la DG.
3. Exemple refusé : A anciennement de nuit J−1 22h → J 06h, puis A fixe J 06h → 14h. Décaler le jour, organiser une relève validée et reprendre la recette. Ne jamais forcer ce cas par une variable d'environnement ou modifier l'ancrage historique.
4. Les sites dont les phases sont différentes peuvent n'avoir aucun jour commun compatible. Dans ce cas : STOP, nouvelle proposition de transition échelonnée à autoriser. La migration actuelle est globale et ne propose aucun bypass par site.
5. Le contrôle de repos réel est répété lors de la première arrivée V7 après une vacation historique : un maintien réel prolongé peut invalider un précontrôle théorique pourtant vert. Aucune admission manuelle ne contourne cette garde ; clôturer/régulariser correctement l'ancienne vacation et assurer la relève.
6. Programmer la fenêtre avant les premières arrivées de J, avec collecte des pointages temporairement suspendue. Une nuit commencée J−1 conserve son instantané et peut se terminer normalement ; assurer une voie opérationnelle maîtrisée pour la sortie durant la fenêtre. La migration refuse des pointages déjà enregistrés pour la journée de travail J : elle ne réinterprète pas une vacation commencée.

## Précontrôle en lecture seule

Dans une copie/restauration de recette à jour, choisir explicitement la connexion et la date :

```sh
# DATABASE_URL injecté par le gestionnaire de secrets de l'environnement de recette.
python scripts/pointeur_v7_preflight.py --effective-date YYYY-MM-DD
```

Le script ne charge pas de .env implicite, ouvre une transaction PostgreSQL READ ONLY et renvoie READY/BLOCKED en JSON. Une date future peut être examinée ; READY ne constitue ni une autorisation ni une garantie sur des données qui changeront ensuite. Archiver le résultat avec J, le SHA et les responsables OPS/DRH. Refaire le contrôle immédiatement avant toute adoption autorisée. Ne pas lancer ce contrôle sur la production sans autorisation de lecture correspondante.

## Déploiement proposé après autorisations séparées

- Définir l'ordre d'intégration #74/#75. La commande test principale reste compatible avec #74 ; les tests V7 s'exécutent dans pretest avec BRQ. Exiger recette combinée backend, PostgreSQL, frontend et Chrome puis CI distante du SHA effectivement publié. Aucun test ni skip biométrique ne doit être affaibli.
- Autoriser séparément publication, revue, fusion puis déploiement. Épingler l'image et le SHA ; conserver l'image antérieure et les configurations d'exploitation. Contrôler les comptes et habilitations de lecture, pointage manuel, validation et sites.
- Pendant la fenêtre autorisée, suspendre les écritures et noter le dernier événement, les effectifs physiques et les vacations ouvertes. Sauvegarder PostgreSQL en format custom avec pg_dump version compatible, l'inventaire des versions Alembic, les pièces/uploads et configurations nécessaires ; stocker les secrets séparément dans leur coffre. Vérifier lisibilité et empreinte de la sauvegarde. Utiliser un emplacement de sauvegarde protégé.
- Restaurer la sauvegarde dans une base distincte vide avec pg_restore --exit-on-error. Vérifier les empreintes des lignes, volumes, marqueur Alembic et visibilité BEO ; contrôler les rôles/droits applicatifs, séquences, stockage des pièces et accès chiffrés. Ne pas considérer un dump non restauré comme une sauvegarde validée.
- Refaire le précontrôle et faire confirmer les relèves par OPS/DRH. Fournir ATLAS_V7_EFFECTIVE_DATE=J explicitement pour l'exécution autorisée de la migration. La date doit correspondre au jour local d'exécution ; sans date ou si dangereuse, l'adoption peuplée est refusée avant écriture. Ne pas laisser le démarrage automatique tenter ce basculement sans précontrôle et GO DG.
- Vérifier le marqueur 20261025_0001, une seule adoption par intervalle, les faits historiques inchangés et visibles, les fenêtres A/B/C/D, le refus des entrées non configurées, retard ≥30 min, sortie anticipée, abandon, maintien et première nuit après transition. Recouper les identifiants des faits et situations entre OPS, DRH, BEO et BRQ, ainsi que leurs audits/projections.
- Réouvrir les écritures après recette et accord du responsable. Surveiller erreurs, refus, doublons, performance et couverture des relèves. Tout défaut métier critique impose STOP et décision DG.

## Restauration / retour arrière proposé

Le downgrade refuse un modèle référencé par affectations, liens ou faits V7. Un modèle de catalogue réellement inutilisé peut être retiré ; ce n'est pas une stratégie de retour d'une exploitation démarrée.

Avant toute reprise d'écritures, si l'adoption échoue : vérifier le rollback transactionnel, l'ancien marqueur et les empreintes, puis conserver l'ancienne version. Ne pas effacer manuellement le marqueur ni les données pour contourner un refus.

Après une adoption réussie mais avant toute nouvelle écriture : maintenir le gel et, avec autorisation DG, restaurer la sauvegarde validée dans une base distincte, vérifier les empreintes et la cohérence avec l'image antérieure, puis faire autoriser le basculement de connexion. Ne pas écraser la base à analyser.

Si des écritures ont repris : STOP des écritures, sauvegarde immédiate de l'état post-transition, export sécurisé de tous les faits/audits nouveaux et inventaire des pièces. Une restauration aveugle ferait perdre ces données ; préparer un rejeu contrôlé et idempotent/une correction en avant dans une copie, préserver auteur et heure réelle, démontrer l'absence de doublons et recouper les totaux. La décision et l'exécution requièrent une nouvelle autorisation DG. Les anciennes images peuvent ne pas reconnaître la nouvelle révision Alembic : un simple redéploiement de l'image antérieure n'est pas un rollback complet.

Les essais de cette mission n'utilisent que des données synthétiques. Ils ne certifient ni une sauvegarde réelle de production, ni sa durée de restauration au volume réel, ni la disponibilité du personnel de relève.
