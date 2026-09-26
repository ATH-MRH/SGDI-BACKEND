# DRH Next — audit des 8 commits non intégrés (`feat/drh-next-v1-finish`)

Date : 2026-09-26 · Base : `origin/main` = `24dbf60` · Branche auditée : `feat/drh-next-v1-finish` (`c96bf17`, 21/09).
Point de départ commun : `bc43074` (déjà dans `main`).

Méthode : pour chaque commit, recherche de son effet dans `main` (SHA équivalents après rebase,
présence ligne à ligne du code ajouté, présence des tests). **Aucun cherry-pick effectué.**

Légende : A = déjà présent autrement dans main · B = encore utile · C = obsolète ·
D = dangereux/incompatible · E = à réimplémenter partiellement.

| Commit | Objectif | État actuel dans `main` | Décision | Justification |
|---|---|---|---|---|
| `c99e23a` fix(drh-next): remove dead sidebar entries leading to placeholder screens | Retirer « Pointage » et « Alertes » de la navigation DRH Next (écrans « bientôt disponible ») + test de navigation `smoke-navigation.test.mjs` | **Absent** : `app/static/drh-next/app.mjs` contient toujours `COMING_SOON_LOT = { attendance: null, alerts: null }` et `renderComingSoon` | **E** | L'entrée « Pointage » ne doit plus être supprimée : cette mission (Attendance V1) lui donne un vrai contenu (lien vers le centre de contrôle `pointage.irongs.com` et onglet Pointages de l'Employé 360). L'entrée « Alertes » reste un écran vide → son retrait reste utile. Réimplémenté dans le lot DRH Next de cette mission, avec un test de navigation. |
| `2e07ed7` docs(drh-next): document navigation smoke audit, reclassify upload debt | Documenter l'audit de navigation de `c99e23a` dans `docs/drh-next-v1-parity.md` | Absent (le mot « smoke » n'apparaît pas dans la matrice de parité) | **C** | Décrit un état (menu sans Pointage) que cette mission rend faux. La matrice sera mise à jour avec l'état réel après le lot DRH Next. |
| `b625ab2` harden(dashboard): make general dashboard KPIs independent of db.agents | KPI du tableau de bord général calculés depuis l'agrégat serveur, jamais depuis `db.agents` | **Présent** : 23/23 lignes ajoutées retrouvées dans `sgdi-app.js` ; `tests_frontend/dashboard-perf.test.js` présent (6 tests) et câblé dans `npm test` | **A** | Intégré par un autre chemin (rebase de la branche performance). |
| `7490efe` docs(drh-performance): document ATLAS-EMPLOYEES-BOOTSTRAP and ATLAS-LEAVES-DUAL-STORE debt | Documentation de dette | **Présent** : `0692a36` (même titre) | **A** | Réintégré après rebase. |
| `a2aaf4d` fix(drh): flatten Employee.extra bloat, add light mode for /employees | `?light=1` sur `GET /api/drh/employees`, aplatissement de `extra._legacy` | **Présent** : `078b450` (même titre) ; `light: bool = False` dans `app/modules/drh/routes.py` | **A** | Réintégré après rebase. |
| `f1e08ac` test(drh): prove GET /employees never mutates stored Employee.extra | Test de non-mutation | **Présent** : `01438bc` ; `test_get_never_mutates_employee_extra_in_database` dans `tests/test_drh_employees_payload.py` | **A** | Réintégré après rebase. |
| `f6ec272` perf(frontend): use lightweight employees payload at bootstrap | Chargement initial via `?light=1` | **Présent** : 13 occurrences du mode léger dans `sgdi-app.js` | **A** | Réintégré après rebase. |
| `c96bf17` docs(drh-performance): update ATLAS-EMPLOYEES-BOOTSTRAP, add DRH-EMPLOYEES-PAGE-EXTRA-BLOAT | Documentation de dette | **Présent** : `d3886a5` (même titre) | **A** | Réintégré après rebase. |

## Conclusion

- 6 commits sur 8 sont déjà dans `main` (A) : rien à récupérer.
- `c99e23a` (E) : seule valeur restante = retirer l'entrée morte « Alertes » et donner un vrai
  contenu à « Pointage ». Traité dans le lot DRH Next de la mission Attendance V1.
- `2e07ed7` (C) : obsolète, remplacé par la mise à jour de la matrice de parité en fin de mission.
- La branche `feat/drh-next-v1-finish` peut être considérée comme close une fois ce lot intégré.
