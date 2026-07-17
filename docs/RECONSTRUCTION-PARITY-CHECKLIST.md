# Checklist de parité — Reconstruction Frontend SGDI/ATLAS

> Une case par écran (208) + fonctionnalités transverses. Cocher UNIQUEMENT quand l'écran reconstruit est **vérifié à parité** contre sa fiche `RECONSTRUCTION-FRONTEND-SPEC.md` :
> même route · mêmes champs · mêmes actions · mêmes appels API · **même résultat de calcul** · mêmes permissions · mêmes cas limites (bugs critiques CORRIGÉS, pas reproduits).

## Fonctionnalités transverses (à couvrir avant/pendant les écrans)
- [ ] **Module BADGES**
- [ ] **Génération, validation/signature et archivage des DOCUMENTS employé**
- [ ] **Carte GPS des sites et géolocalisation**
- [ ] **Signature manuscrite**
- [ ] **Deux moteurs QR SGDI :**
- [ ] **Impressions et exports SGDI: fenêtres d'impression window.open/window.**
- [ ] **Moteur i18n bilingue FR/AR à retraduction DOM en direct du portail RH**
- [ ] **Web Push**
- [ ] **Fonctionnalité offline / PWA de SGDI-BACKEND : deux applications PWA d**
- [ ] **KPI / compteurs des tableaux de bord SGDI**
- [ ] **Module OPS Mouvements**
- [ ] **Modèle de permissions SGDI**
- [ ] **Infrastructure UI réutilisable de SGDI**
- [ ] **ATLAS ERP frontend**
- [ ] **Passe 2**

## Écrans par module
### 00-Auth & Portails  (2)
- [ ] Login (Connexion ATLAS) — `#/login` (`renderLogin`)
- [ ] Sélection société (Portail ATLAS) — `#/select-societe` (`renderSocieteSelector`) 🟠

### 01-Effectif & Agents  (5)
- [ ] Cartes KPI DRH — Tableau de bord DRH « Synthèse générale » — `#/drh/dashboard (aussi #/drh sans sous-r` (`renderDRHDashboard`)
- [ ] Droits acquis congés (DRH) — écran « CONGÉS » du portail DRH — `#/drh/conges  (router: switch(root) case` (`renderDRHCongesPersonnel`)
- [ ] Préparation opérationnelle (Employés non opérationnels + étapes bloquant — `#/effectif/preparation — dispatché par r` (`renderOperationalPreparation`)
- [ ] Récapitulatif / Liste des effectifs (GRH — Gestion des effectifs) — `#/effectif (alias #/effectif/recap et #/` (`renderEffectif`) 🟠
- [ ] Éléments sortants (ÉLÉMENTS SORTANTS) — liste en lecture seule des emplo — `#/effectif/sortants (dispatch : sgdi-app` (`renderElementsSortants`)

### 01b-Tableaux de bord  (2)
- [ ] Situation générale — Groupe (tableau de bord consolidé multi-sociétés, l — `#/global-dashboard` (`renderGlobalDashboard`)
- [ ] Tableau de bord (Accueil) — renderDashboard — `#/dashboard (default route; also fallbac` (`renderDashboard`)

### 01c-DRH sous-vues  (12)
- [ ] DRH — Mise en demeure (dotation non reversée, sortants) — `#/drh/mise_en_demeure` (`renderDRHMiseEnDemeure`) 🔴
- [ ] DRH — Période d'essai — `#/drh/essai` (`renderDRHPeriodeEssai`) 🟠
- [ ] DRH — Reversements en attente (dotation) — `#/drh/reversement` (`renderDRHReversementEnAttente`) 🟠
- [ ] DRH — Service social (liste CNAS/Chifa) — `#/drh/social` (`renderDRHSocial`) 🔴
- [ ] DRH — Service social, fiche agent (détail) — `#/drh/social/{id}` (`renderDRHSocialAgent`) 🟠
- [ ] Statistiques RH (tableau multi-graphes) — `#/drh/stats` (`renderDRHStats`) 🔴
- [ ] Statistiques par affectation (sites) — `#/drh/stats_affectation` (`renderDRHStatsAffectation`)
- [ ] Statistiques par catégorie — `#/drh/stats_categorie` (`renderDRHStatsCategorie`)
- [ ] Statistiques par fonction — `#/drh/stats_fonction` (`renderDRHStatsFonction`)
- [ ] Statistiques par salaire — `#/drh/stats_salaire` (`renderDRHStatsSalaire`)
- [ ] Statistiques par société (tableau) — `#/drh/stats_societe` (`renderDRHStatsSociete`)
- [ ] Statistiques par thème — `#/drh/stats_theme` (`renderDRHStatsTheme`)

### 02-Recrutement  (5)
- [ ] Candidats archivés (onglet "Archives" du hub Recrutement / Candidats) — `#/candidats_archives (liste) — #/candida` (`renderRecrutement`)
- [ ] Candidats en réserve (liste + actions) — onglet "Réserve" du module Recr — `#/reserve  (dispatch ligne 8863 du switc` (`renderRecrutement`)
- [ ] Fiche candidat (dossier) — formulaire de dossier candidat en 2 étapes /  — `#/recrutement/{id} (alias exacts : #/res` (`renderCandidatForm`)
- [ ] Nouvelles candidatures (onglet "new" de l'écran unifié Recrutement / Can — `#/recrutement (alias équivalents : #/rec` (`renderRecrutement`)
- [ ] Réception demandes & réclamations (Demandes Personnel — Portail RH) — `#/demandes_personnel/dashboard (alias su` (`renderDemandesPersonnel`) 🟠

### 02-Recrutement & Demandes  (2)
- [ ] Demande structure — Réception / Envoi (liste) — `#/demandes_structure/reception` (`renderDemandesStructure`) 🔴
- [ ] Demande structure — Tableau de bord — `#/demandes_structure` (`renderDemandesStructureDashboard`) 🟠

### 03-Contrats  (6)
- [ ] Avenants au contrat (Contrats > Avenants) — `#/contrats/avenants — dispatché dans le ` (`renderAvenants`)
- [ ] Nouveau contrat / Contractualisation (NOUVEAU CONTRAT APS) — création du — `#/contrats/nouveau/{candidatId} — routeu` (`renderContractualisation`) 🟠
- [ ] Nouveau contrat direct (pont) — page relais #/contrats/nouveau_contrat q — `#/contrats/nouveau_contrat (dispatch: sg` (`renderNouveauContratDirect`)
- [ ] Situation contrat (personnel) — liste analytique des contrats de travail — `#/contrats/situation (alias : #/contrats` (`renderContrats`)
- [ ] Tableau de bord CONTRAT (module DRH) — 5 groupes de métriques cliquables — `#/contrats/dashboard (routeur: case "con` (`renderContratsDashboard`)
- [ ] À contractualiser (Contrats > Candidats retenus / Instance de signature) — `#/contrats/a_contractualiser — dispatché` (`renderContrats`) 🟠

### 04-Congés & Fiches  (6)
- [ ] Blocage "PostgreSQL obligatoire" — écran de garde plein écran (interstit — `Pas de route hash dédiée : c'est un inte` (`renderPostgresRequired`) 🟠
- [ ] Création de badge (module Badges personnel, DRH) — `#/fiches/badge (alias: #/badge → renderF` (`renderBadgeModule`)
- [ ] Dossier administratif (archive des pièces) — `#/dossiers` (`renderDossiers`) 🔴
- [ ] Impression en lot des fiches de position — écran DRH permettant de coche — `#/fiches/imprimer — dispatché par render` (`renderFichesImpression`)
- [ ] Situation des congés — `#/conges (dispatch: `case"conges":render` (`renderConges`) 🟠
- [ ] Vérification publique de badge (page publique plein écran affichée au sc — `#/badge/verify/:id — :id = référence emp` (`renderBadgeVerify`)

### 04b-Documents/Archives  (1)
- [ ] Documents / Archives (documents archivés par employé) — `#/documents` (`renderDocumentsArchives`) 🔴

### 05-Incidents/Main courante  (4)
- [ ] Main courante — Tableau de bord — `#/incidents/dashboard (router: `case"inc` (`renderMainCouranteDashboard`)
- [ ] Main courante — Évènements autres — `#/incidents/autres (dispatch: `case"inci` (`renderIncidents`)
- [ ] Main courante — Évènements site — `#/incidents/site (dispatch: `case"incide` (`renderIncidents`)
- [ ] Modal — Nouvel évènement (Main courante / Incidents) — `Modale ouverte par openIncidentModal(mod` (`openIncidentModal`) 🟠

### 05b-Secrétariat  (5)
- [ ] Archives (liste) — `#/secretariat/archives` (`renderSecretariat`) 🔴
- [ ] Courriers (liste) — `#/secretariat/courriers` (`renderSecretariat`)
- [ ] Modal Nouveau courrier (création) — `#/secretariat/dashboard` (`openSecretariatCourrierModal`) 🟠
- [ ] Notes internes (liste) — `#/secretariat/notes` (`renderSecretariat`) 🔴
- [ ] Tableau de bord Secrétariat — `#/secretariat/dashboard` (`renderSecretariat`) 🟠

### 06-Sites & Pointage  (14)
- [ ] Encart évènements fiche Site (bloc "Main courante" — siteEvenementsHTML) — `app/static/sgdi-app.js l.16413 `siteEven` (`siteEvenementsHTML`) 🟠
- [ ] Modal — Détail évènement (Main courante) — `viewIncident(id) — app/static/sgdi-app.j` (`viewIncident`)
- [ ] Pointage — Archives (ARCHIVES POINTAGE) — écran de consultation 100% lec — `#/pointage/archives` (`renderPointageArchives`)
- [ ] Pointage — Feuille de présence quotidienne (FPQ) — `#/pointage/feuille (alias: #/pointage/sc` (`renderFeuillePresentQR`) 🟠
- [ ] Pointage — Légende & codes (onglet "🎨 Légende & codes" du module Pointag — `#/pointage/legende — dispatché par route` (`renderPointageLegende`)
- [ ] Pointage — QR par site (mur de QR codes de présence, un QR par site acti — `#/pointage/qr (onglet "qr" de POINTAGE_T` (`renderPointageQRGen`) 🟠
- [ ] Pointage — Récap par agent (récapitulatif mensuel jour par jour d'un age — `#/pointage/recap  et  #/pointage/recap/{` (`renderPointageRecap`)
- [ ] Pointage — Récap par société (onglet "🏢 Récap par société" du module Poi — `#/pointage/societe — dispatché par rende` (`renderPointageSociete`)
- [ ] Pointage — Saisie automatique (onglet "🤖 Saisie automatique" du module P — `#/pointage/auto — dispatché par renderPo` (`renderPointageSaisieAuto`) 🟠
- [ ] Pointage — Saisie manuelle (grille mensuelle de pointage, 1 ligne par ag — `#/pointage/saisie — dispatché par render` (`renderPointageSaisie`)
- [ ] Pointage — Statistiques (onglet "📈 STATISTIQUES" du module Pointage) — `#/pointage/stats — dispatch: route() → r` (`renderPointageStats`)
- [ ] Pointage — Tableau de bord (renderPointageDashboard) — `#/pointage/dashboard — dispatché par le ` (`renderPointageDashboard`) 🟠
- [ ] Sites — Fiche technique / Création de site — `#/sites/nouveau (création, id=null) — mê` (`renderSiteForm`)
- [ ] Sites — Tableau de bord — `#/sites (et alias #/sites/actifs — le me` (`renderSites`)

### 06b-OPS  (6)
- [ ] OPS — Employés en instance de dotation (suivi) — `#/ops/instance_dotation` (`renderOpsInstanceDotation`)
- [ ] OPS — Missions (ordres de mission) — `#/ops/missions` (`renderOpsMissions`) 🟠
- [ ] OPS — Mouvements (ordres de mouvement) — `#/ops/mouvements` (`renderOpsMouvements`) 🟠
- [ ] OPS — QR Présence (générateur QR par site) — `#/ops/qr` (`renderOPS`)
- [ ] OPS — Supervision site (inspections) — `#/ops/supervision` (`renderOpsSupervision`) 🟠
- [ ] OPS — Tableau de bord — `#/ops/dashboard` (`renderOPS`) 🟠

### 07-Paie  (6)
- [ ] Aperçu / Impression fiche de paie (bulletin de paie SGDI) — document en  — `Pas de route dédiée : overlay (modale) s` (`paieFicheHTML`) 🟠
- [ ] Dossier salaire employé (Paie / fiche salariale d'un employé) — `#/paie/agent/:id — dispatché par renderV` (`renderPaieAgent`)
- [ ] Modale "Nouvelle rubrique de paie" (openPaieRubriqueModal) — création d' — `#/paie/dashboard → <details> "Rubriques ` (`openPaieRubriqueModal`) 🟠
- [ ] Modale « Nouvelle grille salariale par fonction » (Grille salariale) — m — `Ouverte depuis la vue `paie/dashboard` (` (`openPaieGrilleModal`) 🟠
- [ ] Modale « Éléments de paie » (éléments variables du mois pour un employé) — `Pas une route hash : modale ouverte via ` (`openPaieElementsModal`) 🟠
- [ ] Tableau de bord Paie — écran principal du module Paie (calcul paie Algér — `#/paie/dashboard — routeur ligne 6899 : ` (`renderPaie`) 🟠

### 08-Matériel  (20)
- [ ] Alertes stock (Matériel &gt; Alertes) — `#/materiel/alertes — dispatché par rende` (`renderMatSimpleAlertesServer`)
- [ ] Article legacy unitaire — formulaire de création/édition d'un article ma — `#/materiel/nouveau (création) — variante` (`renderMaterielForm`) 🟠
- [ ] Catalogue / Articles (liste du catalogue materiel) — `#/materiel/articles (alias #/materiel/ca` (`renderMatSimpleArticles`)
- [ ] Entrée/Sortie stock (modaux) — une seule modale paramétrée par `type` (' — `#/materiel/entree-stock (sub==='entree-s` (`openModal`) 🔴
- [ ] Fiche article (détail) — Matériel / Stock — `#/materiel/article/:id  (dispatch: `if(s` (`renderStockArticleDetail`)
- [ ] Fiches de position (contexte matériel) — `#/materiel/fiches — dispatch: router `ca` (`renderFiches`)
- [ ] Formulaire article (Nouvel article au catalogue / Modifier l'article) —  — `#/materiel/article-nouveau (création) et` (`renderStockArticleForm`) 🟠
- [ ] Formulaire fournisseur (Nouveau / Modifier) — module Matériel — `#/materiel/fournisseur-nouveau (création` (`renderMatSimpleFournisseurForm`) 🟠
- [ ] Formulaire magasin (Nouveau / Modifier magasin) — création/édition d'un  — `#/materiel/magasin-nouveau (création, id` (`renderMatSimpleMagasinForm`) 🟠
- [ ] Fournisseur (détail) — vue lecture seule d'un partenaire achats matériel — `#/materiel/fournisseur/:id` (`renderMatSimpleFournisseurDetail`)
- [ ] Fournisseurs (liste) — module Materiel/Equipement — `#/materiel/fournisseurs (dispatch au rou` (`renderMatSimpleFournisseurs`)
- [ ] Inventaire général (module Matériel — vue stock consolidée tous magasins — `#/materiel/inventaire — dispatch: `case"` (`renderMatSimpleInventaire`)
- [ ] Magasin (détail) — fiche d'un magasin/lieu de stockage du module Matérie — `#/materiel/magasin/:id  (dispatch dans r` (`renderMatSimpleMagasinDetail`)
- [ ] Magasins (liste) — Module Matériel & Équipement — `#/materiel/magasins (dispatch: router `c` (`renderMatSimpleMagasins`)
- [ ] Mouvements de stock (Matériel → Mouvements) — `#/materiel/mouvements — dispatché par re` (`renderMatSimpleMouvements`) 🔴
- [ ] Nouvelle dotation (Dotation matériel employé / site / structure) — `#/materiel/dotation` (`renderMatSimpleDotation`)
- [ ] Reversement — "ÉQUIPEMENT / MATÉRIEL EN INSTANCE DE REVERSEMENT" (module — `#/materiel/reversement — dispatché dans ` (`renderMatSimpleReversement`)
- [ ] SITE EN ATTENTE DE DOTATION (Sites actifs sans dotation matériel enregis — `#/materiel/sites-dotation — dispatché da` (`renderMatSitesEnAttenteDotation`)
- [ ] Stats stock pro — "Matériel & Équipement › Statistiques" (onglet Statist — `#/materiel/stats (alias exact: #/materie` (`renderStockProMain`) 🔴
- [ ] Tableau de bord matériel (MATÉRIEL — Tableau de bord) — `#/materiel/dashboard (alias : #/materiel` (`renderMatSimpleDashboard`)

### 09-Commercial  (11)
- [ ] Client — Fiche/éditeur (openClientModal) — malgré son nom, ce N'EST PAS  — `openClientModal(id, readOnly) — pas de r` (`openClientModal`)
- [ ] Commercial — Calendrier (titre affiché: 'Calendrier Commercial') — `#/commercial/calendrier — routeur ligne ` (`renderCommCalendrier`) 🟠
- [ ] Commercial — Catalogue prestations — `#/commercial/catalogue — dispatché dans ` (`renderCommCatalogue`) 🟠
- [ ] Commercial — Clients (liste) — `#/commercial/clients — dispatché par ren` (`renderCommClients`)
- [ ] Commercial — Devis (liste + éditeur plein écran + 3 modales outils) — `#/commercial/devis — dispatch: renderCom` (`renderCommDevis`) 🟠
- [ ] Commercial — Opportunités (pipeline commercial : liste, création, change — `#/commercial/opportunites — dispatch : r` (`renderCommOpportunites`)
- [ ] Commercial — Prospects (liste + création + conversion) — `#/commercial/prospects — routeur: render` (`renderCommProspects`)
- [ ] Commercial — Statistiques commerciales (📈), read-only analytics dashboar — `#/commercial/stats — parsed in renderVie` (`renderCommStats`)
- [ ] Commercial — Tableau de bord — `#/commercial/dashboard (dispatch: render` (`renderCommDashboard`)
- [ ] Commercial — Tarification (vue par catégorie, LECTURE SEULE) — `#/commercial/tarifs — dispatché par rend` (`renderCommTarifs`) 🟠
- [ ] Commercial — Visites / Suivi (titre H1: "📞 Visites / Suivi", sous-titre  — `#/commercial/visites — dispatcher `case ` (`renderCommVisites`) 🟠

### 10-Facturation/Finances  (17)
- [ ] Client — Fiche imprimable (aperçu client en pop-up imprimable) — `openClientDetail(id) — pas une route has` (`openClientDetail`)
- [ ] Facturation — Avances clients — `#/facturation/avances (dispatché par ren` (`renderFactAvances`) 🟠
- [ ] Facturation — Avoirs (liste des notes de crédit émises sur factures) — `#/facturation/avoirs — dispatch: renderF` (`renderFactAvoirs`) 🟠
- [ ] Facturation — Balance âgée des créances — `#/facturation/balance (router: switch on` (`renderFactBalance`) 🟠
- [ ] Facturation — Caisse — `#/facturation/caisse (dispatch: renderFa` (`renderFactCaisse`) 🟠
- [ ] Facturation — Catégories de prestation — `#/facturation/categories (router: render` (`renderFactCategories`) 🟠
- [ ] Facturation — Clients (lecture seule) — `#/facturation/clients — dispatch renderF` (`renderFactClients`)
- [ ] Facturation — Compte client (relevé de compte client : factures + histor — `#/facturation/compte/<clientNom-encodé-U` (`renderFactCompteClient`)
- [ ] Facturation — Devis — `#/facturation/devis (dispatch: renderFac` (`renderFactDevis`) 🟠
- [ ] Facturation — Factures (liste) — `#/facturation/factures — routeur `render` (`renderFactureListPage`) 🟠
- [ ] Facturation — Paiements (« 💳 Paiements reçus ») — `#/facturation/paiements — dispatch : ren` (`renderFactPaiements`) 🟠
- [ ] Facturation — Situation paiements (Situation des paiements par client) — `#/facturation/situation → renderFacturat` (`renderFactSituation`)
- [ ] Facturation — Stock (vue financière) — `#/facturation/stock — dispatch: route() ` (`renderFactStock`)
- [ ] Facturation — Structures clients (référentiel des structures/typologies  — `#/facturation/structures — dispatch: ren` (`renderFactStructures`) 🟠
- [ ] Facturation — Tableau de bord — `#/facturation/dashboard (dispatch: case ` (`renderFactDashboard`) 🟠
- [ ] Facturation — Thèmes (référentiel des thèmes de prestation/facture) — `#/facturation/themes — dispatché par ren` (`renderFactThemes`) 🟠
- [ ] Facture — Éditeur (création/modification d'une facture client) — `#/facturation/factures avec le flag glob` (`renderFactureEditor`) 🔴

### 11-ERP Compta/Achats/Ventes  (23)
- [ ] Achats — Commandes (BDC) — `#/achats/commandes` (`renderAchats`)
- [ ] Achats — Factures fournisseur — `#/achats/factures` (`renderAchats`) 🟠
- [ ] Achats — Fournisseurs — `#/achats/fournisseurs` (`renderAchats`) 🟠
- [ ] Achats — Réceptions — `#/achats/receptions` (`renderAchats`)
- [ ] Achats — Tableau de bord — `#/achats/dashboard` (`renderAchats`)
- [ ] Comptabilité — Balance — `#/accounting/balance` (`renderAccounting`)
- [ ] Comptabilité — Plan comptable (comptes) — `#/accounting/comptes` (`renderAccounting`) 🟠
- [ ] Comptabilité — Tableau de bord — `#/accounting/dashboard` (`renderAccounting`) 🟠
- [ ] Comptabilité — Écritures (journal) — `#/accounting/ecritures` (`renderAccounting`) 🟠
- [ ] ERP Achats (module ATLAS ERP « Achats & Fournisseurs ») — 5 sous-écrans  — `#/achats (défaut sub=dashboard) — sous-r` (`renderAchats`)
- [ ] ERP Comptabilité (module ATLAS ERP « accounting ») — 4 onglets : Tableau — `#/accounting[/<sub>] où sub ∈ {dashboard` (`renderAccounting`)
- [ ] ERP Reporting (ATLAS ERP) — tableau de bord analytique consolidé, lectur — `#/reporting  (et #/reporting/<sub> — sub` (`renderReporting`)
- [ ] ERP Ventes (ATLAS ERP — Ventes & Clients) — `#/ventes  → aussi #/ventes/dashboard, #/` (`renderVentes`)
- [ ] Reporting — Dashboard consolidé — `#/reporting/dashboard` (`renderReporting`)
- [ ] Reporting — Statistiques achats — `#/reporting/achats` (`renderReporting`)
- [ ] Reporting — Statistiques ventes — `#/reporting/ventes` (`renderReporting`)
- [ ] Reporting — Top clients — `#/reporting/top-clients` (`renderReporting`)
- [ ] Reporting — Top fournisseurs — `#/reporting/top-fournisseurs` (`renderReporting`)
- [ ] Reporting — Trésorerie — `#/reporting/tresorerie` (`renderReporting`)
- [ ] Ventes — Commandes client — `#/ventes/commandes` (`renderVentes`)
- [ ] Ventes — Devis — `#/ventes/devis` (`renderVentes`)
- [ ] Ventes — Livraisons (BL) — `#/ventes/livraisons` (`renderVentes`)
- [ ] Ventes — Tableau de bord — `#/ventes/dashboard` (`renderVentes`)

### 12-Portail RH & Mobile  (20)
- [ ] Accueil / Pointage rapide (tab-home) — `switchTab('home') → #tab-home (L976). Aj` (`renderHomeTab`)
- [ ] Auth — Connexion (login) — `Pas de hash. #authView > .auth-form#form` (`?`) 🟠
- [ ] Auth — Créer un compte (self-register) — `#authView > .auth-form#form-signup (L869` (`?`)
- [ ] Auth — Réinitialiser le mot de passe (reset) — `#authView > .auth-form#form-reset (L907)` (`?`)
- [ ] Boîte de réception (tab-reception) — `switchTab('reception') → #tab-reception ` (`renderInbox`)
- [ ] Changer le mot de passe (modal) — `Modal #pwdModal (L1665-1691). Ouvert par` (`openChangePassword`)
- [ ] Comptes Portail RH — `#/portail/comptes — dispatché ligne 6883` (`renderPortailComptes`)
- [ ] Contrôle de ronde — portail (tab-ronde) — `switchTab('ronde') → #tab-ronde (L1065) ` (`?`) 🟠
- [ ] Documents (tab-documents) — `switchTab('documents') → #tab-documents ` (`renderDocuments`) 🟠
- [ ] Menu Portail (tab-portail) — `switchTab('portail') → #tab-portail (L10` (`?`)
- [ ] Module-Portal (portail de sous-domaine / module-host) — grille des rubri — `#/module-portal (alias captés par le mêm` (`renderModuleHostPortal`)
- [ ] Nouvelle demande — 7 types (tab-nouvelle) — `switchTab('nouvelle') → #tab-nouvelle (L` (`?`) 🟠
- [ ] Pointage QR — jetons éphémères (tab-pointage, carte QR) — `Même #tab-pointage, carte #qr-scan-card ` (`?`)
- [ ] Pointage manuel / GPS (tab-pointage, cartes manuelle + historique) — `switchTab('pointage') → #tab-pointage (L` (`renderPointage`)
- [ ] Portail RH (vue DRH) — réception, suivi et traitement des demandes / réc — `#/portail — dispatch l.6883: case 'porta` (`renderPortailPersonnel`) 🟠
- [ ] Portail RH personnel (self-service employé) — `#/portail — branche employé de `renderPo` (`renderPortailPersonnel`) 🟠
- [ ] Portail mobile self-service RH (PWA bilingue FR/AR). SPA autonome, indep — `` (`renderHistory`)
- [ ] Portail société (Company portal) — hub de lancement des modules pour la  — `#/societe-portal (et #/dashboard quand u` (`renderSocietePortal`)
- [ ] Profil (tab-profil) — ORPHELIN (aucune navigation) — `switchTab('profil') → #tab-profil (L1559` (`saveProfile`) 🔴
- [ ] Web Push VAPID + Service Worker (carte Notifications de Profil + portail — `Carte #notif-card dans #tab-profil (L161` (`?`)

### 13-Administration  (31)
- [ ] Accès sociétés (libres) — "🏢 Accès sociétés libres" (Administration syst — `admin/access_societes (nominal). ATTENTI` (`renderAdminAccessSocietes`) 🟠
- [ ] Administration système (sous-flux du login) — `#/login (page login + modale "Administra` (`renderLogin`)
- [ ] Alertes — Configuration des alertes (Admin) — `#/admin/alertes — dispatché par renderAd` (`renderAdminAlertes`) 🟠
- [ ] Articles / Catalogue (admin système) — Administration système > Articles — `#/admin/catalogue et #/admin/articles (a` (`renderAdminCatalogue`) 🟠
- [ ] Champs personnalisés (Admin > Custom Fields) — `#/admin/champs — routeur l.6894 `case"ad` (`renderAdminChamps`) 🟠
- [ ] Cockpit Direction Générale (tableau de bord Administrateur général) — `Hash route `#/admin/dashboard` → dispatc` (`renderAdminDashboard`)
- [ ] Contrats du personnel (modèles Word) — Administration système > CONTRAT — `#/admin/contrats (renderAdmin(view, sub=` (`renderAdminContratsPersonnel`)
- [ ] Droits techniques avancés (matrice module × type de compte) — Administra — `admin/droits (dispatché par renderAdmin(` (`renderAdminDroits`)
- [ ] Fiche de position (Administration système) — liste/maintenance des fiche — `#/admin/fiches → renderAdmin(view,"fiche` (`renderAdminFichesPosition`)
- [ ] Fiche de position employé (agent form) — `#/effectif/agent/:id` **· Alias : `#/agents/:id`** (case `agents` → `renderAgentForm`)
- [ ] Fiches de position (annuaire) — liste/annuaire des employés avec cartes  — `#/fiches (alias #/fiches/toutes). Sous-r` (`renderFiches`)
- [ ] Fil d'actualité admin (Administration — Fil d'actualité) — `admin/feed — dispatché par renderAdmin(v` (`renderAdminFeed`) 🟠
- [ ] Gestion des candidats (nettoyage) — Administration système — `admin/candidats — atteint via renderAdmi` (`renderAdminCandidats`)
- [ ] Gestion des effectifs (config) — Administration système — `#/admin/effectifs — dispatché par render` (`renderAdminEffectifsConfig`) 🟠
- [ ] Historique des messages et pièces jointes (Administration → HISTORIQUE M — `admin/messages — dispatché par renderAdm` (`renderAdminMessagesHistory`)
- [ ] Journal d'activité (Admin → Journal d'activité) — écran d'audit en lectu — `#/admin/log — dispatché par renderAdmin(` (`renderAdminLog`) 🟠
- [ ] Magasins — suppression centralisée (Administration système) — `#/admin/magasins (dispatch: renderAdmin(` (`renderAdminMagasins`)
- [ ] Modules personnalisés (Admin › Modules) — CRUD déclaratif de "modules mé — `Hash route `#/admin/modules` → renderInt` (`renderAdminModules`) 🟠
- [ ] Modèles documents (Administration système → Bibliothèque centrale des mo — `Hash/route interne: admin sub = "documen` (`renderAdminDocumentModels`) 🟠
- [ ] Onglet "Portail RH" (Compte Portail RH) de la Fiche de position employé — `Onglet interne de la fiche employé — `da` (`innerHTML`)
- [ ] Organiser le menu latéral (Administration système) — réordonnancement dr — `admin/menu — dispatch: renderAdmin(view,` (`renderAdminSidebarMenu`) 🟠
- [ ] Organiser les compteurs (Administration système → réordonnancement du ba — `Hash route `#/admin/counters` → `renderA` (`renderAdminCountersMenu`) 🟠
- [ ] Panneau administration système (Admin System Dashboard) — hub d'administ — `admin/dashboard — dispatché par renderAd` (`renderAdminSystemDashboard`) 🟠
- [ ] Postes / Fonctions (Administration système — référentiel des postes/fonc — `Hash SPA `#/admin/postes` (sub="postes" ` (`renderAdminPostes`)
- [ ] Priorités (Administration système › Paramétrage › Priorités) — CRUD de r — `#/admin/priorites — dispatché par render` (`renderAdminPriorites`) 🟠
- [ ] Profils d'accès (niveaux) — Administration système — `admin/niveaux (dispatché par renderAdmin` (`renderAdminNiveaux`) 🟠
- [ ] Stockage PostgreSQL (nettoyage) — Administration système — `#/admin/storage — dispatché par renderAd` (`renderAdminStorage`) 🟠
- [ ] Synchronisation automatique (Administration système — paramétrage de l'a — `admin/sync — dispatché dans renderAdmin(` (`renderAdminSyncSettings`) 🟠
- [ ] Sécurité des accès (Administration système — Périmètres & sécurité) — `#/admin/access — dispatché par renderAdm` (`renderAdminAccessSecurity`) 🟠
- [ ] Utilisateurs (Administration système) — gestion des comptes SGDI — `Hash `#admin/users` → renderAdmin(view,'` (`renderAdminUsers`)
- [ ] Validation des sections candidat (Admin système) — page de configuration — `admin/sections_candidat — dispatché dans` (`renderAdminCandidatSections`) 🟠

### 13b-Rapports  (1)
- [ ] Rapports (synthèse RH) — `#/rapports` (`renderRapports`)

### 13c-Paramètres  (2)
- [ ] Journal de déverrouillage (complet) — `#/parametres/log` (`renderUnlockLog`) 🔴
- [ ] Paramètres (code de déverrouillage + journal récent) — `#/parametres` (`renderParametres`) 🟠

### 14-Infra transverse  (6)
- [ ] Bannière de mise à jour d'application (update-banner) — `sgdiCheckAppVersion` (`sgdiCheckAppVersion`)
- [ ] Barre de chargement de données (bandeau bas global, progression indéterm — `sgdiShowDataLoadingBar — n'est PAS une r` (`sgdiShowDataLoadingBar`)
- [ ] Bouton d'actualisation manuelle du workspace (barre d'onglets « chrome n — `refreshWorkspace (pas une route hash : c` (`refreshWorkspace`) 🟠
- [ ] ERP Ruban compteurs (bandeau KPI horizontal, sous la barre d'onglets, au — `Bandeau global non routé — injecté dans ` (`moduleCountersRibbonHTML`)
- [ ] Messagerie / dialogue interne (widget global overlay) — panneau MESSAGES — `Pas de route hash dédiée : overlay globa` (`dialogueBoxHTML`) 🟠
- [ ] Moteur i18n bilingue FR/AR (transverse — pas un écran distinct) — `N/A. Moteur global. Sélecteurs de langue` (`?`) 🟠

### 14b-Pages custom  (1)
- [ ] Rubrique personnalisée (page satellite créée depuis Administration systè — `#/custom/` (`renderCustomSidebarPage`) 🟠

---
Légende : 🔴 risque critique à corriger · 🟠 écriture snapshot → mutation REST + logique serveur · (rien) lecture/re-plomberie simple.