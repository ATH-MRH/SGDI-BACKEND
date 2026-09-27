# Benchmark Attendance V1 — chiffres réels

Script : `scripts/bench_attendance.py` (reproductible, base PostgreSQL **jetable** uniquement).
Machine : Apple M4 (développement local), PostgreSQL local, moteur biométrique réel (OpenCV).
Chaque ligne = médiane de 7 appels (5 pour la reconnaissance) via le client HTTP en processus ;
« Requêtes SQL » = nombre de requêtes émises par appel (détection des N+1).

**Jeu de données** : 60 sites, 3000 employés affectés, 10800 journées, 10800 événements (PostgreSQL)

| Appel | Médiane | Max | Requêtes SQL | Réponse |
|---|---|---|---|---|
| Centre de contrôle — board, tous sites (3 000 employés), page 1 | 172 ms | 186 ms | 7 | 9.0 Ko |
| Centre de contrôle — board, page 60 | 102 ms | 217 ms | 7 | 9.1 Ko |
| Centre de contrôle — board, 1 site | 9 ms | 11 ms | 8 | 9.0 Ko |
| Centre de contrôle — board, filtre statut + recherche | 181 ms | 185 ms | 7 | 6.2 Ko |
| Anomalies — page 1 | 3 ms | 5 ms | 3 | 0.1 Ko |
| Employé 360 — Pointages (30 j d'historique) | 5 ms | 6 ms | 8 | 8.5 Ko |
| Pointeur — flux temps réel (48 h) | 53 ms | 129 ms | 4 | 53.6 Ko |
| Attendance Core — scan manuel (écriture) | 12 ms | 28 ms | 25 | 1.2 Ko |

Moteur réel — analyse d'une image 1280 px (détection + gabarit + liveness) : 50 ms

| Appel | Médiane | Max | Requêtes SQL | Réponse |
|---|---|---|---|---|
| Reconnaissance faciale 1:N (50 gabarits du site, rafale de 3 images, moteur réel) | 130 ms | 195 ms | 7 | 0.2 Ko |

## Lecture

- **Centre de contrôle** : KPI calculés sur **toute** la population du périmètre (3 000 employés)
  en 7 requêtes, sans N+1 ; ~170 ms sur tous les sites, < 10 ms sur un site. La pagination est
  appliquée après le calcul des KPI (qui exigent la population entière) : la page 60 coûte comme
  la page 1. Au-delà de ~10 000 employés dans un même périmètre, prévoir une agrégation SQL.
- **Employé 360** : 5 ms, un appel.
- **Flux pointeur** : 4 requêtes, filtrage en SQL (auparavant : relecture intégrale de la
  collection `attendanceQrScans` à chaque rafraîchissement).
- **Écriture Attendance Core** : ~12 ms pour un scan complet (verrou, idempotence, journée
  legacy, anomalies, audit).
- **Reconnaissance faciale** : ~130 ms pour une rafale de 3 images (≈ 50 ms d'analyse par image)
  et 50 gabarits. **N+1 trouvé et corrigé par ce benchmark** : 57 requêtes → 7 (le contrôle
  « photo modifiée » relisait et re-hachait la photo de chaque candidat à chaque passage).
- **Terminal, bout en bout** (E2E Chrome, caméra Dahua simulée) : ouverture de la vue →
  « POINTAGE ENREGISTRÉ » ≈ 1 s. Avec une vraie caméra, ajouter la latence réseau de trois
  instantanés 5 MP — à mesurer sur site (`docs/attendance-hardware-checklist.md`).
