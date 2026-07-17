# Checklist de parité — Reconstruction Frontend SGDI/ATLAS

> Une case par écran (209) + fonctionnalités transverses. Cocher UNIQUEMENT quand l'écran reconstruit est **vérifié à parité** contre sa fiche `RECONSTRUCTION-FRONTEND-SPEC.md` :
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
- [ ] Cartes KPI DRH — Tableau de bord DRH « Synthèse générale » — `#/drh/dashboard (aussi #/drh sans sous-route, et tout sous-onglet DRH inconnu ` (`renderDRHDashboard`)
- [ ] Droits acquis congés (DRH) — écran « CONGÉS » du portail DRH — `#/drh/conges  (router: switch(root) case "drh" → renderDRH(view, sub\|\|"dashb` (`renderDRHCongesPersonnel`)
- [ ] Préparation opérationnelle (Employés non opérationnels + étapes bloquant — `#/effectif/preparation — dispatché par renderView() (sgdi-app.js:6875) : `case` (`renderOperationalPreparation`)
- [ ] Récapitulatif / Liste des effectifs (GRH — Gestion des effectifs) — `#/effectif (alias #/effectif/recap et #/effectif/<sous-filtre>) — dispatch rou` (`renderEffectif`) 🟠
- [ ] Éléments sortants (ÉLÉMENTS SORTANTS) — liste en lecture seule des emplo — `#/effectif/sortants (dispatch : sgdi-app.js:6875 — `case"effectif": ... else i` (`renderElementsSortants`)

### 01b-Tableaux de bord  (2)
- [ ] Situation générale — Groupe (tableau de bord consolidé multi-sociétés, l — `#/global-dashboard` (`renderGlobalDashboard`)
- [ ] Tableau de bord (Accueil) — renderDashboard — `#/dashboard (default route; also fallback for unknown roots via renderView swi` (`renderDashboard`)

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
- [ ] Candidats archivés (onglet "Archives" du hub Recrutement / Candidats) — `#/candidats_archives (liste) — #/candidats_archives/{id} délègue à renderCandi` (`renderRecrutement`)
- [ ] Candidats en réserve (liste + actions) — onglet "Réserve" du module Recr — `#/reserve  (dispatch ligne 8863 du switch de renderView : case "reserve" → si ` (`renderRecrutement`)
- [ ] Fiche candidat (dossier) — formulaire de dossier candidat en 2 étapes /  — `#/recrutement/{id} (alias exacts : #/reserve/{id}, #/candidats_archives/{id} p` (`renderCandidatForm`)
- [ ] Nouvelles candidatures (onglet "new" de l'écran unifié Recrutement / Can — `#/recrutement (alias équivalents : #/recrutement/liste, #/recrutement/candidat` (`renderRecrutement`)
- [ ] Réception demandes & réclamations (Demandes Personnel — Portail RH) — `#/demandes_personnel/dashboard (alias sub-route #/demandes_personnel/alertes ;` (`renderDemandesPersonnel`) 🟠

### 02-Recrutement & Demandes  (2)
- [ ] Demande structure — Réception / Envoi (liste) — `#/demandes_structure/reception` (`renderDemandesStructure`) 🔴
- [ ] Demande structure — Tableau de bord — `#/demandes_structure` (`renderDemandesStructureDashboard`) 🟠

### 03-Contrats  (6)
- [ ] Avenants au contrat (Contrats > Avenants) — `#/contrats/avenants — dispatché dans le routeur (sgdi-app.js:6868) via `case "` (`renderAvenants`)
- [ ] Nouveau contrat / Contractualisation (NOUVEAU CONTRAT APS) — création du — `#/contrats/nouveau/{candidatId} — routeur ligne 6865-6874 : `sub==="nouveau" &` (`renderContractualisation`) 🟠
- [ ] Nouveau contrat direct (pont) — page relais #/contrats/nouveau_contrat q — `#/contrats/nouveau_contrat (dispatch: sgdi-app.js:6870 `else if(sub==="nouveau` (`renderNouveauContratDirect`)
- [ ] Situation contrat (personnel) — liste analytique des contrats de travail — `#/contrats/situation (alias : #/contrats/clients — le routeur, sgdi-app.js:686` (`renderContrats`)
- [ ] Tableau de bord CONTRAT (module DRH) — 5 groupes de métriques cliquables — `#/contrats/dashboard (routeur: case "contrats" → sub==="dashboard" ⇒ renderCon` (`renderContratsDashboard`)
- [ ] À contractualiser (Contrats > Candidats retenus / Instance de signature) — `#/contrats/a_contractualiser — dispatché dans le switch du routeur (sgdi-app.j` (`renderContrats`) 🟠

### 04-Congés & Fiches  (6)
- [ ] Blocage "PostgreSQL obligatoire" — écran de garde plein écran (interstit — `Pas de route hash dédiée : c'est un intercepteur dans route() (ligne 6631). Or` (`renderPostgresRequired`) 🟠
- [ ] Création de badge (module Badges personnel, DRH) — `#/fiches/badge (alias: #/badge → renderFiches(view,"badge") → renderBadgeModul` (`renderBadgeModule`)
- [ ] Dossier administratif (archive des pièces) — `#/dossiers` (`renderDossiers`) 🔴
- [ ] Impression en lot des fiches de position — écran DRH permettant de coche — `#/fiches/imprimer — dispatché par renderView() (switch case "fiches", ligne 68` (`renderFichesImpression`)
- [ ] Situation des congés — `#/conges (dispatch: `case"conges":renderConges(view);break;` — sgdi-app.js:688` (`renderConges`) 🟠
- [ ] Vérification publique de badge (page publique plein écran affichée au sc — `#/badge/verify/:id — :id = référence employé, acceptée sous 3 formes (backendI` (`renderBadgeVerify`)

### 04b-Documents/Archives  (1)
- [ ] Documents / Archives (documents archivés par employé) — `#/documents` (`renderDocumentsArchives`) 🔴

### 05-Incidents/Main courante  (4)
- [ ] Main courante — Tableau de bord — `#/incidents/dashboard (router: `case"incidents": renderIncidents(view, sub\|\|` (`renderMainCouranteDashboard`)
- [ ] Main courante — Évènements autres — `#/incidents/autres (dispatch: `case"incidents":renderIncidents(view,sub\|\|"da` (`renderIncidents`)
- [ ] Main courante — Évènements site — `#/incidents/site (dispatch: `case"incidents":renderIncidents(view,sub\|\|"dash` (`renderIncidents`)
- [ ] Modal — Nouvel évènement (Main courante / Incidents) — `Modale ouverte par openIncidentModal(mode) (l.17404-17423). Appelée depuis 3 é` (`openIncidentModal`) 🟠

### 05b-Secrétariat  (5)
- [ ] Archives (liste) — `#/secretariat/archives` (`renderSecretariat`) 🔴
- [ ] Courriers (liste) — `#/secretariat/courriers` (`renderSecretariat`)
- [ ] Modal Nouveau courrier (création) — `#/secretariat/dashboard` (`openSecretariatCourrierModal`) 🟠
- [ ] Notes internes (liste) — `#/secretariat/notes` (`renderSecretariat`) 🔴
- [ ] Tableau de bord Secrétariat — `#/secretariat/dashboard` (`renderSecretariat`) 🟠

### 06-Sites & Pointage  (14)
- [ ] Encart évènements fiche Site (bloc "Main courante" — siteEvenementsHTML) — `app/static/sgdi-app.js l.16413 `siteEvenementsHTML(site)` — sous-bloc rendu à ` (`siteEvenementsHTML`) 🟠
- [ ] Modal — Détail évènement (Main courante) — `viewIncident(id) — app/static/sgdi-app.js l.17431-17446. Pas une route navigat` (`viewIncident`)
- [ ] Pointage — Archives (ARCHIVES POINTAGE) — écran de consultation 100% lec — `#/pointage/archives` (`renderPointageArchives`)
- [ ] Pointage — Feuille de présence quotidienne (FPQ) — `#/pointage/feuille (alias: #/pointage/scan est réécrit en "feuille" par render` (`renderFeuillePresentQR`) 🟠
- [ ] Pointage — Légende & codes (onglet "🎨 Légende & codes" du module Pointag — `#/pointage/legende — dispatché par route() (sgdi-app.js:6896) `case"pointage":` (`renderPointageLegende`)
- [ ] Pointage — QR par site (mur de QR codes de présence, un QR par site acti — `#/pointage/qr (onglet "qr" de POINTAGE_TABS, ligne 32816 : ["qr","📲 QR par sit` (`renderPointageQRGen`) 🟠
- [ ] Pointage — Récap par agent (récapitulatif mensuel jour par jour d'un age — `#/pointage/recap  et  #/pointage/recap/{agentId} — le routeur fait `const [roo` (`renderPointageRecap`)
- [ ] Pointage — Récap par société (onglet "🏢 Récap par société" du module Poi — `#/pointage/societe — dispatché par renderPointage(view, sub="societe") (C:\Use` (`renderPointageSociete`)
- [ ] Pointage — Saisie automatique (onglet "🤖 Saisie automatique" du module P — `#/pointage/auto — dispatché par renderPointage(view,sub,arg,_skipEnsure) (sgdi` (`renderPointageSaisieAuto`) 🟠
- [ ] Pointage — Saisie manuelle (grille mensuelle de pointage, 1 ligne par ag — `#/pointage/saisie — dispatché par renderPointage(view,sub,arg,_skipEnsure) (l.` (`renderPointageSaisie`)
- [ ] Pointage — Statistiques (onglet "📈 STATISTIQUES" du module Pointage) — `#/pointage/stats — dispatch: route() → renderPointage(view, sub="stats") (app/` (`renderPointageStats`)
- [ ] Pointage — Tableau de bord (renderPointageDashboard) — `#/pointage/dashboard — dispatché par le routeur central `case"pointage":render` (`renderPointageDashboard`) 🟠
- [ ] Sites — Fiche technique / Création de site — `#/sites/nouveau (création, id=null) — même fonction sert #/sites/{id\|backendI` (`renderSiteForm`)
- [ ] Sites — Tableau de bord — `#/sites (et alias #/sites/actifs — le menu pointe sur "sites/actifs"). Dispatc` (`renderSites`)

### 06b-OPS  (6)
- [ ] OPS — Employés en instance de dotation (suivi) — `#/ops/instance_dotation` (`renderOpsInstanceDotation`)
- [ ] OPS — Missions (ordres de mission) — `#/ops/missions` (`renderOpsMissions`) 🟠
- [ ] OPS — Mouvements (ordres de mouvement) — `#/ops/mouvements` (`renderOpsMouvements`) 🟠
- [ ] OPS — QR Présence (générateur QR par site) — `#/ops/qr` (`renderOPS`)
- [ ] OPS — Supervision site (inspections) — `#/ops/supervision` (`renderOpsSupervision`) 🟠
- [ ] OPS — Tableau de bord — `#/ops/dashboard` (`renderOPS`) 🟠

### 07-Paie  (6)
- [ ] Aperçu / Impression fiche de paie (bulletin de paie SGDI) — document en  — `Pas de route dédiée : overlay (modale) sans hash. Déclenché depuis deux écrans` (`paieFicheHTML`) 🟠
- [ ] Dossier salaire employé (Paie / fiche salariale d'un employé) — `#/paie/agent/:id — dispatché par renderView() (switch case "paie" → renderPaie` (`renderPaieAgent`)
- [ ] Modale "Nouvelle rubrique de paie" (openPaieRubriqueModal) — création d' — `#/paie/dashboard → <details> "Rubriques de paie paramétrables" → bouton "Ajout` (`openPaieRubriqueModal`) 🟠
- [ ] Modale « Nouvelle grille salariale par fonction » (Grille salariale) — m — `Ouverte depuis la vue `paie/dashboard` (renderPaie, sgdi-app.js l.24627) via l` (`openPaieGrilleModal`) 🟠
- [ ] Modale « Éléments de paie » (éléments variables du mois pour un employé) — `Pas une route hash : modale ouverte via onclick depuis 3 points d'entrée — (1)` (`openPaieElementsModal`) 🟠
- [ ] Tableau de bord Paie — écran principal du module Paie (calcul paie Algér — `#/paie/dashboard — routeur ligne 6899 : case "paie": renderPaie(view, sub\|\|"` (`renderPaie`) 🟠

### 08-Matériel  (20)
- [ ] Alertes stock (Matériel &gt; Alertes) — `#/materiel/alertes — dispatché par renderMateriel(view,sub,arg) ligne 19374 de` (`renderMatSimpleAlertesServer`)
- [ ] Article legacy unitaire — formulaire de création/édition d'un article ma — `#/materiel/nouveau (création) — variante d'édition #/materiel/edit/:id. Dispat` (`renderMaterielForm`) 🟠
- [ ] Catalogue / Articles (liste du catalogue materiel) — `#/materiel/articles (alias #/materiel/catalogue). Dispatch dans renderMateriel` (`renderMatSimpleArticles`)
- [ ] Entrée/Sortie stock (modaux) — une seule modale paramétrée par `type` (' — `#/materiel/entree-stock · alias #/materiel/sortie-stock` (`openModal`) 🔴
- [ ] Fiche article (détail) — Matériel / Stock — `#/materiel/article/:id  (dispatch: `if(sub==="article"&&arg){return renderStoc` (`renderStockArticleDetail`)
- [ ] Fiches de position (contexte matériel) — `#/materiel/fiches — dispatch: router `case"materiel"` (sgdi-app.js:6886) -> re` (`renderFiches`)
- [ ] Formulaire article (Nouvel article au catalogue / Modifier l'article) —  — `#/materiel/article-nouveau (création) et #/materiel/article-edit/:id (édition)` (`renderStockArticleForm`) 🟠
- [ ] Formulaire fournisseur (Nouveau / Modifier) — module Matériel — `#/materiel/fournisseur-nouveau (création, id=null) et #/materiel/fournisseur-e` (`renderMatSimpleFournisseurForm`) 🟠
- [ ] Formulaire magasin (Nouveau / Modifier magasin) — création/édition d'un  — `#/materiel/magasin-nouveau (création, id=null) et #/materiel/magasin-edit/:id ` (`renderMatSimpleMagasinForm`) 🟠
- [ ] Fournisseur (détail) — vue lecture seule d'un partenaire achats matériel — `#/materiel/fournisseur/:id` (`renderMatSimpleFournisseurDetail`)
- [ ] Fournisseurs (liste) — module Materiel/Equipement — `#/materiel/fournisseurs (dispatch au routeur ligne 19362: sub==="fournisseurs"` (`renderMatSimpleFournisseurs`)
- [ ] Inventaire général (module Matériel — vue stock consolidée tous magasins — `#/materiel/inventaire — dispatch: `case"materiel":renderMateriel(view,sub\|\|"` (`renderMatSimpleInventaire`)
- [ ] Magasin (détail) — fiche d'un magasin/lieu de stockage du module Matérie — `#/materiel/magasin/:id  (dispatch dans renderMateriel(view,sub,arg) — app/stat` (`renderMatSimpleMagasinDetail`)
- [ ] Magasins (liste) — Module Matériel & Équipement — `#/materiel/magasins (dispatch: router `case "materiel": renderMateriel(view, s` (`renderMatSimpleMagasins`)
- [ ] Mouvements de stock (Matériel → Mouvements) — `#/materiel/mouvements — dispatché par renderMateriel(view, sub="mouvements") à` (`renderMatSimpleMouvements`) 🔴
- [ ] Nouvelle dotation (Dotation matériel employé / site / structure) — `#/materiel/dotation` (`renderMatSimpleDotation`)
- [ ] Reversement — "ÉQUIPEMENT / MATÉRIEL EN INSTANCE DE REVERSEMENT" (module — `#/materiel/reversement — dispatché dans le routeur matériel: `if(sub==="revers` (`renderMatSimpleReversement`)
- [ ] SITE EN ATTENTE DE DOTATION (Sites actifs sans dotation matériel enregis — `#/materiel/sites-dotation — dispatché dans le routeur matériel: `if(sub==="sit` (`renderMatSitesEnAttenteDotation`)
- [ ] Stats stock pro — "Matériel & Équipement › Statistiques" (onglet Statist — `#/materiel/stats (alias exact: #/materiel/statistiques). Routeur: switch(root)` (`renderStockProMain`) 🔴
- [ ] Tableau de bord matériel (MATÉRIEL — Tableau de bord) — `#/materiel/dashboard (alias : #/materiel sans sous-route ; toute sous-route ma` (`renderMatSimpleDashboard`)

### 09-Commercial  (11)
- [ ] Client — Fiche/éditeur (openClientModal) — malgré son nom, ce N'EST PAS  — `openClientModal(id, readOnly) — pas de route hash propre. Points d'entrée : (1` (`openClientModal`)
- [ ] Commercial — Calendrier (titre affiché: 'Calendrier Commercial') — `#/commercial/calendrier — routeur ligne 6892: case 'commercial' -> renderComme` (`renderCommCalendrier`) 🟠
- [ ] Commercial — Catalogue prestations — `#/commercial/catalogue — dispatché dans renderCommercial(view, sub, arg) : if(` (`renderCommCatalogue`) 🟠
- [ ] Commercial — Clients (liste) — `#/commercial/clients — dispatché par renderCommercial(view, sub, arg) ligne 25` (`renderCommClients`)
- [ ] Commercial — Devis (liste + éditeur plein écran + 3 modales outils) — `#/commercial/devis — dispatch: renderCommercial(view,sub,arg) (sgdi-app.js:259` (`renderCommDevis`) 🟠
- [ ] Commercial — Opportunités (pipeline commercial : liste, création, change — `#/commercial/opportunites — dispatch : renderView() switch case "commercial" (` (`renderCommOpportunites`)
- [ ] Commercial — Prospects (liste + création + conversion) — `#/commercial/prospects — routeur: renderView() (sgdi-app.js:6831) découpe le h` (`renderCommProspects`)
- [ ] Commercial — Statistiques commerciales (📈), read-only analytics dashboar — `#/commercial/stats — parsed in renderView() (sgdi-app.js:6849-6857 `path.split` (`renderCommStats`)
- [ ] Commercial — Tableau de bord — `#/commercial/dashboard (dispatch: renderView() switch case "commercial" → rend` (`renderCommDashboard`)
- [ ] Commercial — Tarification (vue par catégorie, LECTURE SEULE) — `#/commercial/tarifs — dispatché par renderCommercial(view, sub, arg) (sgdi-app` (`renderCommTarifs`) 🟠
- [ ] Commercial — Visites / Suivi (titre H1: "📞 Visites / Suivi", sous-titre  — `#/commercial/visites — dispatcher `case "commercial"` (sgdi-app.js:6892) → ren` (`renderCommVisites`) 🟠

### 10-Facturation/Finances  (17)
- [ ] Client — Fiche imprimable (aperçu client en pop-up imprimable) — `openClientDetail(id) — pas une route hash. Écran ouvert dans une NOUVELLE FENÊ` (`openClientDetail`)
- [ ] Facturation — Avances clients — `#/facturation/avances (dispatché par renderFacturation(view, sub, arg) → `if(s` (`renderFactAvances`) 🟠
- [ ] Facturation — Avoirs (liste des notes de crédit émises sur factures) — `#/facturation/avoirs — dispatch: renderFacturation(view, sub="avoirs", arg) → ` (`renderFactAvoirs`) 🟠
- [ ] Facturation — Balance âgée des créances — `#/facturation/balance (router: switch on root "facturation" → renderFacturatio` (`renderFactBalance`) 🟠
- [ ] Facturation — Caisse — `#/facturation/caisse (dispatch: renderFacturation(view, sub) → sub === "caisse` (`renderFactCaisse`) 🟠
- [ ] Facturation — Catégories de prestation — `#/facturation/categories (router: renderView() splits location.hash into [root` (`renderFactCategories`) 🟠
- [ ] Facturation — Clients (lecture seule) — `#/facturation/clients — dispatch renderFacturation(view, sub, arg) sgdi-app.js` (`renderFactClients`)
- [ ] Facturation — Compte client (relevé de compte client : factures + histor — `#/facturation/compte/<clientNom-encodé-URI> — parsé par `const [root,sub,arg]=` (`renderFactCompteClient`)
- [ ] Facturation — Devis — `#/facturation/devis (dispatch: renderFacturation(view, sub="devis", arg) at sg` (`renderFactDevis`) 🟠
- [ ] Facturation — Factures (liste) — `#/facturation/factures — routeur `renderView()` (sgdi-app.js:6849 lit `locatio` (`renderFactureListPage`) 🟠
- [ ] Facturation — Paiements (« 💳 Paiements reçus ») — `#/facturation/paiements — dispatch : renderView() switch case "facturation" (s` (`renderFactPaiements`) 🟠
- [ ] Facturation — Situation paiements (Situation des paiements par client) — `#/facturation/situation → renderFacturation(view, "situation", arg) → renderFa` (`renderFactSituation`)
- [ ] Facturation — Stock (vue financière) — `#/facturation/stock — dispatch: route() (sgdi-app.js:6631) → case "facturation` (`renderFactStock`)
- [ ] Facturation — Structures clients (référentiel des structures/typologies  — `#/facturation/structures — dispatch: renderView() (sgdi-app.js:6849-6857) déco` (`renderFactStructures`) 🟠
- [ ] Facturation — Tableau de bord — `#/facturation/dashboard (dispatch: case "facturation" -> renderFacturation(vie` (`renderFactDashboard`) 🟠
- [ ] Facturation — Thèmes (référentiel des thèmes de prestation/facture) — `#/facturation/themes — dispatché par renderView() (switch case"facturation" → ` (`renderFactThemes`) 🟠
- [ ] Facture — Éditeur (création/modification d'une facture client) — `#/facturation/factures avec le flag global window.__factureEditId défini (sino` (`renderFactureEditor`) 🔴

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
- [ ] ERP Achats (module ATLAS ERP « Achats & Fournisseurs ») — 5 sous-écrans  — `#/achats (défaut sub=dashboard) — sous-routes: #/achats/dashboard, #/achats/fo` (`renderAchats`)
- [ ] ERP Comptabilité (module ATLAS ERP « accounting ») — 4 onglets : Tableau — `#/accounting[/<sub>] où sub ∈ {dashboard (défaut), comptes, ecritures, balance` (`renderAccounting`)
- [ ] ERP Reporting (ATLAS ERP) — tableau de bord analytique consolidé, lectur — `#/reporting  (et #/reporting/<sub> — sub ∈ dashboard \| ventes \| achats \| tr` (`renderReporting`)
- [ ] ERP Ventes (ATLAS ERP — Ventes & Clients) — `#/ventes  → aussi #/ventes/dashboard, #/ventes/devis, #/ventes/commandes, #/ve` (`renderVentes`)
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

### 12-Portail RH & Mobile  (21)
- [ ] Accueil / Pointage rapide (tab-home) — `switchTab('home') → #tab-home (L976). Ajoute classe home-mod` (`renderHomeTab`)
- [ ] Auth — Connexion (login) — `Pas de hash. #authView > .auth-form#form-login (active par d` (`?`) 🟠
- [ ] Auth — Créer un compte (self-register) — `#authView > .auth-form#form-signup (L869). Affiché par showA` (`?`)
- [ ] Auth — Réinitialiser le mot de passe (reset) — `#authView > .auth-form#form-reset (L907). Affiché par showAu` (`?`)
- [ ] Boîte de réception (tab-reception) — `switchTab('reception') → #tab-reception (L1544) ; renderInbo` (`renderInbox`)
- [ ] Changer le mot de passe (modal) — `Modal #pwdModal (L1665-1691). Ouvert par openChangePassword(` (`openChangePassword`)
- [ ] Comptes Portail RH — `#/portail/comptes — dispatché ligne 6883: `case"portail": if(sub==="comptes") ` (`renderPortailComptes`)
- [ ] Contrôle de ronde — portail (tab-ronde) — `switchTab('ronde') → #tab-ronde (L1065) ; ajoute portail-mod` (`?`) 🟠
- [ ] Documents (tab-documents) — `switchTab('documents') → #tab-documents (L1507) ; renderDocu` (`renderDocuments`) 🟠
- [ ] Historique / Mes demandes (tab-historique) — `switchTab('historique') -> #tab-historique` (`renderHistory`)
- [ ] Menu Portail (tab-portail) — `switchTab('portail') → #tab-portail (L1035). Ajoute portail-` (`?`)
- [ ] Module-Portal (portail de sous-domaine / module-host) — grille des rubri — `#/module-portal (alias captés par le même rendu : "" , #/login, #/select-socie` (`renderModuleHostPortal`)
- [ ] Nouvelle demande — 7 types (tab-nouvelle) — `switchTab('nouvelle') → #tab-nouvelle (L1146). Barre .tabs v` (`?`) 🟠
- [ ] Pointage QR — jetons éphémères (tab-pointage, carte QR) — `Même #tab-pointage, carte #qr-scan-card (L1467-1476). Lib Ht` (`?`)
- [ ] Pointage manuel / GPS (tab-pointage, cartes manuelle + historique) — `switchTab('pointage') → #tab-pointage (L1465) ; renderPointa` (`renderPointage`)
- [ ] Portail RH (vue DRH) — réception, suivi et traitement des demandes / réc — `#/portail — dispatch l.6883: case 'portail': if(sub==='comptes') renderPortail` (`renderPortailPersonnel`) 🟠
- [ ] Portail RH personnel (self-service employé) — `#/portail — branche employé de `renderPortailPersonnel(view)`. Routeur (sgdi-a` (`renderPortailPersonnel`) 🟠
- [ ] Portail mobile self-service RH (PWA bilingue FR/AR). SPA autonome, indep — `` (`renderHistory`)
- [ ] Portail société (Company portal) — hub de lancement des modules pour la  — `#/societe-portal (et #/dashboard quand une société est active sans module tran` (`renderSocietePortal`)
- [ ] Profil (tab-profil) — ORPHELIN (aucune navigation) — `switchTab('profil') → #tab-profil (L1559) mais AUCUN appelan` (`saveProfile`) 🔴
- [ ] Web Push VAPID + Service Worker (carte Notifications de Profil + portail — `Carte #notif-card dans #tab-profil (L1615-1621) ; SW enregis` (`?`)

### 13-Administration  (31)
- [ ] Accès sociétés (libres) — "🏢 Accès sociétés libres" (Administration syst — `#/admin/access_societes` (`renderAdminAccessSocietes`) 🟠
- [ ] Administration système (sous-flux du login) — `#/login (page login + modale "Administration système") puis #/admin/dashboard` (`renderLogin`)
- [ ] Alertes — Configuration des alertes (Admin) — `#/admin/alertes` (`renderAdminAlertes`) 🟠
- [ ] Articles / Catalogue (admin système) — Administration système > Articles — `#/admin/catalogue` (`renderAdminCatalogue`) 🟠
- [ ] Champs personnalisés (Admin > Custom Fields) — `#/admin/champs` (`renderAdminChamps`) 🟠
- [ ] Cockpit Direction Générale (tableau de bord Administrateur général) — `#/admin/dashboard` (`renderAdminDashboard`)
- [ ] Contrats du personnel (modèles Word) — Administration système > CONTRAT — `#/admin/contrats` (`renderAdminContratsPersonnel`)
- [ ] Droits techniques avancés (matrice module × type de compte) — Administra — `#/admin/droits` (`renderAdminDroits`)
- [ ] Fiche de position (Administration système) — liste/maintenance des fiche — `#/admin/fiches` (`renderAdminFichesPosition`)
- [ ] Fiche de position employé (agent form) — `#/effectif/agent/:id · alias #/agents/:id` (`renderAgentForm`)
- [ ] Fiches de position (annuaire) — liste/annuaire des employés avec cartes  — `#/fiches (alias #/fiches/toutes). Sous-routes gérées par le même dispatcher `c` (`renderFiches`)
- [ ] Fil d'actualité admin (Administration — Fil d'actualité) — `#/admin/feed` (`renderAdminFeed`) 🟠
- [ ] Gestion des candidats (nettoyage) — Administration système — `#/admin/candidats` (`renderAdminCandidats`)
- [ ] Gestion des effectifs (config) — Administration système — `#/admin/effectifs` (`renderAdminEffectifsConfig`) 🟠
- [ ] Historique des messages et pièces jointes (Administration → HISTORIQUE M — `#/admin/messages` (`renderAdminMessagesHistory`)
- [ ] Journal d'activité (Admin → Journal d'activité) — écran d'audit en lectu — `#/admin/log` (`renderAdminLog`) 🟠
- [ ] Magasins — suppression centralisée (Administration système) — `#/admin/magasins` (`renderAdminMagasins`)
- [ ] Modules personnalisés (Admin › Modules) — CRUD déclaratif de "modules mé — `#/admin/modules` (`renderAdminModules`) 🟠
- [ ] Modèles documents (Administration système → Bibliothèque centrale des mo — `#/admin/document-models` (`renderAdminDocumentModels`) 🟠
- [ ] Onglet "Portail RH" (Compte Portail RH) de la Fiche de position employé — `Onglet interne de la fiche employé — `data-fp-tab-panel="portail"` / bouton `d` (`innerHTML`)
- [ ] Organiser le menu latéral (Administration système) — réordonnancement dr — `#/admin/menu` (`renderAdminSidebarMenu`) 🟠
- [ ] Organiser les compteurs (Administration système → réordonnancement du ba — `#/admin/counters` (`renderAdminCountersMenu`) 🟠
- [ ] Panneau administration système (Admin System Dashboard) — hub d'administ — `#/admin/dashboard` (`renderAdminSystemDashboard`) 🟠
- [ ] Postes / Fonctions (Administration système — référentiel des postes/fonc — `#/admin/postes` (`renderAdminPostes`)
- [ ] Priorités (Administration système › Paramétrage › Priorités) — CRUD de r — `#/admin/priorites` (`renderAdminPriorites`) 🟠
- [ ] Profils d'accès (niveaux) — Administration système — `#/admin/niveaux` (`renderAdminNiveaux`) 🟠
- [ ] Stockage PostgreSQL (nettoyage) — Administration système — `#/admin/storage` (`renderAdminStorage`) 🟠
- [ ] Synchronisation automatique (Administration système — paramétrage de l'a — `#/admin/sync` (`renderAdminSyncSettings`) 🟠
- [ ] Sécurité des accès (Administration système — Périmètres & sécurité) — `#/admin/access` (`renderAdminAccessSecurity`) 🟠
- [ ] Utilisateurs (Administration système) — gestion des comptes SGDI — `#/admin/users` (`renderAdminUsers`)
- [ ] Validation des sections candidat (Admin système) — page de configuration — `#/admin/sections_candidat` (`renderAdminCandidatSections`) 🟠

### 13b-Rapports  (1)
- [ ] Rapports (synthèse RH) — `#/rapports` (`renderRapports`)

### 13c-Paramètres  (2)
- [ ] Journal de déverrouillage (complet) — `#/parametres/log` (`renderUnlockLog`) 🔴
- [ ] Paramètres (code de déverrouillage + journal récent) — `#/parametres` (`renderParametres`) 🟠

### 14-Infra transverse  (6)
- [ ] Bannière de mise à jour d'application (update-banner) — `sgdiCheckAppVersion` (`sgdiCheckAppVersion`)
- [ ] Barre de chargement de données (bandeau bas global, progression indéterm — `sgdiShowDataLoadingBar — n'est PAS une route hash (#/...) : aucune entrée dans` (`sgdiShowDataLoadingBar`)
- [ ] Bouton d'actualisation manuelle du workspace (barre d'onglets « chrome n — `refreshWorkspace (pas une route hash : contrôle global persistant, rendu dans ` (`refreshWorkspace`) 🟠
- [ ] ERP Ruban compteurs (bandeau KPI horizontal, sous la barre d'onglets, au — `Bandeau global non routé — injecté dans le shell (ligne 5148, `${moduleCounter` (`moduleCountersRibbonHTML`)
- [ ] Messagerie / dialogue interne (widget global overlay) — panneau MESSAGES — `Pas de route hash dédiée : overlay global rendu à chaque render() (app/static/` (`dialogueBoxHTML`) 🟠
- [ ] Moteur i18n bilingue FR/AR (transverse — pas un écran distinct) — `N/A. Moteur global. Sélecteurs de langue: header auth (L833-` (`?`) 🟠

### 14b-Pages custom  (1)
- [ ] Rubrique personnalisée (page satellite créée depuis Administration systè — `#/custom/` (`renderCustomSidebarPage`) 🟠

---
Légende : 🔴 risque critique à corriger · 🟠 écriture snapshot → mutation REST + logique serveur · (rien) lecture/re-plomberie simple.