# Socle officiel du travail posté 24h/24 (lot 0)

## Principe

Le **régime de travail** est une donnée explicite portée par l'**affectation**
(`assignments.work_regime`) : un employé peut être posté sur un site, puis en horaire normal sur un
autre. Il n'est jamais déduit du poste, de `group_code` seul, de `sites.rotation_system`, des
pointages ni du Planning intelligent.

| Valeur | Libellé | Effet |
|---|---|---|
| `NULL` | (affectation historique) | comportement existant strictement inchangé |
| `NORMAL` | Horaire normal | hors moteur du travail posté |
| `POSTE_CONTINU` | Travail posté 24h/24 | planning officiel : groupe + modèle explicites |

Une affectation `POSTE_CONTINU` nomme explicitement son groupe (`group_code` ∈ A/B/C/D) et son
modèle officiel (`rotation_id` → `rotation_templates.official = 1`). Contraintes en base
(`ck_assignments_work_regime`, `ck_assignments_posted_explicit`) et validation API (422).

## Modèle officiel `3X8-CONTINU-2222`

Cycle de 8 jours : J1-J2 `MATIN` 06:00→14:00 · J3-J4 `APRES_MIDI` 14:00→22:00 · J5-J6 `NUIT`
22:00→06:00 · J7-J8 `OFF`. Chaque vacation travaillée : 480 minutes (« durée normale de vacation »).

**Décalages.** `official.compatible_offsets()` recherche exhaustivement les décalages donnant chaque
jour 1 Matin, 1 Après-midi, 1 Nuit, 1 OFF : le groupe de référence étant à 0, les trois autres sont
nécessairement à 2, 4 et 6 jours (6 ordres possibles). Le modèle retient l'ordre de relève
A → B → C → D (`A:0, B:2, C:4, D:6`) : le jour où A est du Matin, B est d'Après-midi, C de Nuit,
D en repos. **Cet ordre est une convention à confirmer par l'exploitation.**

**Ancrage par site.** Le cycle est commun aux quatre groupes d'un site : `site_rotations.start_date`
(lien site ↔ modèle officiel) est le jour J1 du groupe A. Cette date est une donnée d'exploitation,
saisie site par site ; sans lien, aucune affectation postée n'est acceptée sur le site, et avant
cette date le planning officiel répond `NOT_CONFIGURED` (rien n'est deviné).

## Source officielle

`app/modules/attendance/official.py::official_shift(db, employee_id=, site_id=, at=)` →
`status` (`OFFICIAL` / `NORMAL` / `LEGACY` / `NO_ASSIGNMENT` / `NOT_CONFIGURED`), `regime`, `group`,
`shift`, `working`, `in_progress`, `work_date`, `cycle_day`, `scheduled_start`, `scheduled_end`,
`normal_minutes` (480, ou 0 en `OFF`), `model` (`id`, `code`, `version`, `anchor_date`).

- La Nuit du jour J (22:00 → J+1 06:00) est UNE vacation, rattachée à la journée de cycle J.
- `OFF` est explicite (`shift = OFF`, `normal_minutes = 0`), jamais « inconnu ».
- Le service ne renvoie que l'intervalle THÉORIQUE ; l'heure réelle du pointage reste dans
  `attendance_events` et n'est jamais remplacée.

Pour une affectation postée, les lecteurs historiques (`core.planned_day`,
`core.authorized_work_minutes`, génération de présence OPS) lisent cette même source ; pour toute
autre affectation ils sont inchangés.

API : `GET /api/attendance/official-shift?employee_id=&site_id=&at=`,
`GET /api/attendance/work-regimes` (régimes, groupes, vacations, modèles — pour la future interface
Affectation), `POST|PATCH /api/ops/assignments` (`work_regime`, `group_code`, `rotation_id`).

## Planning officiel / Planning intelligent

Planning officiel = vérité attendue. Planning intelligent = observation, apprentissage,
comparaison : il peut constater « prévu A, observé B », mais n'écrit jamais `work_regime`,
`group_code` ni le modèle officiel. Les écrans historiques ne peuvent pas non plus écraser le
groupe d'une affectation postée ; le modèle officiel n'est pas modifiable depuis l'écran OPS.

## Migration `20261009_0001`

Additive et réversible ; aucune affectation existante n'est modifiée. Le downgrade est refusé tant
qu'une affectation `POSTE_CONTINU` existe (son régime n'a pas d'équivalent antérieur).

## Hors périmètre (lots suivants)

Fenêtre de maintien T+30/T+45, temps comptabilisé, UI Pointeur V5, KPI, récapitulatifs, paie.
