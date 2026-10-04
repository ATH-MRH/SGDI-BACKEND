# Historique et récapitulatifs Attendance du salarié (lot 4)

## Principe

Aucune donnée n'est copiée ni matérialisée : l'historique, la synthèse mensuelle et la synthèse
contractuelle sont **calculés à la demande** (`app/modules/attendance/recap.py`) depuis les
sources existantes.

| Donnée | Source |
|---|---|
| vacations réalisées, heures réelles et comptabilisées | `attendance_events` (instantané `counted` figé au pointage) |
| vacations planifiées | planning officiel (`official.shift_on`) + affectations datées |
| tentatives refusées | audit (`attendance.<code>`, `result = refused`) |
| anomalies, résolutions | `attendance_anomalies` |
| période contractuelle | `contracts` (`start_date`, `end_date`, `status`) |

Le récapitulatif fournit des **faits**. Il ne produit jamais d'appréciation (conduite, fraude,
sanction, avis, renouvellement).

## Historique individuel

Une ligne par vacation (entrée + sa sortie) : date, site, groupe, vacation planifiée, entrée et
sortie réelles, début / fin / minutes comptabilisés, type (`NORMAL`, `EXTRA_SHIFT`, ou vide hors
travail posté), saisie manuelle, anomalies liées et leur résolution. Une vacation appartient au
jour où elle **commence** : une Nuit du 31 reste dans le mois du 31.

Les tentatives refusées sont listées à part (`refusals`) et ne sont **jamais** additionnées au
temps de présence.

## Synthèse mensuelle

`planned_shifts`, `worked_shifts`, `counted_minutes` / `counted_hours`, `early_arrivals`,
`late_arrivals` (anomalies `LATE` existantes — la tolérance déjà définie n'est pas redéfinie),
`early_exits`, `late_exits`, `extra_shifts`, `extra_counted_minutes`, `refused_attempts`
(+ `refused_by_code`), `relief_anomalies` (`VACATION_NON_CLOTUREE`), `manual_entries`,
`anomalies_open` / `anomalies_resolved` / `anomalies_dismissed`, `regularisations`,
`other_presences` (présences hors travail posté), `unconfigured_days` (jours postés sans rotation
configurée : rien n'est planifié ni inventé).

**Vacation supplémentaire — traitement.** Aucun mécanisme de qualification récupération /
paiement n'existe : chaque vacation supplémentaire porte `treatment = A_QUALIFIER`
(`extra_treatments`). Aucun calcul de paie, aucune décision.

## Synthèse contractuelle

Agrégation sur la période réelle du contrat (contrat `actif` le plus récent portant une date de
début ; `contract_id` pour en choisir un autre) : début → fin, bornée à aujourd'hui pour un
contrat en cours ou sans fin (`open_ended`). Détail mois par mois dans `months`. Sans contrat
portant une date de début, ou avec des dates incohérentes : `computable: false` et un motif —
aucune date n'est inventée (ni date d'embauche, ni date d'affectation).

## API

| Route | Contenu |
|---|---|
| `GET /api/attendance/employees/{id}/monthly-recap?month=AAAA-MM` | synthèse + historique + refus + anomalies |
| `GET /api/attendance/employees/{id}/contract-recap[?contract_id=]` | synthèse contractuelle + mois |
| `GET /api/attendance/employees/{id}?month=AAAA-MM` | réponse existante + `recap` (un seul appel pour le dossier) |

Périmètre : authentification obligatoire, action `read`, puis le périmètre sites / sociétés de
l'appelant. Un salarié sans affectation dans ce périmètre est « introuvable » (404) ; pour un
salarié visible, seules les données des sites autorisés sont renvoyées.

## Performance

Nombre de requêtes constant quelle que soit la période (un jour, un mois, un an : 8 requêtes) :
affectations, liens d'ancrage, modèles, événements, anomalies, audit, sites. Aucun index ajouté.

## Dossier salarié

Onglet **Pointage** (DRH) : rubrique « Pointage & vacations » — sélecteur de mois, synthèse,
vacations du mois (réel / comptabilisé), tentatives refusées, anomalies — au-dessus du journal
existant, sans appel supplémentaire à l'ouverture de l'onglet.
