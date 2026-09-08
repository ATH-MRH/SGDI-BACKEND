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

## 2C — Pointage

1 675 lignes extraites en deux scripts de route ; fonctions de calcul partagées,
QR utilisé par OPS et overlay global d’enregistrement conservés dans le core.
Le timer de relève 30s quitte le bootstrap. Destroy arrête relève, QR tablette,
présence live, planning, saisie automatique et scanner. Une réouverture attend
la fermeture du scanner. Les démarrages différés vérifient leur vue ; la reprise
après chargement des employés vérifie hash/génération/vue.

## 2D — OPS

1 229 lignes de vues/actions OPS et Superviseur extraites en deux scripts.
Les opérations partagées (historique d’affectation, documents missions, portail
client administrateur) restent synchrones dans le core. Destroy arrête les alertes
60s, le QR, les callbacks différés et le listener de menu missions. Les callbacks
différés de vues vérifient hash et génération avant exécution.

## 2E — Matériel

3 901 lignes extraites : material (vues/dotations), material-stores (retours et
magasins), material-inventory (catalogue/inventaire), material-movements
(formulaires mouvements). Dépendances déclarées ; aucun nouveau fichier de
5 000 lignes. Les listeners de formulaires restent attachés à leurs éléments,
aucun polling global ajouté. Les helpers de stock/dotation appelés depuis les
fiches agents, Administration et synchronisation restent dans le core.

## 2F — Recrutement

1 426 lignes déplacées, vues/formulaires et actions. Les fonctions de validation
partagées restent synchrones. Le debounce d’autosauvegarde conserve sa sémantique
existante (pas d’annulation silencieuse d’une saisie à la sortie). Les listeners
d’autosauvegarde restent attachés aux champs et protégés par candidatDraftBound.

### Contrats

Vues de tableau de bord, listes, exports et actions isolées déplacées. Le moteur
de documents contractuels et les formulaires employés partagés restent dans le
core pour préserver leurs appels synchrones depuis les autres domaines.
