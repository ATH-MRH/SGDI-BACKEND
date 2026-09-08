# Campagne frontend 2B–2G

Base : `31795cc79a4cdbbb3f24e3f341f8096cfc0f5c58`.

## Méthode

Les fonctions sont déplacées sans réécriture de leur corps. Les appels synchrones
transverses et les états lexicaux utilisés au bootstrap restent dans le core.
Les modules sont des scripts classiques : leurs déclarations globales préservent
les onclick et les bridges. Aucun script de domaine n’est ajouté à index.html.
L’inventaire JSON recense fonctions, collections db, API, timers et mesures par domaine.
Les collections restent hydratées par le mécanisme existant : leur chargement
à la demande est une piste ultérieure, sans modification du state dans cette campagne.

## 2B

- VALIDÉ : vues/actions Paie, 650 lignes. Les calculs IRG/configuration/clôture
  et export CSV utilisés ailleurs restent synchrones dans le core.
- REPORTÉ : blacklist/unlock/impressions, fiches de position/badges, photos/documents.
  Appels transverses depuis les fiches agents, Administration, Matériel et parcours
  public badge hors routeur ; aucune extraction forcée.
- Vérification : calculs Paie existants, scripts séparés réellement injectés,
  parcours Dashboard/Secrétariat/Paie répété trois fois et navigation rapide.

## Contrats de cycle de vie

Init est dédupliqué par le registre. Les composants purement déclaratifs ont des
hooks vides ; les ressources de vues doivent être arrêtées dans destroy.
Les fonctions synchrones encore utilisées hors route ne deviennent jamais des
wrappers Promise. Les permissions et les appels API restent identiques.
