# ATLAS Finance Platform V2 — Benchmark réel (Chrome)

Généré le 2026-09-23T00:02:21.012Z — Chrome réel, serveur uvicorn réel, données seedées réalistes (PME, pas un cas vide).

## Bootstrap (avant toute navigation métier)

- Requêtes API au bootstrap : 5 (http://127.0.0.1:8935/api/auth/login, http://127.0.0.1:8935/api/auth/me, http://127.0.0.1:8935/api/finance-core/societies, http://127.0.0.1:8935/api/cockpit/summary?society=Iron+Global+Securite&period=2026-09, http://127.0.0.1:8935/api/finance-core/accounting-events?society=Iron+Global+Securite&status_filter=failed&limit=100)
- Full-fetch employés détecté : NON
- Collection métier massive détectée (obligations/transactions/bulletins/lignes) : NON

## Par écran

| Écran | Nav → contenu | Requêtes API | Octets transférés | Plus grosse réponse | Requêtes dupliquées |
|---|---:|---:|---:|---:|---:|
| Dashboard | 33 ms | 2 | 919 o | 917 o | 0 |
| Trésorerie | 49 ms | 3 | 2.0 Ko | 1.1 Ko | 0 |
| Banque | 10 ms | 1 | 145 o | 145 o | 0 |
| Rapprochement | 6 ms | 2 | 147 o | 145 o | 0 |
| Créances | 25 ms | 1 | 399 o | 399 o | 0 |
| Dettes | 16 ms | 1 | 1.8 Ko | 1.8 Ko | 0 |
| Paie | 14 ms | 1 | 257 o | 257 o | 0 |
| Budget | 19 ms | 1 | 233 o | 233 o | 0 |
| Rentabilité | 14 ms | 2 | 294 o | 292 o | 0 |
| Fiscalité | 15 ms | 1 | 276 o | 276 o | 0 |
| Comptabilité | 15 ms | 1 | 136 o | 136 o | 0 |
| Réglementation | 15 ms | 1 | 343 o | 343 o | 0 |
| Cockpit DG | 33 ms | 2 | 951 o | 917 o | 0 |

## Invariantes qualitatives

- 0 full-fetch employés au bootstrap : OK
- 0 collection métier massive au bootstrap : OK
- 0 requête dupliquée par écran : OK
- 0 requête d'un écran jamais visité : OK (routeur lazy, voir shell.js — une seule vue rendue à la fois, aucune requête hors du chemin de navigation actif)

Mesuré sur une machine de développement, base SQLite locale, réseau loopback — valeurs indicatives de forme (nombre de requêtes, présence de doublons, ordre de grandeur des octets), pas des SLA de production.
