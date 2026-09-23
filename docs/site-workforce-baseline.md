# ATLAS Site Workforce — audit de base (§B1)

Base : `origin/main` @ `f2bce53` (Finance V2 intégrée). Aucun contrat API supposé — chaque
table/route ci-dessous a été lue dans le code, pas devinée.

## Modèles existants réutilisables (aucune migration requise pour ces domaines)

| Domaine mission | Table réelle | Fichier | Notes |
|---|---|---|---|
| Personnel | `employees` | `app/modules/drh/models.py` | `society` = colonne texte directe. Pas de `site_id` direct — le site vient de `Assignment`. |
| Site | `sites` | `app/modules/ops/models.py` | **Pas de colonne `society`** — la société d'un site est dérivée de `site.equipment_plan["societe"/"society"]` (pont legacy, voir `ops/routes.py:_site_society`). Convention réutilisée telle quelle, pas réinventée. |
| Affectation | `assignments` | `ops/models.py` | `employee_id`, `site_id`, `group_code`, `start_date`/`end_date`/`active` — source de vérité "qui est sur quel site aujourd'hui". |
| Pointage | `daily_presence` | `ops/models.py` | Déjà un statut quotidien par employé/site/date (`status`, `arrival_time`, `closed_at`, `notes`, `data` JSON) — exactement le modèle attendu par §B8, rien à créer. |
| Congés + Maladies | `leaves` | `drh/models.py` | `leave_type` libre (`"conge"` / `"maladie"` observés) — §B11/§B12 se distinguent par valeur de `leave_type`, pas par table séparée. |
| Discipline | `sanctions` | `drh/models.py` | `infraction_date`, `site_id`, `fault`, `sanction_type` — proche de §B13 mais sans statut de workflow (Brouillon/Signalé/Transmis/…) : à ajouter en JSON `data`-like ou via `Transmission` (voir plus bas), jamais en dupliquant la table. |
| Justificatifs (documents) | `documents` | `drh/models.py` | `owner_type`/`owner_id` polymorphe déjà utilisé pour `"employee"` — réutilisé avec `owner_type="leave"` / `"sanction"` / `"reclamation"` pour rattacher un justificatif à son dossier source, jamais dupliqué. |
| Audit | `audit_events` | `auth/models.py` + `app/core/audit.py::append_audit()` | Append-only (trigger SQLAlchemy interdisant update/delete), déjà utilisé par tout le backend (`authorization.*`, etc.) — §B18 réutilise ce mécanisme, aucune nouvelle table d'audit. |

## Modèles absents — nécessitent une migration

Aucune table existante ne couvre : réclamations (workflow dédié), transmission générique
(destinataire/priorité/statut, réutilisable sur plusieurs types de dossier sans dupliquer
chacun), et notifications ciblées site. Trois tables neuves, additives uniquement :

- `reclamations` — dossier réclamation (workflow Nouvelle → Clôturée).
- `transmissions` — polymorphe (`resource_type`, `resource_id`), réutilise l'objet source
  (§B16 : "ne pas dupliquer le dossier") pour Sanction/Reclamation/Leave/Document.
- `site_notifications` — notifications scopées site (§B17), distinctes du moteur `alerts`
  existant (`app/modules/alerts/models.py`) qui est un moteur de détection/fraude à
  règles — un domaine fonctionnel différent, pas réutilisable ici sans le dénaturer.

## RBAC — infrastructure déjà en place, à étendre (pas à réinventer)

- `User.authorized_sites: list[int]` (`auth/models.py:21`) — **déjà présent**, déjà utilisé
  par le rôle "superviseur terrain" (`ops/routes.py`) pour une liste de sites. Le rôle
  `CHARGE_EFFECTIFS_SITE` en est un cas plus strict : **exactement un** site, jamais zéro,
  jamais plusieurs (§B2) — nouvelle garde dédiée, pas une modification du champ existant.
- Pipeline d'autorisation actif et confirmé dans `auth/dependencies.py::current_user` :
  auth → actif → `enforce_module_access` (permission, `authorized_modules` +
  `API_MODULE_PREFIXES`) → `SOCIETY_SCOPED_PREFIXES` (société) → `authorized_actions`
  (action). Le contrôle de site n'est PAS centralisé ici — chaque module scopé-site
  (`ops/routes.py`) l'applique localement (`_ensure_site_allowed`) : même approche reprise
  pour `site_workforce`, avec la garde "un seul site" en plus.
- `app/core/scope_policy.py` — résolution canonique de société (`society_scope`,
  `effective_society_values`, `society_key`) déjà utilisée par plusieurs modules récents
  (`erp/service.py`) : réutilisée directement plutôt que de recréer un second mécanisme de
  normalisation de société (l'ancien `_normalize_society` local d'`ops/routes.py` est une
  duplication antérieure à ce module central — pas reproduite ici).
- `permission_catalog.py` (`CANONICAL_MODULES`) est **explicitement un catalogue inerte**
  ("ne branche aucune règle sur les endpoints existants") — la clé de module réellement
  active est `User.authorized_modules` (texte libre) + `API_MODULE_PREFIXES`, exactement le
  mécanisme utilisé par Finance V2 (`"finances"`, absent lui aussi de ce catalogue). Nouvelle
  clé libre `"site_workforce"`, même convention.

## Décision d'architecture

Nouveau module `app/modules/site_workforce/` (routes/service/schemas/models), **sans
modifier `drh/routes.py` ni `ops/routes.py`** — lit/écrit les tables existantes
(`Employee`, `Assignment`, `DailyPresence`, `Leave`, `Sanction`, `Document`) avec ses PROPRES
routes et sa propre garde "un seul site + société imposée", au lieu de percer les routes DRH/
OPS existantes avec un cas particulier. Limite le risque de régression sur le périmètre déjà
en production et garde Chantier B isolé de tout code déjà livré, conformément à la règle de
non-mélange de la mission.
