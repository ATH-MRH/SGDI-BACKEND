# ATLAS Site Workforce — Benchmark réel (Chrome)

Généré le 2026-09-23T01:10:12.650Z — Chrome réel, serveur uvicorn réel, 40 employés + affectations seedés (site réaliste, pas un cas vide).

## Transitions mesurées

| Transition | Temps (ms) | Requêtes API | Doublons |
|---|---:|---:|---:|
| Login → Dashboard | 158 | 5 | 0 |
| Dashboard → Personnel | 20 | 1 | 0 |
| Dashboard → Pointage | 21 | 1 | 0 |
| Dashboard → Absences | 8 | 1 | 0 |
| Dashboard → Justificatifs | 10 | 1 | 0 |

## Invariantes qualitatives

- 0 full-fetch employés au bootstrap ou à la navigation Personnel : OK (pagination serveur, `page_size=20`, confirmé par le nombre de requêtes ci-dessus sur 40 employés réels).
- 0 requête dupliquée observée par écran (colonne "Doublons").
- Aucune requête pour un écran jamais visité (routeur lazy, une seule vue rendue à la fois).

Mesuré sur une machine de développement, base SQLite locale, réseau loopback — valeurs indicatives de forme (nombre de requêtes, présence de doublons, ordre de grandeur du temps), pas des SLA de production.
