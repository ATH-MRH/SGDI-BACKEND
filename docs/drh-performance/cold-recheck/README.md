# Reproduction du contrôle cold start

Rapport principal : [drh-cold-start-report.md](../../drh-cold-start-report.md).

Les vingt `*-run-*.json.gz` sont les traces brutes complètes, compressées sans modifier leur JSON. `summary.json` valide l'identité de l'observateur, du navigateur, de la politique de cache, des populations et des phases avant de calculer les médianes/min/max.

1. Archiver les quatre versions avec `git archive 7041c27`, `3b16a2a`, `a35aebc`, `a8aa982` dans quatre répertoires distincts. Ne pas checkout/revert le worktree utilisateur.
2. Copier les trois fichiers `scripts/perf/drh_backend_bench.py`, `frontend-browser-server.js`, `frontend-browser-observer.js` du HEAD documentaire dans chaque archive. Le produit vient de chaque commit ; le harnais est identique.
3. Pour chaque archive, démarrer le backend `python3 scripts/perf/drh_backend_bench.py serve --agents 1000 --out /private/tmp/atlas-drh-bench-v2-reset-server --port PORT`, avec respectivement 8780–8783. Le répertoire doit être celui de la fixture synthétique marquée v2 ; ne jamais utiliser une base existante non marquée.
4. Démarrer les quatre proxies : `node scripts/perf/frontend-browser-server.js --base http://127.0.0.1:PORT_BACKEND --port PORT_PROXY --reset-caches --out /private/tmp/drh-cold-recheck/ETAT-run`, avec 8790–8793 et ETAT base/c1/c2/c3.
5. Un seul onglet Chrome parcourt successivement les URLs localhost dans l'ordre des cinq séries publié dans le rapport. Attendre `DRH benchmark complete` ET l'écriture du JSON avant de naviguer ailleurs. Le scénario interne réalise DRH → Employés actifs → DRH. Ne lancer aucun test en parallèle. Ne retirer aucun passage complet défavorable.
6. Conserver le `measurement-provenance.json` dans chaque archive avec `revision` (SHA complet) et `observerSha256`. Exécuter :

```sh
python3 scripts/perf/drh-cold-recheck-report.py --input /private/tmp/drh-cold-recheck --out docs/drh-performance/cold-recheck
```

La timeline confronte les anciennes traces before-3/after-2 (exactement les anciens passages médians) à c3-run-3, la nouvelle médiane. Les intervalles se chevauchent entre pistes ; seules les cinq tranches contiguës du rapport peuvent s'additionner au cold start.

Validation fonctionnelle exécutée ensuite :

```sh
NODE_PATH='/Users/ath/Downloads/ATLAS 1/node_modules' npm test
python3 -m pytest -q
NODE_PATH='/Users/ath/Downloads/ATLAS 1/node_modules' node --test tests_frontend/drh.test.js tests_frontend/recrute.test.js tests_frontend/router-async.test.js tests_frontend/module-campaign.test.js tests_frontend/shared-files.test.js tests_frontend/module-races.test.js tests_frontend/drh-performance-render.test.js tests_frontend/drh-performance-loading.test.js
```

Journaux : `/private/tmp/drh-cold-recheck/frontend-full.log`, `backend-full.log`, `focused.log`. Résultats : 262 frontend, 557 backend (14 ignorés), 119 ciblés, aucun échec. Syntaxe contrôlée avec `node --check` sur les 75 JS sous `app/static` et `tests_frontend`, puis `git diff --check`.

Limites : SQLite/loopback, caches OS chauds, instrumentation, flux SSE permanent/polices/service worker exclus. Le test statistique exact est exploratoire et ne prouve pas l'équivalence avec cinq paires. Les critères sont exprimés en médiane ; les extrema restent publiés.
