# Roadmap de reconstruction — Frontend SGDI/ATLAS

> Migration **strangler** (ancien + nouveau coexistent, bascule module par module derrière le même backend).
> 143 écrans · 273 endpoints · 3 frontends. Ordre issu de la passe 1, enrichi des dépendances.

## Principe de chaque phase
`reconstruire (fiche d'inventaire) → vérifier la parité (agents adversariaux : mêmes champs/calculs/résultat) → tests → bascule`.

## Phase 0 — Fondation (préalable, aucun écran métier)
- Scaffold Vite + Vue 3, monorepo (apps/admin, apps/portail-mobile, packages/shared)
- Client API typé (Bearer, 401→login), design system + composants de base
- Auth/session/routing (hash, URLs conservées), garde de route + garde d'édition, écran de chargement
- **Couche d'autorisation serveur** (rôle × niveau × société) — chantier backend transverse, prioritaire

## Phase 1 — Infrastructure d'abord  (5 écrans)
- Écrans : 5 (dont 2 avec écriture snapshot à recâbler en REST)
- Écrans clés : `ERP Ruban compteurs (bandeau KPI h`, `Bouton d'actualisation manuelle du`, `Barre de chargement de données (ba`, `Bannière de mise à jour d'applicat`, `Messagerie / dialogue interne (wid`

## Phase 2 — Auth & session + Portails (login, select-societe, societe-portal, admin-system)  (2 écrans)
- Écrans : 2 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Login (Connexion ATLAS)`, `Sélection société (Portail ATLAS)`

## Phase 3 — Incidents/Main courante  (4 écrans)
- Écrans : 4 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Main courante — Tableau de bord`, `Main courante — Évènements site`, `Main courante — Évènements autres`, `Modal — Nouvel évènement (Main cou`

## Phase 4 — Recrutement & candidats  (5 écrans)
- Écrans : 5 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Nouvelles candidatures (onglet "ne`, `Candidats en réserve (liste + acti`, `Candidats archivés (onglet "Archiv`, `Fiche candidat (dossier) — formula`, `Réception demandes & réclamations `

## Phase 5 — Effectif & agents  (7 écrans)
- Écrans : 7 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Récapitulatif / Liste des effectif`, `Éléments sortants (ÉLÉMENTS SORTAN`, `Préparation opérationnelle (Employ`, `Cartes KPI DRH — Tableau de bord D`, `Droits acquis congés (DRH) — écran`, `Tableau de bord (Accueil) — render`, `Situation générale — Groupe (table`

## Phase 6 — Contrats + Congés & fiches  (11 écrans)
- Écrans : 11 (dont 4 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Tableau de bord CONTRAT (module DR`, `Situation contrat (personnel) — li`, `À contractualiser (Contrats > Cand`, `Nouveau contrat / Contractualisati`, `Avenants au contrat (Contrats > Av`, `Nouveau contrat direct (pont) — pa`, `Blocage "PostgreSQL obligatoire" —`, `Situation des congés` …

## Phase 7 — Sites & pointage  (14 écrans)
- Écrans : 14 (dont 5 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Sites — Tableau de bord`, `Sites — Fiche technique / Création`, `Pointage — Tableau de bord (render`, `Pointage — Feuille de présence quo`, `Pointage — Saisie manuelle (grille`, `Pointage — Saisie automatique (ong`, `Pointage — Récap par agent (récapi`, `Pointage — Récap par société (ongl` …

## Phase 8 — Matériel & équipement  (20 écrans)
- Écrans : 20 (dont 5 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Tableau de bord matériel (MATÉRIEL`, `Inventaire général (module Matérie`, `Catalogue / Articles (liste du cat`, `Fiche article (détail) — Matériel `, `Formulaire article (Nouvel article`, `Magasins (liste) — Module Matériel`, `Magasin (détail) — fiche d'un maga`, `Formulaire magasin (Nouveau / Modi` …
- ⚠️ **Risques critiques à corriger ici :**
  - `Mouvements de stock (Matériel → Mouvements)` — logique métier côté client à corriger/migrer (voir SPEC)
  - `Stats stock pro — "Matériel & Équipement › Statist` — logique métier côté client à corriger/migrer (voir SPEC)
  - `Entrée/Sortie stock (modaux) — une seule modale pa` — logique métier côté client à corriger/migrer (voir SPEC)

## Phase 9 — Paie  (14 écrans)
- Écrans : 14 (dont 5 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Sites — Tableau de bord`, `Sites — Fiche technique / Création`, `Pointage — Tableau de bord (render`, `Pointage — Feuille de présence quo`, `Pointage — Saisie manuelle (grille`, `Pointage — Saisie automatique (ong`, `Pointage — Récap par agent (récapi`, `Pointage — Récap par société (ongl` …

## Phase 10 — Commercial  (11 écrans)
- Écrans : 11 (dont 5 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Commercial — Tableau de bord`, `Commercial — Calendrier (titre aff`, `Commercial — Prospects (liste + cr`, `Commercial — Clients (liste)`, `Client — Fiche/éditeur (openClient`, `Commercial — Opportunités (pipelin`, `Commercial — Visites / Suivi (titr`, `Commercial — Devis (liste + éditeu` …

## Phase 11 — Facturation/Finances  (5 écrans)
- Écrans : 5 (dont 2 avec écriture snapshot à recâbler en REST)
- Écrans clés : `ERP Ruban compteurs (bandeau KPI h`, `Bouton d'actualisation manuelle du`, `Barre de chargement de données (ba`, `Bannière de mise à jour d'applicat`, `Messagerie / dialogue interne (wid`

## Phase 12 — Portail RH & Web Push  (2 écrans)
- Écrans : 2 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Login (Connexion ATLAS)`, `Sélection société (Portail ATLAS)`

## Phase 13 — Administration  (4 écrans)
- Écrans : 4 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Main courante — Tableau de bord`, `Main courante — Évènements site`, `Main courante — Évènements autres`, `Modal — Nouvel évènement (Main cou`

## Phase 14 — Décommissionnement final  (5 écrans)
- Écrans : 5 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Nouvelles candidatures (onglet "ne`, `Candidats en réserve (liste + acti`, `Candidats archivés (onglet "Archiv`, `Fiche candidat (dossier) — formula`, `Réception demandes & réclamations `

## Backend transverse (en parallèle des phases)
- Autorisation serveur réelle sur toutes les écritures (rôle/niveau/société)
- Séquences atomiques de numérotation (facture/devis/avoir/matricule)
- Calculs serveur : paie (IRG/CNAS…), stock, TVA/TTC/remise, KPI dashboards
- Endpoints à créer : `POST /api/auth/otp/send`, `POST /api/auth/otp/verify`, `POST /api/auth/email/confirm`, `POST /api/auth/password/forgot`, `POST /api/auth/password/reset`, `POST|PUT /api/drh/amendments (avenants)`, `GET /api/dashboard/summary (KPI accueil, NOUVEAU)`, `GET /api/dashboard/global (KPI groupe, NOUVEAU)`, `GET /api/drh/leaves (existe, NON consommé - à câbler)`
- SSE événements granulaires + Web Push (compléter handlers SW)

## Décommissionnement final
- Supprimer snapshot global `db`, `hydrateDB`, `sgdiBackendSave`, auto-refresh/SSE global, code mort (§6 consolidated)
