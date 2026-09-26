# Attendance Core — audit de base (avant développement)

Date : 2026-09-26 · Base : `origin/main` = `24dbf60` · Branche : `feat/iron-hr-attendance-v1`.
Toutes les affirmations ci-dessous proviennent du code de cette base ; les failles marquées
« prouvé » ont été reproduites par un test réel.

Classement : **EXISTANT** · **PARTIEL** · **MANQUANT** · **À CONSOLIDER** · **À ABANDONNER**.

---

## 1. Source de vérité de la présence

| Élément | Où | État | Commentaire |
|---|---|---|---|
| `DailyPresence` (`daily_presence`) | `app/modules/ops/models.py` | **EXISTANT — source canonique** | Une ligne par employé et par jour : `arrival_time`/`departure_time` (texte), `status`, `site_id`, `group_code`, `rotation_*`, `faction`, `closed_at`, `data` (JSON). Aucune contrainte d'unicité (employé, jour) en base. |
| Paie | `app/modules/payroll/service.py::compute_presence_variables` | **EXISTANT** | Lit **uniquement** les `DailyPresence` clôturées (`closed_at` non nul). Chaîne correcte, à conserver telle quelle. |
| Journal d'événements de pointage | collection JSON `attendanceQrScans` (table générique `sgdi_records`) | **À CONSOLIDER** | Seul historique arrivée/départ existant. Une ligne par scan, mais **relue et copiée intégralement** à chaque scan et à chaque affichage (7 lectures dans `portal/routes.py`) : coût qui croît sans fin. Pas de colonnes interrogeables (employé, site, date), pas de contrainte d'idempotence en base. |

## 2. Écrivains de `DailyPresence` (circuits à faire converger)

| Circuit | Code | Écrit comment | État |
|---|---|---|---|
| Pointeur (scan QR employé signé + saisie manuelle) | `portal/routes.py::_register_attendance` → `irongs/sql_bridge.py::upsert_presence` | Bascule arrivée/départ déduite de `attendanceQrScans` (cycle ouvert ≤ durée max, délai minimal avant nouvelle arrivée), heures sup. via `_authorized_work_minutes`, écrit une forme « legacy » (`heureArrivee = "P"`, heure réelle dans `data._legacy.scanArrivee`) | **À CONSOLIDER** — logique la plus complète, devient le noyau d'Attendance Core |
| Portail RH GPS | `POST /api/portal/pointages` | `upsert_presence` avec date/heure **fournies par le client** | **À ABANDONNER en l'état** — voir faille P0-1 |
| QR historique non signé | `POST /api/portal/pointage-qr` | `upsert_presence` | **À ABANDONNER en l'état** — voir faille P0-2 |
| Site Workforce / BEO | `site_workforce/routes.py` `POST /attendance`, `/attendance/close`, `/attendance/{id}/correct` | Écriture directe du modèle, statut saisi (présent/absent/congé/maladie/repos/mission), refus si clôturé, audit + notification | **À CONSOLIDER** — doit passer par Attendance Core (source `SITE_WORKFORCE`) |
| OPS génération planning | `ops/service.py::generate_rotation_daily_presence` | Crée les lignes « prévues » à partir des rotations (`generated=1`, `rotation_period`, horaires attendus dans `data`) | **EXISTANT** — c'est le planning ; réutilisé comme « prévu » |
| OPS génération simple / clôture / CRUD | `ops/routes.py` `/pointage/daily/generate`, `/close`, `POST`/`PATCH /pointage/daily` | Écriture directe | **À CONSOLIDER** — failles P1 ci-dessous |
| Pont legacy (écran ATLAS « feuille de présence ») | `irongs/sql_bridge.py::upsert_presence` via `/api/irongs/collections/feuillePresence` | Écriture directe depuis le frontend legacy | **PARTIEL** — reste le chemin de saisie legacy ; à router vers Attendance Core pour les écritures |

## 3. Planning

| Élément | État | Commentaire |
|---|---|---|
| `RotationTemplate` (`cycle_days` avec `start_time`/`end_time`, `group_offsets`) + `Assignment.rotation_id/group_code` | **EXISTANT** | Planning réel, configurable. `configured_rotation_for_date` donne jour travaillé / repos / période / horaires. |
| Régimes de site (`Site.rotation_system` : 24/48, 1/1, 1/2, 1/3, 3x8) | **EXISTANT** | Repli `rotation_for_date` quand aucun modèle configuré. |
| Durée autorisée | **EXISTANT** (`portal/routes.py::_authorized_work_minutes`) | À déplacer dans Attendance Core (une seule implémentation). |
| Congés / maladie / mission | **PARTIEL** | Statuts saisis dans `DailyPresence.status` (Site Workforce) et congés DRH (`/api/drh/leaves`) ; pas de croisement automatique avec le pointage. |
| Horaire codé en dur 08:00–17:00 | **Absent** (bon point) | Aucun horaire fixe trouvé ; conserver ce principe. |

## 4. Anomalies et alertes

| Élément | État |
|---|---|
| Détecteur « sortie manquante » (`alerts/detectors/missing_checkout.py`, lit `DailyPresence`) | **EXISTANT** |
| Alertes pointeur (`/api/portal/attendance-alerts`, heures sup.) | **PARTIEL** (calculées à la volée depuis `attendanceQrScans`) |
| Registre d'anomalies avec statut/sévérité/résolution/auteur | **MANQUANT** |
| Retard, absence, hors site, hors planning, visage inconnu, liveness, doublon facial | **MANQUANT** |

## 5. Applications et hosts

| Host | Sert | État |
|---|---|---|
| `pointeur.irongs.com` | `app/static/pointeur.html` (QR caméra/USB, saisie manuelle, flux live, planning, alertes, effectifs) | **EXISTANT** |
| `pointage.irongs.com` | **le même** `pointeur.html` (`main.py::_is_pointer_host`) | **À CONSOLIDER** — doit devenir le centre de contrôle, interface distincte |
| `beo.irongs.com` | portail Site Workforce | **EXISTANT** |
| DRH Next — entrée « Pointage » | écran « bientôt disponible » | **MANQUANT** (voir `docs/drh-next-unmerged-audit.md`) |
| Employé 360 — onglet Pointages / section Reconnaissance faciale | **MANQUANT** |

## 6. Photo employé (source d'enrôlement)

| Élément | État | Commentaire |
|---|---|---|
| Photo officielle | **EXISTANT** | Fichier `uploads/photos/<MATRICULE>.jpg`, référencé dans `Employee.extra["photo"]` (`core/photo_storage.py`). |
| Accès à la photo | **À CONSOLIDER (P1 biométrie)** | Servie publiquement par le montage statique `/uploads`, **sans authentification**, sous un nom prévisible (le matricule). Toute la base de photos — source de l'enrôlement — est donc récupérable par énumération, et réutilisable pour tenter une usurpation (photo imprimée / écran). |

## 7. Biométrie, caméras, consentement

| Élément | État |
|---|---|
| Reconnaissance faciale, liveness, templates | **MANQUANT** (aucun code, aucune dépendance) |
| Caméras / terminaux | **MANQUANT** (aucun modèle, aucun adaptateur) |
| Consentement biométrique | **MANQUANT** |
| Chiffrement au repos | **MANQUANT** — `cryptography` est déjà une dépendance (Fernet disponible) |

## 8. RBAC, audit, notifications

| Élément | État |
|---|---|
| Garde module par préfixe d'URL (`auth/dependencies.py::API_MODULE_PREFIXES`) — `/api/ops/pointage` ouvert à `ops`, `pointage`, `pointeur` | **EXISTANT** |
| Garde société (`SOCIETY_SCOPED_PREFIXES`) et action déduite de la méthode (`/close` ⇒ `validate`) | **EXISTANT** |
| Périmètre site d'un compte (`authorized_sites`, `_allowed_assignment_site_ids`) | **EXISTANT** |
| Audit (`core/audit.py::append_audit`) | **EXISTANT** — à utiliser pour chaque écriture Attendance |
| Notifications site (`SiteNotification`) | **EXISTANT** (BEO) |

## 9. Failles et dettes constatées

| ID | Gravité | Constat | Statut |
|---|---|---|---|
| P0-1 | Critique | `POST /api/portal/pointages` : aucune authentification, date/heure fournies par le client → présence antidatée pour n'importe quel matricule (**prouvé** : 201, `DailyPresence 2026-01-15 07:00 present`). | Corrigé sur une branche séparée `fix/portal-attendance-auth` (`6aef434`), à livrer indépendamment. |
| P0-2 | Critique | `POST /api/portal/pointage-qr` : authentification optionnelle, jeton QR = simple créneau horaire non signé (**prouvé** : 201 « PRÉSENT » sans connexion). | Idem `6aef434`. |
| P1-1 | Élevée | `POST /api/ops/pointage/daily/close` clôture **toutes** les présences d'une date, toutes sociétés et sites confondus, sans contrôle de périmètre. | À corriger dans Attendance Core (clôture par périmètre). |
| P1-2 | Élevée | `PATCH /api/ops/pointage/daily/{id}` modifie une présence **même clôturée** (donc déjà consommée par la paie), sans contrôle de site ni audit. | À corriger (correction tracée, post-clôture réservée). |
| P1-3 | Élevée | Photos employés publiques sous nom prévisible (§6). | À traiter dans le lot sécurité biométrique. |
| D-1 | Performance | `attendanceQrScans` relue intégralement à chaque scan / flux / statistique. | Remplacé par un journal d'événements indexé. |
| D-2 | Concurrence | Deux scans simultanés du même employé peuvent produire deux arrivées (aucun verrou) ; l'unicité du nonce QR repose sur un contrôle applicatif. | Idempotence en base (clé unique) + verrou de ligne. |
| D-3 | Cohérence | Formats hétérogènes dans `DailyPresence.arrival_time` : `"P"` (QR), `"HH:MM"` (portail, BEO). | Attendance Core écrit l'heure réelle ; compatibilité legacy conservée dans `data._legacy`. |

## 10. Décisions d'architecture

1. **`DailyPresence` reste l'unique journée de présence** (lue par la paie, BEO, OPS, alertes).
   Aucune table de présence parallèle.
2. **Journal `attendance_events` (append-only)** : nouvelle table justifiée par D-1/D-2 — elle
   remplace `attendanceQrScans` comme historique d'événements (colonnes indexées, clé
   d'idempotence unique), sans jamais être une seconde journée de présence. Les données
   historiques de `attendanceQrScans` sont reprises par la migration.
3. **`app/modules/attendance/core.py`** : seul point d'écriture. Pointeur, portail, BEO, OPS et
   reconnaissance faciale deviennent des *sources* (`QR`, `MANUAL`, `SITE_WORKFORCE`, `FACIAL`,
   `PORTAL_GPS`, `IMPORT`, `SYSTEM`).
4. **`attendance_anomalies`** : registre (type, sévérité, statut, résolution, auteur).
5. **Biométrie séparée** : consentement, templates chiffrés (Fernet), configuration de seuils
   versionnée, caméras (`CameraAdapter` → Dahua / RTSP générique), le tout désactivé par défaut
   et sans dépendance lourde dans l'image de production tant que la fonction n'est pas activée.
6. **Hosts** : `pointeur.irongs.com` = terminal ; `pointage.irongs.com` = centre de contrôle
   (nouvelle interface) ; tous deux sur la même API `/api/attendance`.
