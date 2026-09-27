# Revue de sécurité indépendante — Attendance V1

Méthode : relecture du code comme par un tiers, puis **preuves exécutées** (balayage automatique des
routes, sondes avec comptes réels, E2E hostile). Chaque défaut démontré a suivi : test → correction →
retest → commit.

## Défauts démontrés et corrigés

| # | Défaut | Preuve | Correctif |
|---|---|---|---|
| S1 | `POST /api/portal/pointages` et `/pointage-qr` : présence créée **sans authentification**, antidatée | 201 anonyme, `DailyPresence 2026-01-15` | `6aef434` (intégré à `main`) |
| S2 | Clôture OPS de **toutes** les sociétés/sites | test | Attendance Core, clôture par périmètre |
| S3 | `PATCH` OPS d'une journée **clôturée** (déjà lue par la paie), sans audit | test | 409 + correction tracée |
| S4 | Écran legacy : modification / suppression d'une journée clôturée | test | 409 via Attendance Core |
| S5 | Double scan → arrivée **puis** départ | test | anti-rebond + verrou + idempotence (courses PostgreSQL réelles) |
| S6 | Clé d'idempotence d'un autre employé → réponse avec ses données | test | 409 sans fuite |
| S7 | **Injection d'images** : la caméra « terminal » laissait le navigateur fournir les images de pointage (photo haute résolution acceptée par le liveness passif) | mesure moteur réel | images **toujours lues par le serveur** ; caméra terminal = enrôlement seulement ; images client ignorées/refusées |
| S8 | Lecture OPS des présences **d'autres sites** sans `site_id` ; génération pour tous les sites | sonde compte site A → employé site B visible | `ebe67c0` |
| S9 | Photos employés **publiques à nom prévisible** (`/uploads/photos/<MATRICULE>.jpg`) — source de l'enrôlement | GET anonyme → 200 | `4fbe974` : noms imprévisibles, migration (non exécutée), réglage de refus |
| S10 | Audit absent sur le catalogue caméra et les tests caméra ; URL RTSP (identifiants) possiblement journalisée par FFmpeg | relecture + test | `164841b` |

## Points vérifiés sans défaut

| Contrôle | Résultat |
|---|---|
| Routes anonymes (`/api/attendance`, `/api/biometrics`, `/api/portal/attendance*`, `/api/portal/pointage*`, `/api/ops/pointage*`, `/api/site-workforce`, `/api/irongs/collections`) | 79 routes balayées : 77 × 401/403 ; 2 × 400 (corps vide rejeté avant l'identité — avec un corps valide : 401, prouvé) |
| IDOR employé / présence / anomalie / caméra / gabarit | 404 hors périmètre (tests + E2E : employé forgé, caméra d'un autre site) |
| Scope société / site | module + société obligatoires sur les préfixes ; site dérivé des sites autorisés ou de la société |
| Écriture hors Attendance Core | aucune : pointeur, portail, BEO, OPS, écran legacy passent par le cœur ; génération planning = lignes prévues, jamais sur journée clôturée |
| Gabarit exposé | jamais dans une réponse, un journal, l'audit ou `Employee.extra` ; chiffré (Fernet) |
| Identifiants caméra exposés | jamais dans une réponse, l'audit ou le navigateur (E2E : aucune ressource hors ATLAS, mot de passe absent du DOM) |
| Consentement contournable | vérifié à l'enrôlement, à la revue de doublon ET à chaque reconnaissance ; retrait ⇒ désactivation |
| XSS | données serveur échappées dans le centre de contrôle, le terminal, DRH Next (tests dédiés) |
| Permissions biométriques | explicites uniquement (tests : un utilisateur DRH sans permission reçoit 403) |

## Risques résiduels (non corrigés, décision requise)

| Risque | Niveau | Recommandation |
|---|---|---|
| Liveness passif seul : résistance aux présentations physiques **non démontrée** ; simulations numériques non probantes | Élevé | Checklist terrain (`docs/attendance-hardware-checklist.md`), critère zéro acceptation ; capacité anti-fraude matérielle de la caméra si disponible |
| Photos existantes encore à nom prévisible tant que la migration n'est pas exécutée | Élevé | sauvegarde → `scripts/rename_public_photos.py` → `--apply` → `PHOTOS_REQUIRE_UNGUESSABLE_NAMES=true`, **avant** activation biométrique |
| URL-capacité de photo lisible par qui la possède | Moyen | protection par jeton des `<img>` (chantier transverse) |
| Enrôlement par caméra terminal : un opérateur habilité pourrait enrôler un visage substitué | Moyen | permission explicite, doublons, audit ; réserver la caméra terminal à des postes contrôlés |
| Pas de limitation de débit sur `/recognize` (3 captures + analyse par appel) | Faible | limiter par caméra si abus constaté |
| Clôture par ligne (une journée créée après clôture reste ouverte) | Faible | comportement historique ; la paie ne lit que les journées clôturées |
| Terminal déconnecté après 30 s sans passage (règle de sécurité existante) | Produit | décider d'un mode kiosque dédié pour les bornes faciales |
| Comptes à modules non configurés (`authorized_modules` NULL) : règle legacy par préfixe sur `pointage.irongs.com`, même administrateur | Info | comportement préexistant, hors périmètre |
