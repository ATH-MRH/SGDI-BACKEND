# Planning intelligent — prévu / réel, alertes et qualification OPS (V3, lot 3)

Suite de `docs/attendance-rotation-learning.md`. **Le pointage est enregistré AVANT l'analyse et
n'est jamais bloqué.** Trois notions restent séparées et ne se réécrivent jamais :

| Notion | Table | Qui l'écrit |
|---|---|---|
| Observation réelle | `attendance_events`, lignes de feuille | Attendance Core, feuilles (lot 1) |
| Prédiction du moteur | `rotation_checks` (attendu, observé, résultat, confiance d'alors) | ce lot, à l'arrivée |
| Décision humaine | `rotation_decisions` + qualification du contrôle | OPS |

## Quand compare-t-on ?

À chaque **première entrée** d'un salarié dans une feuille, après l'écriture du pointage et de la
feuille, dans un point de sauvegarde isolé (une erreur est journalisée, le pointage est validé).
Toutes ces conditions sont requises, sinon **rien n'est comparé** (ligne « non évaluée ») :

1. `ROTATION_LEARNING_ENABLED=true` ;
2. site en mode **ACTIVE** (posé explicitement, `PUT /api/attendance/rotation-learning/{site_id}`) ;
3. état mesuré du site **STABLE** (ni `LEARNING` ni `REVIEW_REQUIRED` : pas de sur-alerte) ;
4. cycle démontré s'appliquant au créneau de la feuille ;
5. une référence attendue fiable pour le salarié.

## Référence attendue (priorité)

1. **remplacement temporaire** OPS actif à l'instant du pointage ;
2. **groupe confirmé** par OPS (dernier changement confirmé déjà en vigueur) ;
3. **groupe appris**, seulement s'il est `PROBABLE` avec une confiance ≥ `alert_confidence`
   (0,8 initial, réglable par site).

Les deux premiers niveaux du schéma conceptuel (« override OPS », « planning manuel confirmé »)
correspondent ici aux décisions OPS datées. Le planning théorique des affectations (gabarits de
rotation) garde son contrôle propre dans Attendance Core (anomalie « hors planning ») : il n'est ni
dupliqué ni remplacé, car ses codes de groupe ne sont pas ceux du modèle appris.

Le groupe **observé** est celui que le cycle démontré place sur le créneau de la feuille.

## Types d'écart (uniquement ceux que les données prouvent)

| Type | Condition | Sévérité |
|---|---|---|
| `UNEXPECTED_ROTATION` | groupe attendu ≠ groupe du créneau | warning |
| `UNPLANNED_PRESENCE` | prise de poste sur un créneau de repos du cycle | warning |
| `PERSISTENT_ROTATION_CHANGE_POSSIBLE` | `persistent_deviations` (3) écarts consécutifs vers le même groupe | critical |

`UNEXPECTED_GROUP` et `TEMPORARY_REPLACEMENT_POSSIBLE` ne sont pas générés : le premier ne se
distingue pas d'une rotation inhabituelle, le second ne peut pas être prouvé par les données.

## Alertes

- **Pointeur** : la fiche normale du passage, plus « ⚠ ROTATION INHABITUELLE — Attendu / Observé —
  POINTAGE ENREGISTRÉ » (flux temps réel `rotation_alert`, toutes sources : facial, QR, manuel,
  douchette). Aucune action de planning au poste.
- **OPS** : Command Center → « Alertes & actions prioritaires » → **Examiner**.
- **Centre d'alertes existant** : l'alerte est persistée dans `alerts` (règle
  `attendance.rotation.deviation`, historique `alert_history`), filtrable par période, site,
  employé, règle, sévérité, statut. `GET /api/attendance/rotation-deviations` ajoute les filtres
  groupe et type.
- **Déduplication** : une ligne par (feuille, salarié) — contrainte unique — et une clé
  d'idempotence d'alerte `site|employee|sheet`. Prouvé sous concurrence PostgreSQL.

## Qualification OPS (`POST /api/attendance/rotation-deviations/{id}/qualify`, action « validate »)

| Décision | Écart | Alerte | Effet |
|---|---|---|---|
| Permutation exceptionnelle | `RESOLVED` | traitée | aucun : pointage, feuille et groupe permanent inchangés |
| Remplacement temporaire | `RESOLVED` | traitée | décision `TEMPORARY` (groupe, début, fin, motif, validateur) : référence attendue pendant la période, retour automatique ensuite |
| Changement de groupe confirmé | `RESOLVED` | traitée | décision `PERMANENT` datée + `confirmed_group` + historique d'appartenance (ancien, nouveau, validateur, motif, alerte source, confiance) ; rien de rétroactif |
| Erreur / faux positif | `DISMISSED` | ignorée (motif) | justification obligatoire ; fait, prédiction et décision conservés pour recalibrer |
| À examiner plus tard | `ACKNOWLEDGED` | acquittée | reste visible, aucun changement de groupe |

Rejouer la même décision ne crée rien de plus ; une décision définitive différente est refusée
(409). Chaque décision est auditée (`attendance.rotation_deviation.qualify` : utilisateur, date,
ancienne / nouvelle valeur, raison, alerte source). L'apprentissage continue sans réécrire ses
statistiques : un groupe confirmé que le moteur contredit apparaît `OVERRIDDEN`.

## Historique (DRH et OPS, selon le périmètre de sites)

- `GET /api/attendance/rotation-history` et Centre de contrôle → **Historique de pointage** :
  période, site, employé, groupe, résultat, statut de feuille, anomalie.
- Détail d'une feuille (y compris archivée) : groupe attendu / observé de la feuille, et par
  salarié première entrée, dernière sortie, passages, état, attendu / observé, écart, décision.
- Attendu et résultat sont ceux **enregistrés au moment du pointage**, jamais recalculés.
- Le Pointeur n'a accès qu'à la feuille active : ce n'est pas un outil d'analyse historique.

## RBAC (actions canoniques existantes, aucun second système)

| Capacité | Règle |
|---|---|
| Voir planning, historique, écarts, examiner | compte dont le périmètre de sites couvre le site |
| Qualifier un écart, confirmer un changement de groupe | action `validate` |
| Modifier paramètres / mode d'un site | action `update` |
| Reconstruire le modèle | action `admin` |

## Protocole de test physique (site pilote)

Pré-requis : site en `ACTIVE`, état `STABLE`, un salarié (ex. K162) `PROBABLE` dans le groupe A.

| Cas | Geste | Attendu |
|---|---|---|
| A | K162 pointe pendant la rotation du groupe A | pointage accepté, aucune alerte, historique « Conforme » |
| B | K162 pointe pendant la rotation du groupe B | pointage accepté ; fiche Pointeur + ROTATION INHABITUELLE ; alerte dans le Command Center OPS et le Centre d'alertes |
| C | OPS : Permutation exceptionnelle | alerte traitée ; groupe de K162 inchangé ; prochain passage hors groupe de nouveau signalé |
| D | OPS : Remplacement temporaire jusqu'à une rotation donnée | passages avec B conformes pendant la période, sans nouvelle alerte ; retour à A ensuite |
| E | OPS : Changement de groupe confirmé | groupe confirmé B, historique d'appartenance, anciennes feuilles intactes |

À vérifier aussi : doublon de pointage (aucun second écart), rotation de nuit 22:00 → 06:00,
consultation de l'historique par DRH.
