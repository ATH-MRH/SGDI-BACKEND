# Roadmap de reconstruction — Frontend SGDI/ATLAS

> Migration **strangler** (ancien + nouveau coexistent, bascule module par module derrière le même backend).
> 208 écrans · 273 endpoints · 3 frontends. Ordre issu de la passe 1, enrichi des dépendances.

## Principe de chaque phase
`reconstruire (fiche d'inventaire) → vérifier la parité (agents adversariaux : mêmes champs/calculs/résultat) → tests → bascule`.

## Phase 0 — Fondation (préalable, aucun écran métier)
- Scaffold Vite + Vue 3, monorepo (apps/admin, apps/portail-mobile, packages/shared)
- Client API typé (Bearer, 401→login), design system + composants de base
- Auth/session/routing (hash, URLs conservées), garde de route + garde d'édition, écran de chargement
- **Couche d'autorisation serveur** (rôle × niveau × société) — chantier backend transverse, prioritaire

## Phase 1 — Infrastructure d'abord  (6 écrans)
- Écrans : 6 (dont 3 avec écriture snapshot à recâbler en REST)
- Écrans clés : `ERP Ruban compteurs (bandeau KPI h`, `Bouton d'actualisation manuelle du`, `Barre de chargement de données (ba`, `Bannière de mise à jour d'applicat`, `Messagerie / dialogue interne (wid`, `Moteur i18n bilingue FR/AR (transv`

## Phase 2 — Auth & session + Portails (login, select-societe, societe-portal, admin-system)  (2 écrans)
- Écrans : 2 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Login (Connexion ATLAS)`, `Sélection société (Portail ATLAS)`

## Phase 3 — Incidents/Main courante  (9 écrans)
- Écrans : 9 (dont 3 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Main courante — Tableau de bord`, `Main courante — Évènements site`, `Main courante — Évènements autres`, `Modal — Nouvel évènement (Main cou`, `Tableau de bord Secrétariat`, `Courriers (liste)`, `Notes internes (liste)`, `Archives (liste)` …
- ⚠️ **Risques critiques à corriger ici :**
  - `Notes internes (liste)` — 
  - `Archives (liste)` — 

## Phase 4 — Recrutement & candidats  (7 écrans)
- Écrans : 7 (dont 3 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Nouvelles candidatures (onglet "ne`, `Candidats en réserve (liste + acti`, `Candidats archivés (onglet "Archiv`, `Fiche candidat (dossier) — formula`, `Réception demandes & réclamations `, `Demande structure — Tableau de bor`, `Demande structure — Réception / En`
- ⚠️ **Risques critiques à corriger ici :**
  - `Demande structure — Réception / Envoi (liste)` — 

## Phase 5 — Effectif & agents  (20 écrans)
- Écrans : 20 (dont 8 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Récapitulatif / Liste des effectif`, `Éléments sortants (ÉLÉMENTS SORTAN`, `Préparation opérationnelle (Employ`, `Cartes KPI DRH — Tableau de bord D`, `Droits acquis congés (DRH) — écran`, `Tableau de bord (Accueil) — render`, `Situation générale — Groupe (table`, `DRH — Service social (liste CNAS/C` …
- ⚠️ **Risques critiques à corriger ici :**
  - `DRH — Service social (liste CNAS/Chifa)` — 
  - `DRH — Mise en demeure (dotation non reversée, sort` — 
  - `Statistiques RH (tableau multi-graphes)` — 
  - `Documents / Archives (documents archivés par emplo` — 

## Phase 6 — Contrats + Congés & fiches  (12 écrans)
- Écrans : 12 (dont 5 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Tableau de bord CONTRAT (module DR`, `Situation contrat (personnel) — li`, `À contractualiser (Contrats > Cand`, `Nouveau contrat / Contractualisati`, `Avenants au contrat (Contrats > Av`, `Nouveau contrat direct (pont) — pa`, `Blocage "PostgreSQL obligatoire" —`, `Situation des congés` …
- ⚠️ **Risques critiques à corriger ici :**
  - `Dossier administratif (archive des pièces)` — 

## Phase 7 — Sites & pointage  (20 écrans)
- Écrans : 20 (dont 9 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Sites — Tableau de bord`, `Sites — Fiche technique / Création`, `Pointage — Tableau de bord (render`, `Pointage — Feuille de présence quo`, `Pointage — Saisie manuelle (grille`, `Pointage — Saisie automatique (ong`, `Pointage — Récap par agent (récapi`, `Pointage — Récap par société (ongl` …

## Phase 8 — Matériel & équipement  (20 écrans)
- Écrans : 20 (dont 5 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Tableau de bord matériel (MATÉRIEL`, `Inventaire général (module Matérie`, `Catalogue / Articles (liste du cat`, `Fiche article (détail) — Matériel `, `Formulaire article (Nouvel article`, `Magasins (liste) — Module Matériel`, `Magasin (détail) — fiche d'un maga`, `Formulaire magasin (Nouveau / Modi` …
- ⚠️ **Risques critiques à corriger ici :**
  - `Mouvements de stock (Matériel → Mouvements)` — logique métier côté client à corriger/migrer (voir SPEC)
  - `Stats stock pro — "Matériel & Équipement › Statist` — logique métier côté client à corriger/migrer (voir SPEC)
  - `Entrée/Sortie stock (modaux) — une seule modale pa` — logique métier côté client à corriger/migrer (voir SPEC)

## Phase 9 — Paie  (20 écrans)
- Écrans : 20 (dont 9 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Sites — Tableau de bord`, `Sites — Fiche technique / Création`, `Pointage — Tableau de bord (render`, `Pointage — Feuille de présence quo`, `Pointage — Saisie manuelle (grille`, `Pointage — Saisie automatique (ong`, `Pointage — Récap par agent (récapi`, `Pointage — Récap par société (ongl` …

## Phase 10 — Commercial  (11 écrans)
- Écrans : 11 (dont 5 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Commercial — Tableau de bord`, `Commercial — Calendrier (titre aff`, `Commercial — Prospects (liste + cr`, `Commercial — Clients (liste)`, `Client — Fiche/éditeur (openClient`, `Commercial — Opportunités (pipelin`, `Commercial — Visites / Suivi (titr`, `Commercial — Devis (liste + éditeu` …

## Phase 11 — Facturation/Finances  (6 écrans)
- Écrans : 6 (dont 3 avec écriture snapshot à recâbler en REST)
- Écrans clés : `ERP Ruban compteurs (bandeau KPI h`, `Bouton d'actualisation manuelle du`, `Barre de chargement de données (ba`, `Bannière de mise à jour d'applicat`, `Messagerie / dialogue interne (wid`, `Moteur i18n bilingue FR/AR (transv`

## Phase 12 — Portail RH & Web Push  (2 écrans)
- Écrans : 2 (dont 1 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Login (Connexion ATLAS)`, `Sélection société (Portail ATLAS)`

## Phase 13 — Administration  (9 écrans)
- Écrans : 9 (dont 3 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Main courante — Tableau de bord`, `Main courante — Évènements site`, `Main courante — Évènements autres`, `Modal — Nouvel évènement (Main cou`, `Tableau de bord Secrétariat`, `Courriers (liste)`, `Notes internes (liste)`, `Archives (liste)` …
- ⚠️ **Risques critiques à corriger ici :**
  - `Notes internes (liste)` — 
  - `Archives (liste)` — 

## Phase 14 — Décommissionnement final  (7 écrans)
- Écrans : 7 (dont 3 avec écriture snapshot à recâbler en REST)
- Écrans clés : `Nouvelles candidatures (onglet "ne`, `Candidats en réserve (liste + acti`, `Candidats archivés (onglet "Archiv`, `Fiche candidat (dossier) — formula`, `Réception demandes & réclamations `, `Demande structure — Tableau de bor`, `Demande structure — Réception / En`
- ⚠️ **Risques critiques à corriger ici :**
  - `Demande structure — Réception / Envoi (liste)` — 

## Modules rattrapés — à insérer dans les phases ci-dessus

- **07-Paie** (6 écrans) : `Tableau de bord Paie — écran p`, `Dossier salaire employé (Paie `, `Modale « Éléments de paie » (é`, `Modale « Nouvelle grille salar`, `Modale "Nouvelle rubrique de p`, `Aperçu / Impression fiche de p`
- **10-Facturation/Finances** (17 écrans) : `Client — Fiche imprimable (ape`, `Facturation — Tableau de bord`, `Facturation — Clients (lecture`, `Facturation — Factures (liste)`, `Facture — Éditeur (création/mo`, `Facturation — Devis` …
- **11-ERP Compta/Achats/Ventes** (23 écrans) : `ERP Comptabilité (module ATLAS`, `ERP Reporting (ATLAS ERP) — ta`, `ERP Achats (module ATLAS ERP «`, `ERP Ventes (ATLAS ERP — Ventes`, `Comptabilité — Tableau de bord`, `Comptabilité — Plan comptable ` …
- **12-Portail RH & Mobile** (20 écrans) : `Portail société (Company porta`, `Portail RH (vue DRH) — récepti`, `Portail RH personnel (self-ser`, `Comptes Portail RH`, `Module-Portal (portail de sous`, `Portail mobile self-service RH` …
- **13-Administration** (31 écrans) : `Administration système (sous-f`, `Fiche de position employé (age`, `Fiches de position (annuaire) `, `Onglet "Portail RH" (Compte Po`, `Cockpit Direction Générale (ta`, `Panneau administration système` …
- **13b-Rapports** (1 écrans) : `Rapports (synthèse RH)`
- **13c-Paramètres** (2 écrans) : `Paramètres (code de déverrouil`, `Journal de déverrouillage (com`
- **14b-Pages custom** (1 écrans) : `Rubrique personnalisée (page s`

## Backend transverse (en parallèle des phases)
- Autorisation serveur réelle sur toutes les écritures (rôle/niveau/société)
- Séquences atomiques de numérotation (facture/devis/avoir/matricule)
- Calculs serveur : paie (IRG/CNAS…), stock, TVA/TTC/remise, KPI dashboards
- Endpoints à créer : `POST /api/auth/otp/send`, `POST /api/auth/otp/verify`, `POST /api/auth/email/confirm`, `POST /api/auth/password/forgot`, `POST /api/auth/password/reset`, `POST|PUT /api/drh/amendments (avenants)`, `GET /api/dashboard/summary (KPI accueil, NOUVEAU)`, `GET /api/dashboard/global (KPI groupe, NOUVEAU)`, `GET /api/drh/leaves (existe, NON consommé - à câbler)`
- SSE événements granulaires + Web Push (compléter handlers SW)

## Décommissionnement final
- Supprimer snapshot global `db`, `hydrateDB`, `sgdiBackendSave`, auto-refresh/SSE global, code mort (§6 consolidated)
