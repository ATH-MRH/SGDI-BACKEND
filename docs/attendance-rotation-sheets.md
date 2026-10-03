# Feuilles de présence par rotation — Pointage & Planning intelligent V3, lot 1

## Trois notions à ne jamais confondre

| Notion | Table | Nature |
|---|---|---|
| **A. Événement de pointage** | `attendance_events` | Le FAIT (K162, 03/10/2026 14:32:26, ENTRÉE). Append-only, jamais réécrit. |
| **B. Feuille de présence** | `attendance_sheets`, `attendance_sheet_lines`, `attendance_sheet_events` | Regroupement opérationnel des faits pour UNE rotation d'UN site : une ligne par employé. |
| **C. Planning intelligent** | lots suivants | Modèle appris / prévisionnel. Ne réécrit jamais un événement. |

Attendance Core (`core.record_scan`) reste la seule autorité sur ENTRÉE / SORTIE / doublon.
La feuille est mise à jour APRÈS l'écriture du fait, dans un point de sauvegarde isolé : une
erreur de feuille est journalisée et n'empêche ni ne modifie le pointage.

## Paramètres par site (rien n'est codé en dur)

`attendance_rotation_settings` — un site sans ligne active n'a pas de feuille et garde le
comportement historique.

| Paramètre | Rôle | Valeur initiale proposée |
|---|---|---|
| `first_shift_time` | heure locale du premier poste | 06:00 |
| `shift_minutes` | durée nominale d'une rotation (doit diviser 24 h) | 480 (`ATTENDANCE_ROTATION_DEFAULT_SHIFT_MINUTES`) |
| `groups_count` | nombre de groupes attendu | 4 (`ATTENDANCE_ROTATION_DEFAULT_GROUPS`) |
| `early_margin_minutes` | arrivée anticipée rattachée à la rotation suivante | 60 (`ATTENDANCE_SHEET_EARLY_MARGIN_MINUTES`) |
| `version` | +1 à chaque changement de fenêtre ; copiée dans `attendance_sheets.planning_version` | 1 |

Ces valeurs initiales sont des réglages d'exploitation, non calibrés sur les données de
production : à ajuster site par site (Centre de contrôle → Feuilles de rotation → Paramètres
de rotation du site). Les feuilles déjà créées gardent leur fenêtre.

## Règles

1. **Fenêtre** : `first_shift_time + k × shift_minutes`, en heure du site (Africa/Algiers).
2. **ARRIVÉE** : rattachée à la rotation contenant l'instant, la marge d'anticipation avançant
   la frontière (13 h 10 pour un poste à 14 h, marge 60 ⇒ feuille 14 h–22 h).
3. **SORTIE** : rattachée à la ligne de SON entrée, même après la fin de la rotation ou minuit.
4. **Une feuille par (site, début de fenêtre)** : contrainte unique en base ; création
   idempotente (pointages simultanés prouvés sur PostgreSQL).
5. **Un employé = une ligne par feuille** (contrainte unique) : première entrée, dernière
   sortie, état, nombre d'événements, groupe déclaré au moment du pointage.
6. **Clôture** `OPEN → CLOSED` à la fin de la fenêtre, sans dépendre d'un cron : un seul
   `UPDATE` conditionnel, rejoué à chaque pointage, à chaque accès, et par l'orchestrateur.
7. **Archivage** `CLOSED → ARCHIVED` après `ATTENDANCE_SHEET_ARCHIVE_AFTER_HOURS` (36 h, au-delà
   du plus long cycle ouvert de 30 h) ; une entrée sans sortie y est constatée `DEPART_MANQUANT`.
8. **Groupe observé** d'une feuille = groupe déclaré majoritaire de ses lignes (explicable).
   `expected_group` reste vide : il relève de l'apprentissage (lots suivants).

## Interfaces

- `GET /api/portal/attendance-sheet?site_id=` — poste de pointage : feuille ACTIVE + arrivées
  anticipées de la rotation suivante. « Pointage en direct » n'affiche plus que cette feuille.
- `GET /api/attendance/sheets`, `GET /api/attendance/sheets/{id}` — historique DRH / OPS, avec
  les événements bruts rattachés.
- `GET /api/attendance/rotation-settings?site_id=`, `PUT /api/attendance/rotation-settings/{site_id}`
  — configuration (action « update », audit `attendance.rotation_settings`).

## Hors périmètre de ce lot

Apprentissage des groupes et score de confiance, cycle et projection, comparaison prévu / réel,
alertes de rotation (Pointeur, OPS, Centre d'alertes) et qualification OPS.
