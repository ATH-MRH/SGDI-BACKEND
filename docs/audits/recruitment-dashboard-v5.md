# Recrutement V5 — audit et validation du 4 octobre 2026

## État Git avant modification

`git fetch origin` exécuté avec succès. Aucun push ni déploiement.

- Branche initiale : `backup/local-work-20260920`.
- HEAD initial : `53eea932764c1e29134922099b5a404aba405d19`.
- `origin/main` après fetch : `b7e3716557942d7cfd04da7ad8d74a5e451ad1bf`.
- Divergence `origin/main...HEAD` : `349 2`.
- Modifications préexistantes : `app/static/sgdi-app.css`, `app/static/sgdi-app.js`, laissées intactes.
- Worktree créé depuis ce `origin/main` : `.worktrees/recruitment-dashboard-v5`.
- Branche : `refactor/recruitment-dashboard-v5`.

## Sources auditées avant codage

| Élément | Source existante |
| --- | --- |
| Route | Hôte `recrute.irongs.com`, racine `/`, routage serveur dans `app/main.py` |
| Renderer/module | Application autonome `app/static/recrute.html`; `showRecruitSection`, `renderRecruitDashboard`, `renderRecruitInterviews`, `renderRecruitAnnouncements` |
| CSS | Styles locaux, baseline responsive, login partagé, `design-system/atlas.css` et ses adaptateurs |
| API candidats | `GET /api/drh/candidates/page`, pagination maximum 100, filtres société/poste/avis et tri date |
| Services | `app/modules/drh/routes.py`, `app/modules/drh/service.py`, modèle `Candidate` |
| Session/permissions | `GET /api/auth/me`: `recruitment_access`, `authorized_actions`; garde recrutement et contrôle actions du serveur |
| Candidats | `Candidate`, champs `last_name`, `first_name`, `desired_position`, `society`, `created_at`, `status`, `data` |
| Entretiens | `data.derniereConvocation`: date/heure/lieu; `data.dernierEntretien`: compte rendu, validation et note |
| Avis | `data.avisDecision`, `avisDate`, `avisRecruteur`, `avisCommentaire` |
| Annonces | `getRecruitAnnouncements`, stockage local existant; statuts Brouillon/Publiée/Clôturée |
| Sources | `Candidate.data.source`, champ existant de la fiche/import; catégories libres enregistrées |
| Logo | Asset officiel `/static/iron-securite-logo.png` |

Audit Chrome du site réel : dashboard actuel avec zéro candidat/entretien/annonce dans la société sélectionnée. Aucune écriture en production.

Navigation existante conservée : dashboard, candidatures, entretiens, annonces, réserve, recrutés, archives. Aucune fonction Rapports identifiée dans cette application.

Le service conserve un vivier partagé : les nouvelles fiches peuvent être sans société jusqu'à l'affectation au recrutement. Le nouveau dashboard applique la société active aux données affectées. La vue Candidatures conserve son filtre existant « Toutes les sociétés / Non affectés » pour accéder au vivier partagé.

## Implémentation

- Sidebar marine, logo officiel, navigation active unique, header blanc et session issue de `/me`.
- Recherche limitée explicitement aux candidats, reliée à la recherche existante.
- Cinq KPI réels : total, présélection selon avis renseigné, convocations à venir non finalisées, réserve canonique, recrutement effectif.
- Pipeline de lecture dérivé des données existantes : nouvelles, avis renseigné/présélection, convoqués, entretiens, transmis DRH, recrutés. Priorités exclusives; réserve et archives restent dans leurs vues existantes.
- Transmission `a_contractualiser` distinguée du recrutement effectif; aucun nouveau statut ni workflow persistant.
- Trois cartes maximum par étape, navigation vers la vue existante du groupe avec société et poste. Le service ne dispose pas de filtre pour ces étapes dérivées : les liens ouvrent le groupe existant, conformément au repli demandé.
- Pagination complète, sans plafond silencieux à 100 dossiers et sans appel par carte. Cache séparé du dashboard.
- Garde de génération locale, société et section avant chaque publication d'une réponse; invalidation sur navigation, changement société et déconnexion.
- Entretiens : pagination complète, société et gardes équivalentes.
- Actions de création/import et modification visibles uniquement avec droits explicites. Absence de droits = refus. Annonces utilisent les droits de l'application recrutement, sans permission inventée.
- Sources : catégories réellement enregistrées, dénominateur « sources renseignées » explicite; panneau absent sans source.
- Annonces : aucune synchronisation serveur inventée; mention du stockage sur ce navigateur. Pas de compteur candidat/annonce sans relation enregistrée.
- Actions Excel et Actualiser accessibles dans « Actions ». Aucune tendance historique, notification, citation ou image décorative inventée.
- Styles V5 limités à `data-recruitment-ui="v5"`; le thème partagé conserve sa position de dernière feuille de style.

Backend, migration, routeur partagé, `load-app.js`, navigation generation : aucun changement.

## Contrôles

Tests exécutables dans `tests_frontend/recrute.test.js` : zéro donnée, pagination sur plusieurs pages, étapes exclusives, recrutés distincts des transmissions, ordre récent, entretiens, deux sociétés, annonces locales, droits, panne API, réponse obsolète, sources et stabilité au refresh.

Chrome réel, prévisualisation QA localhost avec fixtures isolées hors produit :

| Largeur | Largeur document | KPI | Pipeline |
| --- | --- | --- | --- |
| 390 | 390 | 2 colonnes | Défilement local |
| 430 | 430 | 2 colonnes | Défilement local |
| 768 | 768 | 2 colonnes | Défilement local |
| 1024 | 1024 | 3 + 2 | Défilement local |
| 1280 | 1280 | 5 colonnes | Défilement local |
| 1440 | 1440 | 5 colonnes | 6 étapes visibles |
| 1600 | 1600 | 5 colonnes | 6 étapes visibles |

État vide contrôlé visuellement; changement de société, recherche, filtre poste, retour au dashboard et actualisation contrôlés par les commandes UI Chrome. Aucune donnée fictive ajoutée aux fichiers produit, au stockage production ou à la base.

- Recrutement + design system : 17 tests réussis (incluant les actions des lignes en lecture seule).
- Recrutement + module races + module campaign : 60 tests réussis.
- Analyse syntaxique des scripts inline et `git diff --check` réussis.

Suite frontend complète : 919 tests réussis avant le dernier ajout du test lecture seule; contrôles ciblés finaux : 17/17. Stabilité Chrome : contenu du dashboard inchangé après 90 secondes, une seule entrée active, aucune erreur ou alerte console observée.
