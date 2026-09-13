# DRH — mesures navigateur après corrections

Produit : `a8aa982`. Trois parcours valides Chrome 152, même fixture, même SHA observateur et même politique de cache que les trois parcours avant. Toutes les API sont en HTTP 200, sans erreur ; chaque phase conserve 1 000 employés, 500 candidats, et Employés affiche toujours 572 lignes / 9 797 éléments.

Le deuxième parcours tenté a été interrompu par la disparition de son onglet et n’a produit aucun rapport. Un nouvel onglet du même navigateur a fourni les deux parcours valides suivants. Aucune taille de fenêtre n’a été modifiée ; le stockage de benchmark est réinitialisé par le protocole à chaque navigation. Cet écart au plan « même onglet » est conservé, ainsi que la forte dispersion des durées.

| Mesure (médiane) | Avant | Après | Variation après − avant |
|---|---:|---:|---:|
| Ouverture DRH ms | 1 234,2 | 2 411,8 | +95.41 % |
| Ouverture Employés ms | 1 885,1 | 1 034,9 | -45.10 % |
| Retour chaud DRH ms | 156,5 | 154,9 | -1.02 % |
| Requêtes initiales | 13,0 | 11,0 | -15.38 % |
| Payload API octets | 5 081 011,0 | 3 273 431,0 | -35.58 % |
| Parsing JSON ms | 15,6 | 10,2 | -34.62 % |
| Scripts initiaux octets | 1 785 040,0 | 1 792 027,0 | +0.39 % |
| Construction innerHTML Employés ms | 30,1 | 30,6 | +1.66 % |
| Écritures innerHTML Employés | 574,0 | 2,0 | -99.65 % |

| Parcours valide | DRH froid ms | Employés ms | DRH chaud ms | Requêtes initiales | API octets |
|---|---:|---:|---:|---:|---:|
| 1 | 2526.3 | 1115.9 | 154.9 | 12 | 3273587 |
| 2 | 2411.8 | 1027.3 | 150.2 | 11 | 3273431 |
| 3 | 1143.5 | 1034.9 | 164.6 | 10 | 3270944 |

## Endpoints à la première ouverture

Durées et parsing : médianes des occurrences des trois parcours. Les tailles sont par réponse. Les appels sont donnés par parcours. Les stacks complets figurent dans les traces JSON.

| Endpoint | Appels | Statut | Durée ms | Octets | Parse ms | Appelant | Bloquant |
|---|---:|---:|---:|---:|---:|---|---|
| `/api/irongs/db?light=1` | 1–1 | 200 | 940,5 | 934436 | 5,0 | sgdiPullState → bootApp | oui |
| `/api/irongs/events/ticket` | 1–2 | 200 | 488,9 | 156 | 0,0 | sgdiStartEventStream | non |
| `/api/version` | 2–2 | 200 | 111,0 | 26 | 0,0 | sgdiScheduleAutoRefresh | non |
| `/api/ui/sidebar-stats` | 1–2 | 200 | 319,4 | 2487 | 0,1 | sgdiReadSidebarStats / compteurs | non |
| `/api/auth/users` | 1–1 | 200 | 39,1 | 424 | 0,1 | sgdiLoadAuthState | oui |
| `/api/auth/access-rules` | 1–1 | 200 | 31,4 | 2 | 0,0 | sgdiLoadAuthState | oui |
| `/api/drh/employees` | 1–1 | 200 | 166,5 | 1805093 | 2,6 | sgdiFetchEmployees → sgdiPullCurrentEmployees | oui |
| `/api/drh/candidates` | 1–1 | 200 | 63,8 | 528193 | 0,7 | syncCandidatesFromPostgres | oui |
| `/api/irongs/positions` | 1–1 | 200 | 54,4 | 101 | 0,0 | refreshPositions (timer) | non |

## Lecture des résultats

- La traduction Employés passe de 887,1 à 109,4 ms (−87,7 %). `renderView` passe de 428,7 à 383,5 ms ; ces temps sont inclusifs et ne s’additionnent pas. Les écritures HTML passent de 574 à 2, mais la construction HTML elle-même mesure 30,1 → 30,6 ms : aucun gain de cette durée n’est affirmé.
- La liste employés n’est téléchargée qu’une fois dans chaque parcours après, contre deux avant. Sidebar : 1–2 appels après contre 3 avant. Les doublons restants dépendent du timing et des invalidations du démarrage. Version reste appelée deux fois ; le ticket SSE une à deux fois.
- L’ouverture froide augmente en médiane : 1 234,2 → 2 411,8 ms (+95,4 %). Les trois snapshots légers prennent 1 180,7 / 940,5 / 234,1 ms côté navigateur ; les requêtes ticket/version lancées ensemble subissent aussi des délais élevés dans les deux premiers parcours. Les timings backend séparés dérivent aussi sur des endpoints inchangés. La cause de cette variation n’est pas établie ; aucun run défavorable n’est retiré et aucun gain d’ouverture froide n’est revendiqué.
- Les trois ouvertures restent sous 3 s et les retours chauds sous 1,5 s dans cette fixture locale. Le payload API baisse de 35,6 %, sans atteindre 50 %. API + scripts initiaux passent de 6 866 051 à 5 065 458 octets (−26,2 %), hors CSS et autres ressources.
- La plus grosse réponse reste `/api/drh/employees` à 1 805 093 octets. Le référentiel reste complet ; pagination et découplage du snapshot ne sont pas livrés.
- Toujours aucune image ni document demandé dans cette fixture sans photos. Cela ne prouve pas le comportement avec des pièces jointes réelles.
- Limites communes conservées : polices externes, EventSource permanent et service worker exclus ; données SQLite synthétiques ; mesures instrumentées sans garantie de latence de production. Voir `frontend-before.md` pour les définitions.
