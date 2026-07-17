# Architecture de reconstruction — Frontend SGDI/ATLAS

> Décisions d'architecture pour la reconstruction complète du frontend.
> Fondé sur `docs/RECONSTRUCTION-FRONTEND-SPEC.md` (149 écrans, 15 fonctionnalités, 273 endpoints).
> Principes directeurs : parité fonctionnelle totale · logique métier au backend · autorisation serveur réelle.

## 1. Socle technique

- **Vue 3 + Vite**, application **SPA compilée**, sortie **statique** servie par FastAPI (déploiement Coolify/tunnel **inchangé**, pas de serveur SSR).
- **Pinia** pour l'état applicatif (session, société active, permissions).
- **TanStack Query (Vue Query)** pour le cache de données serveur : dédup, invalidation ciblée, refetch en arrière-plan.
- **Vue Router** en mode hash (`#/...`) pour **conserver les URLs actuelles** (parité, favoris, liens).
- **TypeScript** progressif (au moins sur le client API et les modèles).
- PWA / service worker / offline **conservés**.

Justification : transition douce depuis le JS vanilla, énorme écosystème, excellent pour la fluidité ; pas de SSR à opérer.

## 2. Périmètre des applications

| App | Contenu | Techno |
|-----|---------|--------|
| **admin** (unifiée) | Back-office (sgdi-app.js) **+** ERP (erp-frontend.js) fusionnés — supprime le doublon SGDI/ERP et les tuiles dupliquées (MATERIEL/ACHATS, COMMERCIAL/VENTES, FINANCES/FACTURATION) | Vue 3 + Vite |
| **portail-mobile** | PWA self-service (pointage QR, Web Push, bilingue FR/AR, ronde) — public et appareil différents | Vue 3 + Vite (PWA) |
| **@sgdi/shared** | Design system, composants UI, client API, types, helpers (paie/dates/société) partagés par les deux apps | package interne (monorepo) |

## 3. Couche de données — FIN DU SNAPSHOT

- **Suppression** de `GET/PUT /api/irongs/db` (snapshot 26 Mo) + `hydrateDB` + `sgdiScheduleAutoRefresh`.
- Chaque écran charge **sa** donnée via des endpoints REST **paginés** (beaucoup existent déjà : `/drh/employees/page`, `/ops/pointage/daily/page`…).
- Cache client via Vue Query (staleTime par ressource) ; jamais toute la base en mémoire.
- Tables lourdes : **virtualisation** (défilement de milliers de lignes sans ramer).

## 4. Temps réel + notifications

- **SSE conservé** (`/api/irongs/events/stream`) mais **événements granulaires** : `{type:"employee.updated", id}` → invalide UNIQUEMENT la query concernée (plus de rechargement global).
- **Web Push** conservé (VAPID déjà en place) ; compléter les handlers `push`/`notificationclick` du service worker.
- **Garde d'édition conservée** : un événement temps réel ne réaffiche jamais par-dessus une saisie en cours.

## 5. Sécurité — autorisation serveur réelle (PRIORITÉ)

L'inventaire a établi que la sécurité actuelle est **quasi entièrement côté client**. La reconstruction impose :
- **Dépendance FastAPI `require(role, level, society)`** sur CHAQUE écriture (create/update/delete), pas seulement `current_user`.
- **Cloisonnement société côté serveur** : le paramètre `society` est validé contre les droits de l'utilisateur (jamais accepté tel quel).
- Les niveaux H1–H5 gouvernent **les actions**, pas seulement la visibilité des modules.
- Le front ne fait que de l'UX ; toute règle est revalidée serveur.

## 6. Logique métier au backend

Migrer côté serveur (sources de vérité uniques) :
- **Paie** : barème IRG, CNAS, exonération, abattement, formule bande 30001–35000.
- **Stock** : calcul du stock actuel (fin du double comptage).
- **Numérotation** : factures/devis/avoirs/matricules par **séquence serveur atomique** (fin des collisions `length+1`).
- **Facturation** : TVA/TTC/remise (corrige les bugs critiques de l'éditeur de facture : remise non persistée, prix mal parsé à l'impression, TVA perdue).
- **KPI dashboards** : agrégats serveur (`/api/dashboard/summary`, `/global`).
- **Statuts dérivés** (employé, facture) calculés serveur.

## 7. Design system

- Jeton de design (couleurs, espacements, typo) → thème « pro » cohérent, clair/sombre.
- Bibliothèque de composants construite EN PREMIER : modales (openModal/closeModal), tables paginées/triables, filtres, pickers, wizard, palette de commandes, toasts, cartes KPI, formulaires à label flottant, badges/pills de statut.
- Signature canvas, moteurs QR, impression/exports : composants dédiés réutilisables.

## 8. Migration — strangler (zéro coupure)

Ancien et nouveau frontend **coexistent** ; bascule module par module derrière le même backend, chaque module validé contre sa fiche d'inventaire (parité) + tests.

**Ordre** (issu de la passe 1) :
1. **Fondation** : scaffold Vite, design system, client API, auth/session, routing, garde de route/édition, écran de chargement — SANS toucher au snapshot.
2. Auth & Portails (login, select-societe, societe-portal, admin-system).
3. Incidents/Main courante (pilote de découplage, `/ops/events` existant).
4. Recrutement & candidats.
5. Effectif & agents.
6. Contrats + Congés & fiches.
7. Sites & pointage.
8. Matériel & équipement (résoudre le double comptage stock).
9. Paie (nécessite le nouveau backend paie).
10. Commercial.
11. Facturation / Finances (le plus couplé ; numérotation atomique ; corriger les bugs facture).
12. Portail RH & Web Push (+ PWA mobile en parallèle).
13. Administration.
14. Décommissionnement : suppression snapshot global, hydrateDB, auto-refresh/SSE global, code mort.

## 9. Vérification — reconstruction « bancaire »

Chaque écran reconstruit passe par : reconstruction → **vérification adversariale** (plusieurs agents comparent à la fiche d'inventaire : mêmes champs ? mêmes calculs ? même résultat au centime ?) → tests automatiques → bascule. C'est là qu'on met le plus d'agents (3–4 vérificateurs pour 1 constructeur).

## 10. Budget & cadence

Chantier mené **module par module, sur plusieurs sessions** (un module ~= une session, budget borné). L'inventaire détaillé rend chaque module **beaucoup moins cher** : les agents lisent la fiche de l'écran, pas 34 000 lignes.

---

## Prochaine étape immédiate : Phase 1 — Fondation

1. Scaffold monorepo (`apps/admin`, `apps/portail-mobile`, `packages/shared`) + Vite + Vue 3.
2. Client API typé (wrapper fetch + Bearer + gestion 401 → login).
3. Design tokens + 5–6 composants de base (bouton, input à label flottant, modale, table, toast, pill de statut).
4. Auth/session (login, select-societe, societe-portal) — 1er module fonctionnel bout-en-bout.
5. Intégration build → FastAPI sert le nouveau bundle sur une route de préversion (ex. `/v2`), l'ancien reste en place (strangler).
