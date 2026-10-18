# Pointeur V6 — interface du poste, effectifs par fonction, abandon immédiat

`pointeur.irongs.com` (`app/static/pointeur.html` + `app/static/pointeur-v6.css`). La V6 reprend le
poste V5 (flux live, planning officiel, Attendance Core) et en change la disposition et
l'ergonomie. Aucune règle de pointage, de clôture, de paie ou de régularisation n'est modifiée.

## Disposition

| Zone | Contenu |
|---|---|
| Haut | En-tête inchangé (logo, horloge métier, société, site, connexion) ; 5 compteurs cliquables |
| Gauche, haut | Pointage compact : titre et état, onglets QR / facial / saisie manuelle (18 px au lieu de 36), recherche (24 px au lieu de 36), ligne du dernier pointage, fiche employé |
| Gauche, bas | Tableau des pointages (Aujourd'hui, Entrées, Sorties, Anomalies), défilement interne, aligné en bas sur la colonne droite |
| Droite, haut | « Présents actuellement », ou le détail du compteur ou de la fonction choisis |
| Droite, bas | « Effectifs présents par fonction », jusqu'en bas |

Ordinateur (≥ 900 px) : écran fixe sans défilement de page. Au tactile (`pointer: coarse`), les
onglets et la recherche gardent 32 à 36 px. En dessous de 900 px, une seule colonne (pointage,
présents, fonctions, tableau) : la page défile et le séparateur est masqué.

## Données

`GET /api/portal/attendance-live` → `post` ajoute `expected` : une ligne par attendu de la
vacation en cours, avec son état (`PRESENT`, `ABSENT`, `EXCUSED` avec le motif du congé), sa carte
employé et l'heure d'entrée. Ce sont les mêmes ensembles que les KPI. Sans vacation déterminée,
`expected` vaut `None` (indisponible), jamais une liste vide. La vue multi-sites fusionne les listes
(avec le site), ou les déclare indisponibles si un site n'a pas de vacation. Aucune nouvelle route,
aucune migration, aucune requête de plus côté navigateur : les listes et les fonctions viennent du
flux déjà relevé toutes les 2 s.

## Compteurs cliquables

Attendus → `expected` ; Présents → `present` ; Absents / non pointés → `expected` à l'état
`ABSENT` (un congé n'est pas un absent) ; En maintien → présents `EN_MAINTIEN` ; Anomalies → `todo`.
Le détail s'affiche dans le panneau haut droit, avec « ← Vue générale » ; un second clic sur le
compteur y ramène aussi. Le périmètre reste celui du poste (site, société, droits du compte). Un
clic sur une personne ouvre sa fiche (photo, matricule, fonction, société, site, statut actuel).
Si le compte n'a pas la saisie manuelle, la fiche reste consultable et les actions sont désactivées.

## Effectifs présents par fonction

Une ligne par fonction réellement présente (libellé de la fiche ATLAS, regroupé sans casse ni
accent distinctifs), triée par effectif ; « Fonction non renseignée » en dernier, comptée. Chaque
ligne : nombre, pourcentage du total des présents (une décimale), barre, flèche vers la liste.
Le total « TOTAL EN POSTE » est le nombre de lignes du flux, donc égal au compteur « Présents »
(maintiens compris, une ligne par personne).

## Panneaux ajustables

Séparateur entre les deux panneaux de droite : glisser à la souris ou au doigt, flèches
haut / bas (5 %), Page haut / bas (15 %), Début / Fin, boutons ▲ ▼ ⟲. Chaque panneau garde au
moins 120 px ; la proportion est mémorisée sur le poste (`localStorage`,
`atlas_pointer_v6_split`) et ⟲ ou un double-clic la réinitialise.

## Abandon de poste

Un clic sur « ABANDON POSTE » suffit ; il n'y a plus de fenêtre de confirmation.

1. `GET …/attendance-manual/abandon/context` (lecture seule) contrôle la prise de service ouverte,
   la vacation enregistrée et sa fin, le seuil (60 min par défaut), la journée non clôturée, le
   périmètre et la permission.
2. Si une condition manque, rien n'est écrit et le message exact s'affiche (par exemple
   « il reste 45 min avant la fin prévue du service (22:00). Le seuil requis est de 60 minutes »).
3. Sinon, `POST …/attendance-manual/abandon` refait tous les contrôles sous verrou, avec l'heure
   du serveur et une idempotence par vacation, comme avant. Le serveur exige toujours un motif :
   l'observation saisie par l'agent est envoyée, à défaut le texte standard « Départ anticipé
   constaté au poste de pointage ». Le motif reste donc tracé dans l'audit et dans les alertes OPS
   et DRH.

Le départ, l'événement `ABANDON_POSTE`, l'anomalie, les deux alertes et l'audit restent écrits
dans une seule transaction (voir `pointeur-abandon-poste.txt`). L'événement reste consultable
pour le BRQ par `GET /api/attendance/business-events` ; aucun circuit BRQ n'est créé.

## Inchangé

Signature des QR A1, badges, douchette (le jeton est transmis tel quel), verrou de 1,8 s entre
deux badges, reconnaissance faciale et terminaux, permissions biométriques, et fenêtre flottante
de confirmation de la PR #59 (réutilisée telle quelle).

## Tests

- `tests/test_pointeur_v6_post.py` : détail des attendus = KPI, indisponibilité sans vacation,
  nuit, fonctions = présents, sortie et changement de site, abandon qui retire des présents,
  vue multi-sites.
- `tests_frontend/pointeur-v6.test.js` (jsdom), `tests_frontend/pointeur-abandon.test.js`.
- `npm run test:pointeur-v6-chrome` (Chrome réel, API simulée, données fictives) : six
  résolutions de 1920×1080 à 390×844, chevauchements, séparateur, tactile, compteurs, douchette,
  fenêtre flottante.
