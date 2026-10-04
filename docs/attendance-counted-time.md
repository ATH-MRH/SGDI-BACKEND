# Temps réel / temps comptabilisé du travail posté (lots 1 et 2)

## Principe

À partir de ce lot, Attendance distingue deux temps pour les affectations `POSTE_CONTINU` :

| Temps | Définition | Où |
|---|---|---|
| **Réel** | horodatage enregistré par le terminal | `attendance_events.occurred_at` (append-only), `DailyPresence.arrival_time` / `departure_time` |
| **Comptabilisé** | temps retenu par les règles de la vacation officielle | instantané `counted` (voir Stockage) |

L'heure réelle n'est jamais modifiée ni écrasée. La vacation théorique vient **exclusivement** de
`official.official_shift` (lot 0) : `app/modules/attendance/counted.py` ne recalcule ni groupe, ni
jour de cycle, ni horaires.

## Règles (vacation T → TFIN)

| Cas | Résultat |
|---|---|
| entrée < T-30 min | `EARLY_OUTSIDE_WINDOW` : refusée, aucun mouvement |
| T-30 min ≤ entrée ≤ T | acceptée (`IN_WINDOW`), `counted_start = T` |
| entrée > T | acceptée (`AFTER_START`), `counted_start = entrée réelle` |
| sortie < TFIN | `counted_end = sortie réelle` (le manque n'est pas crédité) |
| sortie ≥ TFIN | `counted_end = TFIN` |
| durée | `counted_minutes = max(0, counted_end - counted_start)`, plafonnée à 480 min |

La borne T-30:00 est incluse (13:30:00 accepté, 13:29:59 refusé pour une vacation à 14:00). La Nuit
22:00 → 06:00 est une seule vacation : la sortie du lendemain se calcule sur l'instantané de son
entrée.

**Hors périmètre, règles historiques inchangées (aucun instantané) :** affectation `NORMAL` ou
historique (`NULL`), `ROTATION_NOT_CONFIGURED`, jour `OFF`, entrée à partir de TFIN (vacation de la
journée terminée). Aucune vacation n'est inventée.

## Décision — entrée avant T-30 : refus sans mouvement

Le pointage est **refusé** (HTTP 409, en-tête `X-Attendance-Code: EARLY_OUTSIDE_WINDOW`, message
indiquant l'heure d'ouverture de la fenêtre). Aucun `attendance_event`, aucune `DailyPresence`,
aucune anomalie. La tentative est tracée dans l'audit (`attendance.early_outside_window`,
résultat `refused`, heure réelle de la tentative, vacation visée). Ce n'est ni une fraude ni une
anomalie disciplinaire.

Pourquoi pas « accepté hors fenêtre sans présence active » : dans l'architecture actuelle, une
ARRIVÉE ouvre le cycle (le scan suivant devient une SORTIE), crée la journée `present` lue par la
paie et bloque toute nouvelle arrivée pendant 8 h. L'accepter démarrerait donc la vacation, ou
exigerait un nouveau type d'événement que les terminaux afficheraient comme un pointage réussi. Le
refus ne fabrique rien et laisse l'entrée à T-30 se faire normalement.

**Limite connue.** Un salarié posté qui vient travailler sur une autre vacation que celle de son
groupe (permutation, remplacement) avant T-30 de sa propre vacation est refusé, alors qu'un jour
`OFF` reste accepté en « hors planning ». Le maintien (lot 2) couvre uniquement le créneau qui suit
sa propre vacation.

## Vacation supplémentaire / maintien (lot 2)

Un salarié maintenu au poste fait **deux vacations distinctes** — ENTRÉE / SORTIE, puis NOUVELLE
ENTRÉE / SORTIE — jamais une présence continue de 16 h. La vacation supplémentaire est le créneau
qui suit la vacation normale (06-14 → 14-22, 14-22 → 22-06, 22-06 → 06-14), durée de référence
480 min. Son instantané porte `kind = EXTRA_SHIFT` (la vacation normale : `kind = NORMAL`) et la
vacation précédente (`previous` : vacation, horaires, entrée et sortie réelles, événement).

TFIN = fin **théorique** de la vacation précédente (son `scheduled_end` figé). La fenêtre se compte
depuis TFIN, jamais depuis la sortie réelle :

| Nouvelle entrée | Résultat |
|---|---|
| vacation précédente sans sortie | `PREVIOUS_SHIFT_NOT_CLOSED` — refusée |
| TFIN ≤ entrée < TFIN+30 | `EXTRA_BEFORE_WINDOW` — refusée |
| TFIN+30 ≤ entrée ≤ TFIN+45 | acceptée (`EXTRA_IN_WINDOW`) |
| entrée > TFIN+45 | `MANUAL_ENTRY_REQUIRED` — refusée (409) |
| entrée > TFIN+45, saisie manuelle habilitée | acceptée (`EXTRA_MANUAL`), motif obligatoire |

Tout refus suit la règle du lot 1 : aucun mouvement, audit `attendance.<code>`, en-tête
`X-Attendance-Code`.

**Sortie obligatoire.** Attendance Core décide ENTRÉE / SORTIE d'après l'état réel : tant que la
première vacation est ouverte, le pointage suivant **est** sa sortie. `PREVIOUS_SHIFT_NOT_CLOSED`
répond donc à une entrée explicite (saisie manuelle avec `intent = EXTRA_SHIFT_ENTRY`) ou à une
vacation restée ouverte au-delà de la fenêtre de cycle.

**Saisie manuelle.** `POST /api/portal/attendance-manual/scan` transmet la permission explicite
`attendance / manual_entry / create` (refus par défaut, 403 sinon). L'événement conserve employé,
société, site, pointeur (`actor_user_id`), heure réelle, source `MANUAL`, motif (`observation`),
vacation précédente et vacation supplémentaire, terminal le cas échéant.

**Décisions prises faute de règle écrite — à confirmer :**
- *Début comptabilisé de la vacation supplémentaire* = heure réelle de la nouvelle entrée (règle
  « entrée après T » du lot 1) : une entrée à TFIN+30 compte au plus 450 min. Aucun temps n'est
  fabriqué ; la référence 480 min est conservée dans `normal_minutes`.
- *Saisie manuelle entre TFIN et TFIN+30* : refusée comme l'entrée autonome (la dérogation manuelle
  n'est définie qu'après TFIN+45).
- *Portée* : les règles s'appliquent pendant le créneau suivant (TFIN → TFIN+480 min), après une
  vacation normale comptabilisée du même site. Une vacation supplémentaire n'en ouvre pas une autre.
- Le délai historique de 8 h entre deux arrivées ne s'applique pas à la vacation supplémentaire ;
  ni retard ni « hors planning » n'est constaté sur sa nouvelle entrée.

Journée : `DailyPresence.data._legacy.counted` (vacation normale) et `countedExtra` (vacation
supplémentaire) ne s'écrasent pas. Projections : champ `extra_shift` à côté de `counted`
(`/board`, `/workspace`).

## Stockage — instantané figé, sans migration

Problème : les valeurs comptabilisées ne sont **pas** recalculables de façon fiable après coup. Le
planning officiel dépend de données modifiables (groupe et modèle de l'affectation, date d'ancrage
du site) ; un recalcul ultérieur donnerait un autre T pour un pointage passé.

Choix : l'instantané est écrit **dans l'événement**, au moment du pointage, dans la colonne JSON
existante `attendance_events.data["counted"]` (append-only, déjà utilisée pour `workedMinutes`).
Aucune colonne, aucune migration. Il est recopié dans `DailyPresence.data._legacy.counted` pour les
projections qui lisent la journée. La sortie se calcule sur l'instantané de **son** entrée, jamais
sur le planning du moment ; l'événement d'entrée n'est pas modifié.

```json
{"regime": "POSTE_CONTINU", "group": "B", "shift": "APRES_MIDI", "work_date": "2026-10-01",
 "cycle_day": 3, "model_version": 1, "normal_minutes": 480,
 "scheduled_start": "2026-10-01T14:00:00+01:00", "scheduled_end": "2026-10-01T22:00:00+01:00",
 "window_opens_at": "2026-10-01T13:30:00+01:00", "entry_status": "IN_WINDOW",
 "actual_entry": "2026-10-01T13:30:00+01:00", "counted_start": "2026-10-01T14:00:00+01:00",
 "actual_exit": "2026-10-01T22:18:00+01:00", "counted_end": "2026-10-01T22:00:00+01:00",
 "counted_minutes": 480}
```

Les entrées antérieures au lot 1 n'ont pas d'instantané : leur sortie suit les règles historiques.

## OVERTIME

Avant : `présence physique (sortie - entrée) - durée autorisée`. Pour une vacation comptabilisée,
le dépassement se mesure désormais sur `counted_minutes` : arriver avant T ou sortir après TFIN ne
crée plus d'anomalie `OVERTIME`. `workedMinutes` / `duration_minutes` restent la présence physique
réelle. `NORMAL`, historique et cas hors périmètre : calcul inchangé.

## API (ajouts rétrocompatibles)

Champ `counted` (objet ci-dessus + `shift_label`, `entry_status_label`, ou `null`) ajouté à :
réponse du pointage (uniquement en travail posté), `GET /api/attendance/board` (ligne),
`GET /api/attendance/employees/{id}` (événement), `GET /api/attendance/workspace` (cellule — BEO /
central), flux live et journal du Pointeur. Les champs existants gardent leur sens : heures
réelles. `GET /api/attendance/work-regimes` expose `time_labels` (libellés pour le futur Pointeur
V5 ; aucune refonte d'écran dans ce lot).
