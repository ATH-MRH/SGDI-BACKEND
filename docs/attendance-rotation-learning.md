# Planning intelligent — apprentissage des groupes et des rotations (V3, lot 2)

Suite de `docs/attendance-rotation-sheets.md` (lot 1). **Le pointage réel est un fait** : ce lot
observe les feuilles clôturées et propose un modèle. Il n'écrit ni dans `attendance_events`, ni
dans les feuilles, ni dans les affectations RH. Il n'émet **aucune alerte** et ne projette pas le
planning (lots 3 et 4).

## Activation (jamais implicite)

1. `ROTATION_LEARNING_ENABLED=true` (désactivé par défaut).
2. Mode du site posé explicitement : Centre de contrôle → Planning intelligent → « Activer
   l'apprentissage » (`PUT /api/attendance/rotation-learning/{site_id}`, `mode: LEARNING`).

Sans ces deux conditions rien n'est calculé. Repasser à `OFF` fige le modèle sans rien effacer.
Un site sans paramètres de rotation n'a pas de feuille : comportement historique inchangé.
À l'activation, les feuilles DÉJÀ clôturées du site (réelles, lot 1) sont intégrées une fois.

## Données utilisées

| Donnée | Source | Usage |
|---|---|---|
| Présence d'un salarié sur une rotation | `attendance_sheet_lines` (une ligne par salarié, avec une ENTRÉE) | une observation |
| Début / fin de rotation, site | `attendance_sheets` (CLOSED ou ARCHIVED uniquement) | créneau, cycle |
| Première entrée, dernière sortie | ligne de feuille | cohérence horaire, durée observée |
| Groupe déclaré | `assignments.group_code` (lecture seule) | affiché à côté de l'appris ; nom du groupe détecté |
| Nombre de groupes attendu | `attendance_rotation_settings.groups_count` | comparé au réel, jamais imposé |

Non utilisés : fonction / poste, `rotation_templates`, `daily_presence` (planning théorique) — le
moteur n'apprend que du réel. Il n'existe pas encore de validation humaine : `confirmed_group`
est prévu pour le lot 3.

## Algorithme (déterministe, sans LLM)

- **Une feuille clôturée = une observation** (`rotation_sheet_observations`, clé primaire = feuille).
  Une feuille OPEN n'est jamais apprise. Dix pointages d'un salarié dans une feuille = une observation.
- **Rattachement d'une feuille à un groupe** (une fois, conservé) : *noyau* d'un groupe = salariés
  présents dans au moins `core_share` de ses feuilles ; la feuille rejoint le groupe dont le noyau
  lui ressemble le plus si l'indice de Dice `2·|F∩N| / (|F|+|N|)` ≥ `link_threshold`, sinon elle
  ouvre un groupe **candidat**. Un groupe est **consolidé** à partir de `min_group_sheets` feuilles.
- **Nom d'un groupe** : groupe déclaré strictement majoritaire parmi les présents s'il est libre,
  sinon `G<n>`. Ce n'est qu'un nom : l'appartenance apprise ne dépend jamais du groupe déclaré.
- **Observation brute et interprétation** restent distinctes : `observed_group` (groupe déclaré
  majoritaire, lot 1) et `interpretation.group` (groupe appris) sont renvoyés côte à côte.
- **Groupe ≠ créneau** : par groupe, répartition réelle des créneaux, créneau le plus fréquent et sa
  part (`usual_share`), écart médian d'arrivée, durée médiane de présence.

### Formule de confiance (par salarié, sur la fenêtre glissante)

```
confiance = évidence × (w_share·part + w_time·horaires + w_recency·récence) / (w_share+w_time+w_recency)

part     = observations avec le groupe en tête / observations
horaires = observations dont la première entrée est à ± arrival_tolerance_minutes du début de rotation / observations
récence  = part du groupe en tête dans les recent_observations dernières observations
évidence = min(1, observations / min_observations)
```

Tous les termes sont enregistrés (`rotation_memberships.explanation`) : l'API restitue par exemple
« 14 rotation(s) observée(s) · 12 avec le groupe A · 13/14 horaires cohérents ».

### Statuts d'appartenance

| Statut | Signification |
|---|---|
| `LEARNING` | Pas de groupe appris : observations < `min_observations`, confiance < `probable_threshold`, ou groupe encore candidat. Le groupe en tête est seulement « candidat ». |
| `PROBABLE` | Groupe appris : assez d'observations, confiance suffisante, groupe consolidé. |
| `CONFIRMED` | Un groupe a été confirmé par un humain (lot 3) et le moteur ne le contredit pas. |
| `OVERRIDDEN` | Groupe confirmé par un humain, mais le moteur apprend un autre groupe : la décision humaine prévaut, l'écart est visible. |

Un passage unique laisse le salarié en `LEARNING` (évidence 1/`min_observations`). Un changement
durable fait baisser la confiance, repasse par `LEARNING`, puis propose le nouveau groupe : jamais
de bascule directe, et chaque transition est historisée.

### Cycle

Séquence des groupes sur les créneaux consécutifs (un créneau sans présence compte comme repos).
Le cycle retenu est la plus petite période `p` dont la concordance `groupe(i) = groupe(i+p)` atteint
`cycle_threshold` sur au moins `max(min_cycle_comparisons, p)` comparaisons. Sinon aucun cycle
n'est affiché. « Rotation probable suivante » n'est qu'une lecture de ce cycle pour le prochain créneau.

### État du site

Six conditions mesurées (`rotation_site_models.reasons`), chacune `ok` / `pending` / `failed` :
rotations observées ≥ `min_site_sheets` ; groupes consolidés = nombre attendu ; feuilles rattachées
à un groupe consolidé ≥ `stable_sheet_ratio` ; salariés suivis probables ≥ `stable_member_ratio` ;
confiance moyenne ≥ `probable_threshold` ; cycle démontré.

- `STABLE` : toutes `ok`. `REVIEW_REQUIRED` : au moins une `failed` (groupes instables, cycle
  contradictoire, configuration incompatible avec le réel). `LEARNING` : sinon.
- Aucune condition ne dépend d'un nombre de jours calendaires. Tant que `min_site_sheets` n'est pas
  atteint rien n'est « failed ». Le nombre de groupes attendu ne force jamais les salariés.

## Paramètres

Valeurs **initiales** d'exploitation, **non calibrées sur la production** (aucune donnée de
production n'était disponible pour ce lot) : à ajuster après quelques semaines d'observation,
globalement (`ROTATION_LEARNING_<CLÉ>`) ou par site (`params` du `PUT`, surcharges bornées et auditées).

| Clé | Initial | Rôle |
|---|---|---|
| `window_sheets` | 180 | fenêtre glissante (feuilles clôturées) |
| `link_threshold` | 0.6 | Dice minimal feuille ↔ noyau |
| `core_share` | 0.5 | présence minimale pour appartenir au noyau |
| `min_group_sheets` | 3 | feuilles avant consolidation d'un groupe |
| `min_observations` | 6 | observations avant de proposer un groupe |
| `probable_threshold` | 0.7 | confiance minimale pour `PROBABLE` |
| `recent_observations` | 5 | profondeur de la récence |
| `arrival_tolerance_minutes` | 60 | tolérance d'horaire |
| `weight_share` / `weight_time` / `weight_recency` | 0.6 / 0.2 / 0.2 | pondérations |
| `min_site_sheets` | 12 | rotations avant de quitter `LEARNING` |
| `stable_member_ratio` / `stable_sheet_ratio` | 0.8 / 0.8 | cohérence des membres / des feuilles |
| `cycle_threshold` | 0.9 | concordance minimale d'un cycle |
| `min_cycle_comparisons` / `max_cycle_slots` | 12 / 120 | preuve minimale / période maximale testée |

## Incrémental, concurrence, versions, audit

- Mise à jour **à la clôture** (rattrapage à l'accès et orchestrateur, via `sheets.maintain`), jamais
  dans le chemin du pointage ; calcul borné par la fenêtre. Une erreur d'apprentissage est annulée
  dans son point de sauvegarde et n'empêche ni clôture ni pointage.
- Sérialisation par site : verrou de ligne `rotation_site_models` (`SELECT … FOR UPDATE`) ; clé
  primaire feuille et contraintes uniques (site, groupe), (site, salarié), (site, version) en
  dernier rempart. Prouvé sur PostgreSQL (`tests/test_attendance_learning_pg_race.py`).
- `rotation_model_versions` : une photographie par changement réel (état, groupes, cycle,
  appartenances) avec paramètres, confiance, source, feuille source.
- `rotation_membership_history` : ancienne / nouvelle valeur, confiance, feuille source, version du
  moteur, acteur. Journal d'audit : `attendance.rotation_learning.{settings,model,rebuild}`.

## Reconstruction et backfill

- `POST /api/attendance/rotation-learning/{site_id}/rebuild` (action « admin ») : site + période,
  **simulation par défaut** (`dry_run: true`), idempotente, auditée. Après un changement de
  paramètres, reconstruire tout l'historique du site (une période partielle garde les
  interprétations voisines).
- Backfill historique : `GET …/backfill-preview` mesure, sans rien écrire, ce que les anciens
  pointages permettraient de reconstituer. **Aucun backfill n'est exécuté** : les fenêtres seraient
  calculées avec les paramètres actuels (la rotation de l'époque n'est pas connue) et le groupe
  déclaré d'alors n'est pas conservé. À décider site par site au vu de cette mesure.

## Interfaces

- `GET /api/attendance/rotation-learning[?site_id=]`, `GET …/{site_id}/groups`,
  `GET …/{site_id}/versions`, `GET …/employees/{employee_id}` (fiche rotation : déclaré / appris /
  confirmé, observations, confiance expliquée, historique ; complète la fiche RH sans la remplacer).
- Centre de contrôle (pointage.irongs.com) → **Planning intelligent** : état du site, rotations
  observées, groupes détectés, confiance, dernière mise à jour, rotation probable suivante, groupes
  détectés et fiche rotation. Aucune valeur n'est calculée dans la page.
