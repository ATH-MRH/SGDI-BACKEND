# Spec consolidée — Reconstruction Frontend SGDI/ATLAS

> Base fiable et validée pour reconstruction **sans perte fonctionnelle**.
> Issue de la consolidation des 3 passes d'inventaire (~340 agents) + vérification mécanique contre le code réel.
> Détail complet écran par écran : `docs/RECONSTRUCTION-FRONTEND-SPEC.md`. Ce fichier = index fiable + statuts.

## 1. Résolution des compteurs contradictoires

| Chiffre vu | Ce que c'était réellement |
|---|---|
| **145** | Estimation de la passe 1 (par domaine) |
| **163** | Liste d'écrans envoyée aux agents — **gonflée par ~11 doublons ERP-facturation** mal attribués |
| **170** | **Événements du journal cumulés sur 3 reprises** du workflow (relances après limites d'usage) — **compte des invocations d'agents, PAS des écrans** |
| **148** | Fiches écran produites au run final de la passe 3 |
| **143** | Écrans uniques passe 3 (148 − 5 doublons ERP-facturation) |
| **+65** | Écrans **rattrapés** (routes actives de `renderView` jamais couvertes : dossiers, documents, demandes_structure, rapports, parametres, custom, secrétariat, OPS détaillé, sous-vues + stats DRH, portail mobile éclaté, ERP sous-onglets) |
| **208** | **TOTAL ÉCRANS UNIQUES CONFIRMÉS** ✅ |

Endpoints : **110** = estimation passe 1 des endpoints *référencés par le front*. Le vrai total backend est **273** (compté sur les décorateurs), dont classification en §4.

## 2. Légende des statuts

| Statut | Signification |
|---|---|
| **Confirmé** | Écran vérifié dans le code (fonction de rendu existe), lecture seule ou re-plomberie REST simple |
| **Backend requis** | Écrit via le snapshot global (`PUT /irongs/db` ou `/collections`) → nécessite de vraies mutations REST + logique serveur |
| **Risque critique** | Bug métier confirmé à corriger (ne PAS reproduire) — voir §7 |
| **Doublon** | Même écran inventorié 2× (ERP-facturation) — fusionné |
| **À vérifier** | Fonction de rendu introuvable — **0 cas** (169/169 fonctions de rendu distinctes vérifiées dans le code ; 9 vues portail sans fonction `render*` dédiée vérifiées par ailleurs) |

**Répartition (208 écrans) :** Confirmé : 112 · Backend requis : 82 · Risque critique : 14

## 3. Index des écrans par module

### 00-Auth & Portails  (2 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Login (Connexion ATLAS) | `#/login` | `renderLogin` | Confirmé | — |
| Sélection société (Portail ATLAS) | `#/select-societe` | `renderSocieteSelector` | Backend requis | ⚠️ oui |

### 01-Effectif & Agents  (5 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Cartes KPI DRH — Tableau de bord DRH « Synthèse générale » | `#/drh/dashboard (aussi #/drh sans sous-route, et` | `renderDRHDashboard` | Confirmé | — |
| Droits acquis congés (DRH) — écran « CONGÉS » du portail DRH | `#/drh/conges  (router: switch(root) case "drh" →` | `renderDRHCongesPersonnel` | Confirmé | — |
| Préparation opérationnelle (Employés non opérationnels + étapes bloqua | `#/effectif/preparation — dispatché par renderVie` | `renderOperationalPreparation` | Confirmé | — |
| Récapitulatif / Liste des effectifs (GRH — Gestion des effectifs) | `#/effectif (alias #/effectif/recap et #/effectif` | `renderEffectif` | Backend requis | ⚠️ oui |
| Éléments sortants (ÉLÉMENTS SORTANTS) — liste en lecture seule des emp | `#/effectif/sortants (dispatch : sgdi-app.js:6875` | `renderElementsSortants` | Confirmé | — |

### 01b-Tableaux de bord  (2 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Situation générale — Groupe (tableau de bord consolidé multi-sociétés, | `#/global-dashboard` | `renderGlobalDashboard` | Confirmé | — |
| Tableau de bord (Accueil) — renderDashboard | `#/dashboard (default route; also fallback for un` | `renderDashboard` | Confirmé | — |

### 01c-DRH sous-vues  (12 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| DRH — Mise en demeure (dotation non reversée, sortants) | `#/drh/mise_en_demeure` | `renderDRHMiseEnDemeure` | Risque critique | ⚠️ oui |
| DRH — Période d'essai | `#/drh/essai` | `renderDRHPeriodeEssai` | Backend requis | ⚠️ oui |
| DRH — Reversements en attente (dotation) | `#/drh/reversement` | `renderDRHReversementEnAttente` | Backend requis | ⚠️ oui |
| DRH — Service social (liste CNAS/Chifa) | `#/drh/social` | `renderDRHSocial` | Risque critique | ⚠️ oui |
| DRH — Service social, fiche agent (détail) | `#/drh/social/{id}` | `renderDRHSocialAgent` | Backend requis | ⚠️ oui |
| Statistiques RH (tableau multi-graphes) | `#/drh/stats` | `renderDRHStats` | Risque critique | ⚠️ oui |
| Statistiques par affectation (sites) | `#/drh/stats_affectation` | `renderDRHStatsAffectation` | Confirmé | — |
| Statistiques par catégorie | `#/drh/stats_categorie` | `renderDRHStatsCategorie` | Confirmé | — |
| Statistiques par fonction | `#/drh/stats_fonction` | `renderDRHStatsFonction` | Confirmé | — |
| Statistiques par salaire | `#/drh/stats_salaire` | `renderDRHStatsSalaire` | Confirmé | — |
| Statistiques par société (tableau) | `#/drh/stats_societe` | `renderDRHStatsSociete` | Confirmé | — |
| Statistiques par thème | `#/drh/stats_theme` | `renderDRHStatsTheme` | Confirmé | — |

### 02-Recrutement  (5 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Candidats archivés (onglet "Archives" du hub Recrutement / Candidats) | `#/candidats_archives (liste) — #/candidats_archi` | `renderRecrutement` | Confirmé | — |
| Candidats en réserve (liste + actions) — onglet "Réserve" du module Re | `#/reserve  (dispatch ligne 8863 du switch de ren` | `renderRecrutement` | Confirmé | — |
| Fiche candidat (dossier) — formulaire de dossier candidat en 2 étapes  | `#/recrutement/{id} (alias exacts : #/reserve/{id` | `renderCandidatForm` | Confirmé | — |
| Nouvelles candidatures (onglet "new" de l'écran unifié Recrutement / C | `#/recrutement (alias équivalents : #/recrutement` | `renderRecrutement` | Confirmé | — |
| Réception demandes & réclamations (Demandes Personnel — Portail RH) | `#/demandes_personnel/dashboard (alias sub-route ` | `renderDemandesPersonnel` | Backend requis | ⚠️ oui |

### 02-Recrutement & Demandes  (2 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Demande structure — Réception / Envoi (liste) | `#/demandes_structure/reception` | `renderDemandesStructure` | Risque critique | ⚠️ oui |
| Demande structure — Tableau de bord | `#/demandes_structure` | `renderDemandesStructureDashboard` | Backend requis | ⚠️ oui |

### 03-Contrats  (6 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Avenants au contrat (Contrats > Avenants) | `#/contrats/avenants — dispatché dans le routeur ` | `renderAvenants` | Confirmé | — |
| Nouveau contrat / Contractualisation (NOUVEAU CONTRAT APS) — création  | `#/contrats/nouveau/{candidatId} — routeur ligne ` | `renderContractualisation` | Backend requis | ⚠️ oui |
| Nouveau contrat direct (pont) — page relais #/contrats/nouveau_contrat | `#/contrats/nouveau_contrat (dispatch: sgdi-app.j` | `renderNouveauContratDirect` | Confirmé | — |
| Situation contrat (personnel) — liste analytique des contrats de trava | `#/contrats/situation (alias : #/contrats/clients` | `renderContrats` | Confirmé | — |
| Tableau de bord CONTRAT (module DRH) — 5 groupes de métriques cliquabl | `#/contrats/dashboard (routeur: case "contrats" →` | `renderContratsDashboard` | Confirmé | — |
| À contractualiser (Contrats > Candidats retenus / Instance de signatur | `#/contrats/a_contractualiser — dispatché dans le` | `renderContrats` | Backend requis | ⚠️ oui |

### 04-Congés & Fiches  (6 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Blocage "PostgreSQL obligatoire" — écran de garde plein écran (interst | `Pas de route hash dédiée : c'est un intercepteur` | `renderPostgresRequired` | Backend requis | ⚠️ oui |
| Création de badge (module Badges personnel, DRH) | `#/fiches/badge (alias: #/badge → renderFiches(vi` | `renderBadgeModule` | Confirmé | — |
| Dossier administratif (archive des pièces) | `#/dossiers` | `renderDossiers` | Risque critique | ⚠️ oui |
| Impression en lot des fiches de position — écran DRH permettant de coc | `#/fiches/imprimer — dispatché par renderView() (` | `renderFichesImpression` | Confirmé | — |
| Situation des congés | `#/conges (dispatch: `case"conges":renderConges(v` | `renderConges` | Backend requis | ⚠️ oui |
| Vérification publique de badge (page publique plein écran affichée au  | `#/badge/verify/:id — :id = référence employé, ac` | `renderBadgeVerify` | Confirmé | — |

### 04b-Documents/Archives  (1 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Documents / Archives (documents archivés par employé) | `#/documents` | `renderDocumentsArchives` | Risque critique | ⚠️ oui |

### 05-Incidents/Main courante  (4 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Main courante — Tableau de bord | `#/incidents/dashboard (router: `case"incidents":` | `renderMainCouranteDashboard` | Confirmé | — |
| Main courante — Évènements autres | `#/incidents/autres (dispatch: `case"incidents":r` | `renderIncidents` | Confirmé | — |
| Main courante — Évènements site | `#/incidents/site (dispatch: `case"incidents":ren` | `renderIncidents` | Confirmé | — |
| Modal — Nouvel évènement (Main courante / Incidents) | `Modale ouverte par openIncidentModal(mode) (l.17` | `openIncidentModal` | Backend requis | ⚠️ oui |

### 05b-Secrétariat  (5 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Archives (liste) | `#/secretariat/archives` | `renderSecretariat` | Risque critique | — |
| Courriers (liste) | `#/secretariat/courriers` | `renderSecretariat` | Confirmé | — |
| Modal Nouveau courrier (création) | `#/secretariat/dashboard` | `openSecretariatCourrierModal` | Backend requis | ⚠️ oui |
| Notes internes (liste) | `#/secretariat/notes` | `renderSecretariat` | Risque critique | — |
| Tableau de bord Secrétariat | `#/secretariat/dashboard` | `renderSecretariat` | Backend requis | ⚠️ oui |

### 06-Sites & Pointage  (14 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Encart évènements fiche Site (bloc "Main courante" — siteEvenementsHTM | `app/static/sgdi-app.js l.16413 `siteEvenementsHT` | `siteEvenementsHTML` | Backend requis | ⚠️ oui |
| Modal — Détail évènement (Main courante) | `viewIncident(id) — app/static/sgdi-app.js l.1743` | `viewIncident` | Confirmé | — |
| Pointage — Archives (ARCHIVES POINTAGE) — écran de consultation 100% l | `#/pointage/archives` | `renderPointageArchives` | Confirmé | — |
| Pointage — Feuille de présence quotidienne (FPQ) | `#/pointage/feuille (alias: #/pointage/scan est r` | `renderFeuillePresentQR` | Backend requis | ⚠️ oui |
| Pointage — Légende & codes (onglet "🎨 Légende & codes" du module Point | `#/pointage/legende — dispatché par route() (sgdi` | `renderPointageLegende` | Confirmé | — |
| Pointage — QR par site (mur de QR codes de présence, un QR par site ac | `#/pointage/qr (onglet "qr" de POINTAGE_TABS, lig` | `renderPointageQRGen` | Backend requis | ⚠️ oui |
| Pointage — Récap par agent (récapitulatif mensuel jour par jour d'un a | `#/pointage/recap  et  #/pointage/recap/{agentId}` | `renderPointageRecap` | Confirmé | — |
| Pointage — Récap par société (onglet "🏢 Récap par société" du module P | `#/pointage/societe — dispatché par renderPointag` | `renderPointageSociete` | Confirmé | — |
| Pointage — Saisie automatique (onglet "🤖 Saisie automatique" du module | `#/pointage/auto — dispatché par renderPointage(v` | `renderPointageSaisieAuto` | Backend requis | ⚠️ oui |
| Pointage — Saisie manuelle (grille mensuelle de pointage, 1 ligne par  | `#/pointage/saisie — dispatché par renderPointage` | `renderPointageSaisie` | Confirmé | — |
| Pointage — Statistiques (onglet "📈 STATISTIQUES" du module Pointage) | `#/pointage/stats — dispatch: route() → renderPoi` | `renderPointageStats` | Confirmé | — |
| Pointage — Tableau de bord (renderPointageDashboard) | `#/pointage/dashboard — dispatché par le routeur ` | `renderPointageDashboard` | Backend requis | ⚠️ oui |
| Sites — Fiche technique / Création de site | `#/sites/nouveau (création, id=null) — même fonct` | `renderSiteForm` | Confirmé | — |
| Sites — Tableau de bord | `#/sites (et alias #/sites/actifs — le menu point` | `renderSites` | Confirmé | — |

### 06b-OPS  (6 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| OPS — Employés en instance de dotation (suivi) | `#/ops/instance_dotation` | `renderOpsInstanceDotation` | Confirmé | — |
| OPS — Missions (ordres de mission) | `#/ops/missions` | `renderOpsMissions` | Backend requis | ⚠️ oui |
| OPS — Mouvements (ordres de mouvement) | `#/ops/mouvements` | `renderOpsMouvements` | Backend requis | ⚠️ oui |
| OPS — QR Présence (générateur QR par site) | `#/ops/qr` | `renderOPS` | Confirmé | — |
| OPS — Supervision site (inspections) | `#/ops/supervision` | `renderOpsSupervision` | Backend requis | ⚠️ oui |
| OPS — Tableau de bord | `#/ops/dashboard` | `renderOPS` | Backend requis | ⚠️ oui |

### 07-Paie  (6 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Aperçu / Impression fiche de paie (bulletin de paie SGDI) — document e | `Pas de route dédiée : overlay (modale) sans hash` | `paieFicheHTML` | Backend requis | ⚠️ oui |
| Dossier salaire employé (Paie / fiche salariale d'un employé) | `#/paie/agent/:id — dispatché par renderView() (s` | `renderPaieAgent` | Confirmé | — |
| Modale "Nouvelle rubrique de paie" (openPaieRubriqueModal) — création  | `#/paie/dashboard → <details> "Rubriques de paie ` | `openPaieRubriqueModal` | Backend requis | ⚠️ oui |
| Modale « Nouvelle grille salariale par fonction » (Grille salariale) — | `Ouverte depuis la vue `paie/dashboard` (renderPa` | `openPaieGrilleModal` | Backend requis | ⚠️ oui |
| Modale « Éléments de paie » (éléments variables du mois pour un employ | `Pas une route hash : modale ouverte via onclick ` | `openPaieElementsModal` | Backend requis | ⚠️ oui |
| Tableau de bord Paie — écran principal du module Paie (calcul paie Alg | `#/paie/dashboard — routeur ligne 6899 : case "pa` | `renderPaie` | Backend requis | ⚠️ oui |

### 08-Matériel  (20 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Alertes stock (Matériel &gt; Alertes) | `#/materiel/alertes — dispatché par renderMaterie` | `renderMatSimpleAlertesServer` | Confirmé | — |
| Article legacy unitaire — formulaire de création/édition d'un article  | `#/materiel/nouveau (création) — variante d'éditi` | `renderMaterielForm` | Backend requis | ⚠️ oui |
| Catalogue / Articles (liste du catalogue materiel) | `#/materiel/articles (alias #/materiel/catalogue)` | `renderMatSimpleArticles` | Confirmé | — |
| Entrée/Sortie stock (modaux) — une seule modale paramétrée par `type`  | `#/materiel/entree-stock (sub==='entree-stock' ->` | `openModal` | Risque critique | — |
| Fiche article (détail) — Matériel / Stock | `#/materiel/article/:id  (dispatch: `if(sub==="ar` | `renderStockArticleDetail` | Confirmé | — |
| Fiches de position (contexte matériel) | `#/materiel/fiches — dispatch: router `case"mater` | `renderFiches` | Confirmé | — |
| Formulaire article (Nouvel article au catalogue / Modifier l'article)  | `#/materiel/article-nouveau (création) et #/mater` | `renderStockArticleForm` | Backend requis | ⚠️ oui |
| Formulaire fournisseur (Nouveau / Modifier) — module Matériel | `#/materiel/fournisseur-nouveau (création, id=nul` | `renderMatSimpleFournisseurForm` | Backend requis | ⚠️ oui |
| Formulaire magasin (Nouveau / Modifier magasin) — création/édition d'u | `#/materiel/magasin-nouveau (création, id=null) e` | `renderMatSimpleMagasinForm` | Backend requis | ⚠️ oui |
| Fournisseur (détail) — vue lecture seule d'un partenaire achats matéri | `#/materiel/fournisseur/:id` | `renderMatSimpleFournisseurDetail` | Confirmé | — |
| Fournisseurs (liste) — module Materiel/Equipement | `#/materiel/fournisseurs (dispatch au routeur lig` | `renderMatSimpleFournisseurs` | Confirmé | — |
| Inventaire général (module Matériel — vue stock consolidée tous magasi | `#/materiel/inventaire — dispatch: `case"materiel` | `renderMatSimpleInventaire` | Confirmé | — |
| Magasin (détail) — fiche d'un magasin/lieu de stockage du module Matér | `#/materiel/magasin/:id  (dispatch dans renderMat` | `renderMatSimpleMagasinDetail` | Confirmé | — |
| Magasins (liste) — Module Matériel & Équipement | `#/materiel/magasins (dispatch: router `case "mat` | `renderMatSimpleMagasins` | Confirmé | — |
| Mouvements de stock (Matériel → Mouvements) | `#/materiel/mouvements — dispatché par renderMate` | `renderMatSimpleMouvements` | Risque critique | — |
| Nouvelle dotation (Dotation matériel employé / site / structure) | `#/materiel/dotation` | `renderMatSimpleDotation` | Confirmé | — |
| Reversement — "ÉQUIPEMENT / MATÉRIEL EN INSTANCE DE REVERSEMENT" (modu | `#/materiel/reversement — dispatché dans le route` | `renderMatSimpleReversement` | Confirmé | — |
| SITE EN ATTENTE DE DOTATION (Sites actifs sans dotation matériel enreg | `#/materiel/sites-dotation — dispatché dans le ro` | `renderMatSitesEnAttenteDotation` | Confirmé | — |
| Stats stock pro — "Matériel & Équipement › Statistiques" (onglet Stati | `#/materiel/stats (alias exact: #/materiel/statis` | `renderStockProMain` | Risque critique | ⚠️ oui |
| Tableau de bord matériel (MATÉRIEL — Tableau de bord) | `#/materiel/dashboard (alias : #/materiel sans so` | `renderMatSimpleDashboard` | Confirmé | — |

### 09-Commercial  (11 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Client — Fiche/éditeur (openClientModal) — malgré son nom, ce N'EST PA | `openClientModal(id, readOnly) — pas de route has` | `openClientModal` | Confirmé | — |
| Commercial — Calendrier (titre affiché: 'Calendrier Commercial') | `#/commercial/calendrier — routeur ligne 6892: ca` | `renderCommCalendrier` | Backend requis | ⚠️ oui |
| Commercial — Catalogue prestations | `#/commercial/catalogue — dispatché dans renderCo` | `renderCommCatalogue` | Backend requis | ⚠️ oui |
| Commercial — Clients (liste) | `#/commercial/clients — dispatché par renderComme` | `renderCommClients` | Confirmé | — |
| Commercial — Devis (liste + éditeur plein écran + 3 modales outils) | `#/commercial/devis — dispatch: renderCommercial(` | `renderCommDevis` | Backend requis | ⚠️ oui |
| Commercial — Opportunités (pipeline commercial : liste, création, chan | `#/commercial/opportunites — dispatch : renderVie` | `renderCommOpportunites` | Confirmé | — |
| Commercial — Prospects (liste + création + conversion) | `#/commercial/prospects — routeur: renderView() (` | `renderCommProspects` | Confirmé | — |
| Commercial — Statistiques commerciales (📈), read-only analytics dashbo | `#/commercial/stats — parsed in renderView() (sgd` | `renderCommStats` | Confirmé | — |
| Commercial — Tableau de bord | `#/commercial/dashboard (dispatch: renderView() s` | `renderCommDashboard` | Confirmé | — |
| Commercial — Tarification (vue par catégorie, LECTURE SEULE) | `#/commercial/tarifs — dispatché par renderCommer` | `renderCommTarifs` | Backend requis | ⚠️ oui |
| Commercial — Visites / Suivi (titre H1: "📞 Visites / Suivi", sous-titr | `#/commercial/visites — dispatcher `case "commerc` | `renderCommVisites` | Backend requis | ⚠️ oui |

### 10-Facturation/Finances  (17 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Client — Fiche imprimable (aperçu client en pop-up imprimable) | `openClientDetail(id) — pas une route hash. Écran` | `openClientDetail` | Confirmé | — |
| Facturation — Avances clients | `#/facturation/avances (dispatché par renderFactu` | `renderFactAvances` | Backend requis | ⚠️ oui |
| Facturation — Avoirs (liste des notes de crédit émises sur factures) | `#/facturation/avoirs — dispatch: renderFacturati` | `renderFactAvoirs` | Backend requis | ⚠️ oui |
| Facturation — Balance âgée des créances | `#/facturation/balance (router: switch on root "f` | `renderFactBalance` | Backend requis | ⚠️ oui |
| Facturation — Caisse | `#/facturation/caisse (dispatch: renderFacturatio` | `renderFactCaisse` | Backend requis | ⚠️ oui |
| Facturation — Catégories de prestation | `#/facturation/categories (router: renderView() s` | `renderFactCategories` | Backend requis | ⚠️ oui |
| Facturation — Clients (lecture seule) | `#/facturation/clients — dispatch renderFacturati` | `renderFactClients` | Confirmé | — |
| Facturation — Compte client (relevé de compte client : factures + hist | `#/facturation/compte/<clientNom-encodé-URI> — pa` | `renderFactCompteClient` | Confirmé | — |
| Facturation — Devis | `#/facturation/devis (dispatch: renderFacturation` | `renderFactDevis` | Backend requis | ⚠️ oui |
| Facturation — Factures (liste) | `#/facturation/factures — routeur `renderView()` ` | `renderFactureListPage` | Backend requis | ⚠️ oui |
| Facturation — Paiements (« 💳 Paiements reçus ») | `#/facturation/paiements — dispatch : renderView(` | `renderFactPaiements` | Backend requis | ⚠️ oui |
| Facturation — Situation paiements (Situation des paiements par client) | `#/facturation/situation → renderFacturation(view` | `renderFactSituation` | Confirmé | — |
| Facturation — Stock (vue financière) | `#/facturation/stock — dispatch: route() (sgdi-ap` | `renderFactStock` | Confirmé | — |
| Facturation — Structures clients (référentiel des structures/typologie | `#/facturation/structures — dispatch: renderView(` | `renderFactStructures` | Backend requis | ⚠️ oui |
| Facturation — Tableau de bord | `#/facturation/dashboard (dispatch: case "factura` | `renderFactDashboard` | Backend requis | ⚠️ oui |
| Facturation — Thèmes (référentiel des thèmes de prestation/facture) | `#/facturation/themes — dispatché par renderView(` | `renderFactThemes` | Backend requis | ⚠️ oui |
| Facture — Éditeur (création/modification d'une facture client) | `#/facturation/factures avec le flag global windo` | `renderFactureEditor` | Risque critique | ⚠️ oui |

### 11-ERP Compta/Achats/Ventes  (23 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Achats — Commandes (BDC) | `#/achats/commandes` | `renderAchats` | Confirmé | — |
| Achats — Factures fournisseur | `#/achats/factures` | `renderAchats` | Backend requis | ⚠️ oui |
| Achats — Fournisseurs | `#/achats/fournisseurs` | `renderAchats` | Backend requis | ⚠️ oui |
| Achats — Réceptions | `#/achats/receptions` | `renderAchats` | Confirmé | — |
| Achats — Tableau de bord | `#/achats/dashboard` | `renderAchats` | Confirmé | — |
| Comptabilité — Balance | `#/accounting/balance` | `renderAccounting` | Confirmé | — |
| Comptabilité — Plan comptable (comptes) | `#/accounting/comptes` | `renderAccounting` | Backend requis | ⚠️ oui |
| Comptabilité — Tableau de bord | `#/accounting/dashboard` | `renderAccounting` | Backend requis | ⚠️ oui |
| Comptabilité — Écritures (journal) | `#/accounting/ecritures` | `renderAccounting` | Backend requis | ⚠️ oui |
| ERP Achats (module ATLAS ERP « Achats & Fournisseurs ») — 5 sous-écran | `#/achats (défaut sub=dashboard) — sous-routes: #` | `renderAchats` | Confirmé | — |
| ERP Comptabilité (module ATLAS ERP « accounting ») — 4 onglets : Table | `#/accounting[/<sub>] où sub ∈ {dashboard (défaut` | `renderAccounting` | Confirmé | — |
| ERP Reporting (ATLAS ERP) — tableau de bord analytique consolidé, lect | `#/reporting  (et #/reporting/<sub> — sub ∈ dashb` | `renderReporting` | Confirmé | — |
| ERP Ventes (ATLAS ERP — Ventes & Clients) | `#/ventes  → aussi #/ventes/dashboard, #/ventes/d` | `renderVentes` | Confirmé | — |
| Reporting — Dashboard consolidé | `#/reporting/dashboard` | `renderReporting` | Confirmé | — |
| Reporting — Statistiques achats | `#/reporting/achats` | `renderReporting` | Confirmé | — |
| Reporting — Statistiques ventes | `#/reporting/ventes` | `renderReporting` | Confirmé | — |
| Reporting — Top clients | `#/reporting/top-clients` | `renderReporting` | Confirmé | — |
| Reporting — Top fournisseurs | `#/reporting/top-fournisseurs` | `renderReporting` | Confirmé | — |
| Reporting — Trésorerie | `#/reporting/tresorerie` | `renderReporting` | Confirmé | — |
| Ventes — Commandes client | `#/ventes/commandes` | `renderVentes` | Confirmé | — |
| Ventes — Devis | `#/ventes/devis` | `renderVentes` | Confirmé | — |
| Ventes — Livraisons (BL) | `#/ventes/livraisons` | `renderVentes` | Confirmé | — |
| Ventes — Tableau de bord | `#/ventes/dashboard` | `renderVentes` | Confirmé | — |

### 12-Portail RH & Mobile  (20 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Accueil / Pointage rapide (tab-home) | `switchTab('home') → #tab-home (L976). Ajoute cla` | `renderHomeTab` | Confirmé | — |
| Auth — Connexion (login) | `Pas de hash. #authView > .auth-form#form-login (` | `?` | Backend requis | ⚠️ oui |
| Auth — Créer un compte (self-register) | `#authView > .auth-form#form-signup (L869). Affic` | `?` | Confirmé | — |
| Auth — Réinitialiser le mot de passe (reset) | `#authView > .auth-form#form-reset (L907). Affich` | `?` | Confirmé | — |
| Boîte de réception (tab-reception) | `switchTab('reception') → #tab-reception (L1544) ` | `renderInbox` | Confirmé | — |
| Changer le mot de passe (modal) | `Modal #pwdModal (L1665-1691). Ouvert par openCha` | `openChangePassword` | Confirmé | — |
| Comptes Portail RH | `#/portail/comptes — dispatché ligne 6883: `case"` | `renderPortailComptes` | Confirmé | — |
| Contrôle de ronde — portail (tab-ronde) | `switchTab('ronde') → #tab-ronde (L1065) ; ajoute` | `?` | Backend requis | ⚠️ oui |
| Documents (tab-documents) | `switchTab('documents') → #tab-documents (L1507) ` | `renderDocuments` | Backend requis | ⚠️ oui |
| Menu Portail (tab-portail) | `switchTab('portail') → #tab-portail (L1035). Ajo` | `?` | Confirmé | — |
| Module-Portal (portail de sous-domaine / module-host) — grille des rub | `#/module-portal (alias captés par le même rendu ` | `renderModuleHostPortal` | Confirmé | — |
| Nouvelle demande — 7 types (tab-nouvelle) | `switchTab('nouvelle') → #tab-nouvelle (L1146). B` | `?` | Backend requis | ⚠️ oui |
| Pointage QR — jetons éphémères (tab-pointage, carte QR) | `Même #tab-pointage, carte #qr-scan-card (L1467-1` | `?` | Confirmé | — |
| Pointage manuel / GPS (tab-pointage, cartes manuelle + historique) | `switchTab('pointage') → #tab-pointage (L1465) ; ` | `renderPointage` | Confirmé | — |
| Portail RH (vue DRH) — réception, suivi et traitement des demandes / r | `#/portail — dispatch l.6883: case 'portail': if(` | `renderPortailPersonnel` | Backend requis | ⚠️ oui |
| Portail RH personnel (self-service employé) | `#/portail — branche employé de `renderPortailPer` | `renderPortailPersonnel` | Backend requis | ⚠️ oui |
| Portail mobile self-service RH (PWA bilingue FR/AR). SPA autonome, ind | `` | `renderHistory` | Confirmé | — |
| Portail société (Company portal) — hub de lancement des modules pour l | `#/societe-portal (et #/dashboard quand une socié` | `renderSocietePortal` | Confirmé | — |
| Profil (tab-profil) — ORPHELIN (aucune navigation) | `switchTab('profil') → #tab-profil (L1559) mais A` | `saveProfile` | Risque critique | ⚠️ oui |
| Web Push VAPID + Service Worker (carte Notifications de Profil + porta | `Carte #notif-card dans #tab-profil (L1615-1621) ` | `?` | Confirmé | — |

### 13-Administration  (31 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Accès sociétés (libres) — "🏢 Accès sociétés libres" (Administration sy | `admin/access_societes (nominal). ATTENTION: la f` | `renderAdminAccessSocietes` | Backend requis | ⚠️ oui |
| Administration système (sous-flux du login) | `#/login (page login + modale "Administration sys` | `renderLogin` | Confirmé | — |
| Alertes — Configuration des alertes (Admin) | `#/admin/alertes — dispatché par renderAdmin(view` | `renderAdminAlertes` | Backend requis | ⚠️ oui |
| Articles / Catalogue (admin système) — Administration système > Articl | `#/admin/catalogue et #/admin/articles (alias) → ` | `renderAdminCatalogue` | Backend requis | ⚠️ oui |
| Champs personnalisés (Admin > Custom Fields) | `#/admin/champs — routeur l.6894 `case"admin":ren` | `renderAdminChamps` | Backend requis | ⚠️ oui |
| Cockpit Direction Générale (tableau de bord Administrateur général) | `Hash route `#/admin/dashboard` → dispatcher `rou` | `renderAdminDashboard` | Confirmé | — |
| Contrats du personnel (modèles Word) — Administration système > CONTRA | `#/admin/contrats (renderAdmin(view, sub="contrat` | `renderAdminContratsPersonnel` | Confirmé | — |
| Droits techniques avancés (matrice module × type de compte) — Administ | `admin/droits (dispatché par renderAdmin(view, su` | `renderAdminDroits` | Confirmé | — |
| Fiche de position (Administration système) — liste/maintenance des fic | `#/admin/fiches → renderAdmin(view,"fiches",arg) ` | `renderAdminFichesPosition` | Confirmé | — |
| Fiche de position employé (agent form) | `#/effectif/agent/:id` · **alias `#/agents/:id`** (case `agents`) | `renderAgentForm` | Confirmé | — |
| Fiches de position (annuaire) — liste/annuaire des employés avec carte | `#/fiches (alias #/fiches/toutes). Sous-routes gé` | `renderFiches` | Confirmé | — |
| Fil d'actualité admin (Administration — Fil d'actualité) | `admin/feed — dispatché par renderAdmin(view, sub` | `renderAdminFeed` | Backend requis | ⚠️ oui |
| Gestion des candidats (nettoyage) — Administration système | `admin/candidats — atteint via renderAdmin (sub =` | `renderAdminCandidats` | Confirmé | — |
| Gestion des effectifs (config) — Administration système | `#/admin/effectifs — dispatché par renderAdmin(vi` | `renderAdminEffectifsConfig` | Backend requis | ⚠️ oui |
| Historique des messages et pièces jointes (Administration → HISTORIQUE | `admin/messages — dispatché par renderAdmin(view,` | `renderAdminMessagesHistory` | Confirmé | — |
| Journal d'activité (Admin → Journal d'activité) — écran d'audit en lec | `#/admin/log — dispatché par renderAdmin(view, su` | `renderAdminLog` | Backend requis | ⚠️ oui |
| Magasins — suppression centralisée (Administration système) | `#/admin/magasins (dispatch: renderAdmin(view,"ma` | `renderAdminMagasins` | Confirmé | — |
| Modules personnalisés (Admin › Modules) — CRUD déclaratif de "modules  | `Hash route `#/admin/modules` → renderInternal sw` | `renderAdminModules` | Backend requis | ⚠️ oui |
| Modèles documents (Administration système → Bibliothèque centrale des  | `Hash/route interne: admin sub = "document-models` | `renderAdminDocumentModels` | Backend requis | ⚠️ oui |
| Onglet "Portail RH" (Compte Portail RH) de la Fiche de position employ | `Onglet interne de la fiche employé — `data-fp-ta` | `innerHTML` | Confirmé | — |
| Organiser le menu latéral (Administration système) — réordonnancement  | `admin/menu — dispatch: renderAdmin(view, sub="me` | `renderAdminSidebarMenu` | Backend requis | ⚠️ oui |
| Organiser les compteurs (Administration système → réordonnancement du  | `Hash route `#/admin/counters` → `renderAdmin(vie` | `renderAdminCountersMenu` | Backend requis | ⚠️ oui |
| Panneau administration système (Admin System Dashboard) — hub d'admini | `admin/dashboard — dispatché par renderAdmin(view` | `renderAdminSystemDashboard` | Backend requis | ⚠️ oui |
| Postes / Fonctions (Administration système — référentiel des postes/fo | `Hash SPA `#/admin/postes` (sub="postes" du route` | `renderAdminPostes` | Confirmé | — |
| Priorités (Administration système › Paramétrage › Priorités) — CRUD de | `#/admin/priorites — dispatché par renderAdmin(vi` | `renderAdminPriorites` | Backend requis | ⚠️ oui |
| Profils d'accès (niveaux) — Administration système | `admin/niveaux (dispatché par renderAdmin(view,su` | `renderAdminNiveaux` | Backend requis | ⚠️ oui |
| Stockage PostgreSQL (nettoyage) — Administration système | `#/admin/storage — dispatché par renderAdmin(view` | `renderAdminStorage` | Backend requis | ⚠️ oui |
| Synchronisation automatique (Administration système — paramétrage de l | `admin/sync — dispatché dans renderAdmin() l.2974` | `renderAdminSyncSettings` | Backend requis | ⚠️ oui |
| Sécurité des accès (Administration système — Périmètres & sécurité) | `#/admin/access — dispatché par renderAdmin(view,` | `renderAdminAccessSecurity` | Backend requis | ⚠️ oui |
| Utilisateurs (Administration système) — gestion des comptes SGDI | `Hash `#admin/users` → renderAdmin(view,'users',a` | `renderAdminUsers` | Confirmé | — |
| Validation des sections candidat (Admin système) — page de configurati | `admin/sections_candidat — dispatché dans renderA` | `renderAdminCandidatSections` | Backend requis | ⚠️ oui |

### 13b-Rapports  (1 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Rapports (synthèse RH) | `#/rapports` | `renderRapports` | Confirmé | — |

### 13c-Paramètres  (2 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Journal de déverrouillage (complet) | `#/parametres/log` | `renderUnlockLog` | Risque critique | ⚠️ oui |
| Paramètres (code de déverrouillage + journal récent) | `#/parametres` | `renderParametres` | Backend requis | ⚠️ oui |

### 14-Infra transverse  (6 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Bannière de mise à jour d'application (update-banner) | `sgdiCheckAppVersion` | `sgdiCheckAppVersion` | Confirmé | — |
| Barre de chargement de données (bandeau bas global, progression indéte | `sgdiShowDataLoadingBar — n'est PAS une route has` | `sgdiShowDataLoadingBar` | Confirmé | — |
| Bouton d'actualisation manuelle du workspace (barre d'onglets « chrome | `refreshWorkspace (pas une route hash : contrôle ` | `refreshWorkspace` | Backend requis | ⚠️ oui |
| ERP Ruban compteurs (bandeau KPI horizontal, sous la barre d'onglets,  | `Bandeau global non routé — injecté dans le shell` | `moduleCountersRibbonHTML` | Confirmé | — |
| Messagerie / dialogue interne (widget global overlay) — panneau MESSAG | `Pas de route hash dédiée : overlay global rendu ` | `dialogueBoxHTML` | Backend requis | ⚠️ oui |
| Moteur i18n bilingue FR/AR (transverse — pas un écran distinct) | `N/A. Moteur global. Sélecteurs de langue: header` | `?` | Backend requis | ⚠️ oui |

### 14b-Pages custom  (1 écrans)

| Écran | Route / repère | Rendu | Statut | Écrit snapshot |
|---|---|---|---|---|
| Rubrique personnalisée (page satellite créée depuis Administration sys | `#/custom/` | `renderCustomSidebarPage` | Backend requis | ⚠️ oui |

## 4. Classification des 273 endpoints backend

- **Utilisé** (appelé par le front) : **234**
- **Défini non consommé** (orphelin backend — à câbler à une UI ou supprimer) : **39**
- **À créer** (le front appelle une route inexistante, ou nouveau besoin d'archi) : **9**

### 4.a Endpoints définis non consommés (orphelins)

**achats** (9) : `DELETE /api/achats/commandes/{bdc_id}/lignes/{ligne_id}`, `DELETE /api/achats/receptions/{rec_id}/lignes/{ligne_id}`, `POST /api/achats/commandes/{bdc_id}/annuler`, `POST /api/achats/commandes/{bdc_id}/lignes`, `POST /api/achats/commandes/{bdc_id}/valider`, `POST /api/achats/factures/{facture_id}/payer`, `POST /api/achats/receptions/{rec_id}/lignes`, `PUT /api/achats/commandes/{bdc_id}/lignes/{ligne_id}`, `PUT /api/achats/receptions/{rec_id}/lignes/{ligne_id}`

**ventes** (9) : `DELETE /api/ventes/commandes/{cmd_id}/lignes/{ligne_id}`, `DELETE /api/ventes/devis/{devis_id}/lignes/{ligne_id}`, `DELETE /api/ventes/livraisons/{bl_id}/lignes/{ligne_id}`, `POST /api/ventes/commandes/{cmd_id}/lignes`, `POST /api/ventes/devis/{devis_id}/lignes`, `POST /api/ventes/livraisons/{bl_id}/lignes`, `PUT /api/ventes/commandes/{cmd_id}/lignes/{ligne_id}`, `PUT /api/ventes/devis/{devis_id}/lignes/{ligne_id}`, `PUT /api/ventes/livraisons/{bl_id}/lignes/{ligne_id}`

**irongs** (6) : `DELETE /api/irongs/collections/{name}/items/{item_id}`, `GET /api/irongs/collections/{name}/items`, `GET /api/irongs/collections/{name}/items/{item_id}`, `PATCH /api/irongs/collections/{name}/items/{item_id}`, `POST /api/irongs/collections/{name}/items`, `PUT /api/irongs/collections/{name}/items/{item_id}`

**accounting** (4) : `DELETE /api/accounting/ecritures/{ecriture_id}/lignes/{ligne_id}`, `POST /api/accounting/ecritures/{ecriture_id}/lignes`, `POST /api/accounting/ecritures/{ecriture_id}/valider`, `PUT /api/accounting/ecritures/{ecriture_id}/lignes/{ligne_id}`

**drh** (4) : `GET /api/drh/employees/{employee_id}/fiche-position`, `POST /api/drh/candidates/{candidate_id}/validate-final`, `POST /api/drh/leaves/{leave_id}/approve`, `POST /api/drh/leaves/{leave_id}/refuse`

**finance_routes.py** (2) : `GET /api/entries/{collection}/page`, `GET /api/payroll/{collection}/page`

**materiel** (1) : `GET /api/materiel/employees/{employee_id}/equipment`

**auth** (1) : `PATCH /api/auth/access-rules/{module_key}/{role}`

**ops** (1) : `POST /api/ops/events/{event_id}/close`

**ronde** (1) : `POST /api/ronde/circuits/{circuit_id}/checkpoints`

**portal** (1) : `PUT /api/portal/accounts/{matricule}/password`

### 4.b Endpoints à créer

- `POST /api/auth/otp/send`
- `POST /api/auth/otp/verify`
- `POST /api/auth/email/confirm`
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `POST|PUT /api/drh/amendments (avenants)`
- `GET /api/dashboard/summary (KPI accueil, NOUVEAU)`
- `GET /api/dashboard/global (KPI groupe, NOUVEAU)`
- `GET /api/drh/leaves (existe, NON consommé - à câbler)`

### 4.c Logique à migrer vers le backend (endpoints existants mais logique côté client)

- Paie : barème IRG / CNAS / exonération / abattement / bande 30001-35000 (aujourd'hui en JS)
- Stock : calcul du stock actuel `stockGetActuel` (double comptage) → source serveur unique
- Numérotation facture/devis/avoir/matricule : `length+1` client → séquence serveur atomique
- Facturation : TVA / TTC / remise (bugs critiques §7) → calcul serveur
- KPI dashboards : agrégats calculés côté client → `/api/dashboard/summary` + `/global`
- Statuts dérivés (employé, facture) → calcul serveur

## 5. Doublons supprimés

- `ERP Factures (liste) — Facturation > Factures` (route `#/facturation/factures  (dispatcher: ren`) — fusionné avec l'écran sgdi-app.js équivalent (la facturation vit dans sgdi-app.js, pas erp-frontend.js)
- `ERP Paiements reçus (liste des encaissements clients) — onglet du modu` (route `#/facturation/paiements (dispatch: rende`) — fusionné avec l'écran sgdi-app.js équivalent (la facturation vit dans sgdi-app.js, pas erp-frontend.js)
- `ERP Caisse (Finances/Compta > Caisse) — journal de trésorerie: entrées` (route `#/facturation/caisse — routeur renderVie`) — fusionné avec l'écran sgdi-app.js équivalent (la facturation vit dans sgdi-app.js, pas erp-frontend.js)
- `ERP Balance âgée — "Balance agée des créances" (ancienneté des facture` (route `#/facturation/balance — dispatch: route(`) — fusionné avec l'écran sgdi-app.js équivalent (la facturation vit dans sgdi-app.js, pas erp-frontend.js)
- `ERP Compte client — relevé de compte d'un client (factures + historiqu` (route `#/facturation/compte/{nomClientURIEncode`) — fusionné avec l'écran sgdi-app.js équivalent (la facturation vit dans sgdi-app.js, pas erp-frontend.js)

## 6. Legacy à supprimer (code mort confirmé)

- `app/static/app.js` — fichier NON chargé par index.html (ses appels /drh/sanctions, /drh/documents ne comptent pas)
- `app/static/sgdi-inline-2.js` — aucun appel API
- `_bootCacheLoad` — retourne toujours null (branche cache de démarrage morte)
- `__renderFactFacturesOLD_REMOVED` — code mort
- `deleteDevis` défini deux fois (comportement dépend de l'ordre)
- Snapshot global `db` + `hydrateDB` + `sgdiBackendSave` (PUT /irongs/db) — à décommissionner en fin de migration
- Auto-refresh `sgdiScheduleAutoRefresh` + BroadcastChannel + polling — remplacés par événements SSE granulaires
- hashPassword/generateSalt/checkStrength (portail mobile) — vestiges (auth réelle serveur)

## 7. Risques critiques (à corriger, NE PAS reproduire)

### Sécurité (majeur)
- Le backend n'exige souvent que `current_user` (authentifié) sur les écritures — **aucun contrôle rôle/niveau/société** (sauf ~3 endpoints admin système). Cloisonnement quasi entièrement CÔTÉ CLIENT.
- Aucun cloisonnement société côté serveur : le paramètre `society` est accepté sans vérifier les droits.
- `route()` n'a aucune garde par route → accès direct par URL contourne le filtrage de menu.
- Niveaux H1–H5 ne gouvernent que la VISIBILITÉ des modules, pas les actions (un H1 'Consultation' peut créer/valider/supprimer).

### Fiabilité / données
- Concurrence multi-PC : `PUT` snapshot global = last-write-wins → écrasement (le « tout à zéro »).
- Numérotation non atomique (facture/devis/matricule `length+1`) → collisions.
- Éditeur de facture — 5 bugs : remise non persistée en base ; prix mal parsé à l'impression (`parseFloat` sur format fr-FR → montants sous-évalués) ; TVA≠19% perdue à la réouverture ; TVA=0 sur le document imprimé ; statut 'annulée' réinitialisé à chaque save.
- Double comptage stock (`stockGetActuel`).
- `deletePaiement` : la caisse liée n'est jamais supprimée (résidus de trésorerie).

### Écrans porteurs d'un risque critique
- `Mouvements de stock (Matériel → Mouvements)` — logique métier côté client à corriger/migrer (voir SPEC)
- `Stats stock pro — "Matériel & Équipement › Statistiques" (on` — logique métier côté client à corriger/migrer (voir SPEC)
- `Entrée/Sortie stock (modaux) — une seule modale paramétrée p` — logique métier côté client à corriger/migrer (voir SPEC)
- `Facture — Éditeur (création/modification d'une facture clien` — logique métier côté client à corriger/migrer (voir SPEC)
- `Dossier administratif (archive des pièces)` — 
- `Documents / Archives (documents archivés par employé)` — 
- `Demande structure — Réception / Envoi (liste)` — 
- `Journal de déverrouillage (complet)` — 
- `Notes internes (liste)` — 
- `Archives (liste)` — 
- `DRH — Service social (liste CNAS/Chifa)` — 
- `DRH — Mise en demeure (dotation non reversée, sortants)` — 
- `Statistiques RH (tableau multi-graphes)` — 
- `Profil (tab-profil) — ORPHELIN (aucune navigation)` — 
