# Planning intelligent — projection du planning (V3, lot 4)

Suite de `docs/attendance-rotation-deviations.md`. **La projection n'est jamais une vérité
supérieure au réel** : chaque pointage continue d'enrichir le modèle, et pour une période passée
le réel est restitué à côté du prévu.

## Rien n'est matérialisé

« Anticiper indéfiniment » = le cycle est projetable sans date de fin. On stocke **la règle**, on
calcule les occurrences à la demande ; aucune ligne future n'est créée (vérifié par test, y
compris pour une date à plusieurs années).

| Élément de la règle | Où |
|---|---|
| site, ancre, durée de rotation, ordre des groupes, concordance | `rotation_model_versions.cycle` |
| date d'effet, version, confiance, source (`LEARNED` / `REBUILD` / `HUMAN`), validateur | `rotation_model_versions` |
| membres appris de chaque groupe à cette version | `rotation_model_versions.groups` |
| remplacements temporaires et changements confirmés, datés | `rotation_decisions` |

## Calcul d'une occurrence

Pour chaque créneau de la période : date, début, fin, site, **groupe attendu** (motif du cycle),
**employés attendus**, **exceptions**, **version**. L'appartenance de chaque salarié est résolue à
la date du créneau avec la même priorité que la comparaison prévu / réel : remplacement temporaire
actif, groupe confirmé en vigueur, groupe appris. Une décision humaine valide prime donc sur la
projection pendant sa période d'effet (source affichée : temporaire / confirmé / appris).

- Salarié suspendu ou inactif (statut autre que `actif`) : non attendu, listé en exception.
- Salarié en remplacement ailleurs : listé en exception sur la rotation de son groupe habituel.
- Aucun salarié n'est réaffecté silencieusement.

## Versions et reproductibilité

- Le moteur ouvre une version à chaque changement réel du modèle (lot 2).
- Un **changement de groupe confirmé** ouvre une version `HUMAN` datée de sa prise d'effet.
- Chaque créneau est calculé avec la plus haute version déjà en vigueur **à sa date**, et avec les
  décisions alors applicables : après création d'une version 2 effective le 10/10, le 09/10 se
  relit avec la version 1 (salarié encore dans A), le 10/10 et après avec la version 2 (dans B).
- Avant la première version disposant d'un cycle : aucun planning n'est affiché pour ces dates.

## État du modèle et présentation

| État du site | Présentation |
|---|---|
| `STABLE` | **PLANNING INTELLIGENT ACTIF**, version et source affichées |
| `LEARNING` (cycle déjà démontré) | **PRÉVISION EN APPRENTISSAGE** — jamais présentée comme certaine |
| `LEARNING` sans cycle | rien n'est projeté |
| `REVIEW_REQUIRED` | **RÉVISION DU PLANNING REQUISE** ; sur un site `ACTIVE`, alerte OPS `attendance.rotation.model_review` (une par site, résolue quand le modèle redevient cohérent) ; la comparaison prévu / réel est suspendue |
| mode `OFF` / site non configuré | planning non activé ; fonctionnement historique inchangé |

## Interfaces

- `GET /api/attendance/rotation-planning?site_id=&date_from=&date_to=&group=&employee_id=` —
  aujourd'hui par défaut, 92 jours au plus. Passé : `actual` (présents, écarts, décisions,
  attendus non pointés, présents non attendus).
- `GET|POST /api/attendance/rotation-planning/{site_id}/decisions` — décision OPS planifiée
  (remplacement temporaire ou changement de groupe à une date d'effet), action `validate`, auditée.
- Centre de contrôle → Planning intelligent → **Planning** : Aujourd'hui / Demain / 7 jours /
  30 jours / période, filtres groupe et employé, table Date · Rotation · Groupe attendu · Employés
  attendus · Exceptions · Réel, écart, décision · Version.

## Performance et cache

Nombre de requêtes **constant** quelle que soit la période (versions, décisions, appartenances,
salariés, puis feuilles / lignes / contrôles pour le réel) : aucun N+1, vérifié par test (1 jour et
30 jours émettent le même nombre de requêtes). Le calcul est borné (≤ 92 jours) et en mémoire :
**aucun cache n'est posé**, donc aucune invalidation à gérer lors d'un changement de version.

## Paramètres (aucune valeur pilote n'est une constante globale)

Durée de rotation, ancre horaire, nombre attendu de groupes, marge anticipée :
`attendance_rotation_settings` (par site). Archivage : `ATTENDANCE_SHEET_ARCHIVE_AFTER_HOURS`.
Apprentissage et seuil de confiance des alertes : `ROTATION_LEARNING_*`, surchargeables par site.

## Activation en production (jamais automatique)

1. Déployer le code ; vérifier les migrations (`20261005_0001` → `20261006_0001` → `20261007_0001`).
2. Site pilote en `OFF` : vérifier que rien ne change.
3. Configurer les paramètres de rotation du site (feuilles).
4. `ROTATION_LEARNING_ENABLED=true`, puis mode `LEARNING` sur le site pilote ; observer.
5. Valider les groupes détectés et le cycle (Planning intelligent) ; ajuster les seuils du site.
6. Mode `ACTIVE` une fois l'état `STABLE` : comparaison prévu / réel et alertes.
7. Consulter la projection ; poser les décisions OPS connues (remplacements, mutations).

## Protocole de test physique final (site pilote)

1. rotation conforme · 2. doublon de pointage · 3. sortie · 4. rotation suivante ·
5. salarié sur le mauvais groupe · 6. alerte Pointeur · 7. alerte OPS · 8. permutation
exceptionnelle · 9. remplacement temporaire · 10. changement confirmé · 11. rotation de nuit ·
12. consultation de l'historique · 13. planning J+7 · 14. retour au groupe normal.

## Critères GO du site pilote

Pointages bruts intacts ; feuilles correctes ; aucun doublon ; groupes explicables ; confiance
calculée ; pas de sur-alerte ; alertes dédupliquées ; qualifications auditables ; historique
correct ; projection reproductible ; site `OFF` inchangé.
