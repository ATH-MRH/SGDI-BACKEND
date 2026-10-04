# Recrutement V6 — refonte responsive globale (4 octobre 2026)

Refonte UI/UX uniquement de `recrute.irongs.com`. Workflow, statuts, avis, permissions, API,
backend, base de données, modèle candidat, logique société, action Recruter et import Excel :
inchangés. Aucun push, aucun déploiement.

## Architecture constatée

Application autonome `app/static/recrute.html` (pas de routeur : `showRecruitSection` bascule des
sections). Réserve, Candidats recrutés et Archives sont des onglets de la vue Candidatures
(`switchTab`). Feuilles : styles locaux, `recruitment-dashboard-v5.css`, thème `design-system/atlas.css`.

## Matrice d'audit (avant modification)

| Écran | Vue / renderer | Permissions | Problèmes desktop | Tablette | Mobile |
|---|---|---|---|---|---|
| Tableau de bord | `dashboardSection` / `renderRecruitDashboard` | read, create, update | référence V5 | — | — |
| Candidatures | `candidatesSection` (`new`) / `loadTab`, `renderCounters`, `renderList` | create, update | bouton Ajouter dans la grille des filtres (déborde), zone « Par poste » vide, état vide surdimensionné, tableau `min-width:1080px` | bouton orphelin, défilement horizontal | tableau compressé |
| Réserve, Recrutés, Archives | même vue, onglets | update, create | titre unique « Gestion des candidatures » | idem | idem |
| Entretiens | `interviewsSection` / `renderRecruitInterviews` | update | 8 colonnes sans filtre ni compteur | débordement | illisible |
| Annonces | `announcementsSection` / `renderRecruitAnnouncements` | create, update, delete | liste pleine largeur, deux boutons pleins par ligne | chevauchements | boutons empilés |
| Fiche candidat | `modalBackdrop` | create / update | police 9 px, champs 29 px, 5 champs par ligne d'expérience | idem | champs minuscules |
| Convocation, entretien, recrutement | modales JS | update, create | pied non fixe | idem | boutons hors écran |
| Chargement, erreur, vide | texte `.empty` | — | pas de composant, pas de reprise | idem | idem |

## Ce qui change

- **Feuille commune `app/static/recruitment-v6.css`** : composants `.rec-page-header`,
  `.rec-page-actions`, `.rec-tabs`, `.rec-chips`, `.rec-filters`, `.rec-table`, `.rec-card-grid`,
  `.rec-card`, `.rec-empty-state`, `.rec-skeleton-list`, boutons, champs, badges et modales. Le
  tableau de bord V5 garde sa feuille ; les deux partagent jetons et shell.
- **En-tête de page standard** : titre, sous-titre, une seule action primaire à droite ; Importer
  Excel et Actualiser en actions secondaires. « Ajouter un candidat » n'est plus dans les filtres.
- **Candidatures** : onglets d'état en navigation secondaire, chips d'avis avec compteurs, chips de
  poste affichées seulement s'il y a des données, barre de filtres en grille, tableau
  Candidat · Poste · Société · Téléphone · Statut · Date · Avis · Actions.
- **Réserve / Recrutés / Archives** : même écran, titre et état vide propres ; date d'entrée en
  réserve affichée quand elle existe (`fichePositionValideeAt`). Aucun statut inventé.
- **Entretiens** : compteurs par état servant de filtres, date et heure en tête de ligne, lieu,
  note, avis ; aucune action sans droit `update`.
- **Annonces** : grille de cartes (société, lieu, postes, publication, date limite, référence,
  statut). Pas de compteur de candidatures : la relation n'existe pas dans les données.
- **Formulaires et modales** : champs 38 px / 13 px, deux colonnes au plus, une colonne sur mobile,
  champs d'expérience libellés, en-tête et pied de modale toujours visibles, presque plein écran
  sur mobile (marges 12 px).
- **États** : squelette de chargement, composant d'erreur avec « Réessayer », états vides compacts
  et contextuels (bouton d'ajout seulement avec le droit `create`).
- **Recherche** : la recherche du header est masquée sur Candidatures (un seul champ par écran).

## Responsive

| Largeur | Shell | Listes |
|---|---|---|
| 1600 / 1440 | sidebar 210 px | tableau complet |
| 1280 | sidebar 185 px | tableau complet, Convoquer / Entretien dans le menu ⋮ (< 1500 px) |
| 1024 / 768 | sidebar 185 px, puis navigation horizontale ≤ 800 px | colonnes secondaires repliées dans une deuxième ligne (601–1199 px) |
| 430 / 390 | header compact, identité société conservée | une card par candidat / entretien, tri en chips |

Seuls défilements horizontaux : onglets, chips, navigation mobile, tri mobile (tous locaux).

## Contrôles

- `tests_frontend/recrute.test.js` : un test par écran (structure, permissions, états vides,
  erreurs, réponses tardives, société active) en plus des tests V5 existants, tous conservés.
- `npm run test:recruitment-responsive-chrome` (Chrome réel, fixtures isolées dans le test) :
  7 écrans × 7 largeurs, données nombreuses puis vides — `scrollWidth <= clientWidth`, aucun
  élément hors écran, aucune collision d'actions / filtres / header, aucun tableau en défilement
  horizontal, cards ≤ 600 px, états vides ≤ 220 px, pagination ; scénario de stabilité de 15 s
  (filtre, société, retour, fiche, erreur API) ; lecture seule sans aucune action d'écriture.
  Captures : `RECRUTE_SCREENSHOT_DIR=<dossier>`.

## Limites connues

- Les compteurs des onglets non visités restent à 0 jusqu'à leur premier chargement (comportement
  existant, non modifié).
- La vue « Contrat à établir » (`contractView`) n'est plus atteignable depuis la navigation depuis
  la suppression de l'onglet Contrat ; elle n'a pas été touchée.
