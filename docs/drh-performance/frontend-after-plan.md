# Campagne APRÈS — protocole figé

Ce document décrit le protocole de mesure à rejouer après les trois corrections. Il ne contient pas encore de résultats après.

## Conditions communes

- Même fixture que le navigateur avant : `/private/tmp/atlas-drh-bench-v2-reset-server/synthetic.sqlite`, avec son marqueur `synthetic-benchmark.json` (`seed_version: 2`, 1 000 employés, 500 candidats, 50 sites).
- Même navigateur Chrome 152 et même onglet piloté par CUA; trois navigations complètes successives, sans modifier la taille de fenêtre.
- Même observateur `scripts/perf/frontend-browser-observer.js`, SHA-256 **`efc806ea2a214e179a7b68eef03dbd4894b900eacc33643d0a6c869047252497`**.
- Même flux automatique DRH → Employés actifs → DRH, même session synthétique, mêmes exclusions réseau et service worker.
- Remise à zéro des caches mémoire du backend avant chaque ouverture froide, puis maintien de ces caches lors des deux transitions internes. Les caches SQLite/OS ne sont pas vidés.
- Aucun profil backend ni suite de tests en parallèle des mesures navigateur. Fermer les anciens onglets de benchmark pour empêcher leurs rafraîchissements périodiques.

## Redémarrage backend après le changement Python

L'instance 8768 a importé le code Python avant correction. Elle ne suffit pas pour mesurer une modification de `service.py`. Arrêter cette instance après fermeture de ses anciens contextes, puis redémarrer le code corrigé sur 8769 avec **la même base synthétique** :

```sh
python3 scripts/perf/drh_backend_bench.py serve --agents 1000 --out /private/tmp/atlas-drh-bench-v2-reset-server --port 8769
```

Le marqueur existant empêche un nouveau peuplement. Vérifier `/health` et le fonctionnement de `POST /__perf__/reset-caches`; ce dernier doit répondre 200, et aucune campagne ne doit commencer sur un 409. Le changement de port permet d'identifier clairement l'instance ayant chargé le nouveau code.

## Proxy et trois navigations

Vérifier d'abord l'identité de l'observateur :

```sh
shasum -a 256 scripts/perf/frontend-browser-observer.js
```

Démarrer le même proxy avec les nouveaux ports et un préfixe distinct pour les preuves après :

```sh
node scripts/perf/frontend-browser-server.js --base http://127.0.0.1:8769 --port 8773 --reset-caches --out /private/tmp/drh-browser-cold-after
```

Dans le même onglet Chrome, naviguer vers `http://127.0.0.1:8773/`. Attendre le titre `DRH benchmark complete` et le rapport JSON annoncé par le proxy. Refaire deux navigations complètes vers cette URL, séquentiellement. Chaque navigation efface uniquement le stockage de cette origine synthétique, remet à zéro les caches serveur et recrée la session.

Rapports attendus : `/private/tmp/drh-browser-cold-after-{1,2,3}.json`. Après validation, les conserver sous `docs/drh-performance/browser-after-{1,2,3}.json`, puis agréger :

```sh
python3 scripts/perf/frontend-summarize.py docs/drh-performance/browser-after-1.json docs/drh-performance/browser-after-2.json docs/drh-performance/browser-after-3.json --out docs/drh-performance/frontend-after-summary.json
```

## Validation des preuves

- Aucun `failure`, aucune erreur inattendue, toutes les requêtes mesurées en HTTP 2xx.
- SHA-256 d'observateur et `backendCachePolicy` identiques aux trois rapports avant.
- Toujours 1 000 employés et 500 candidats disponibles si les corrections conservent le référentiel complet; 572 lignes actives visibles attendues dans cette fixture. Une baisse due à une liste vide, à une erreur ou à une modification des filtres n'est pas un gain de performance.
- Comparer les médianes **et** min/max des mêmes métriques, sans sélectionner le meilleur run.
- Les coûts de fonction sont inclusifs et imbriqués; les temps `innerHTML`, parcours de traduction et layout ne s'additionnent pas librement. Les définitions figurent dans `frontend-before.md`.
- Conserver distincts le payload JSON API, les scripts et le reste des ressources. Aucun résultat loopback ne doit être présenté comme un débit ou une latence de production.

## Campagnes backend séparées

Les profils backend 100 employés puis 1 000 employés, cinq répétitions chacun, sont exécutés séquentiellement en dehors des trois navigations navigateur. Ils utilisent le même `seed_version: 2` et le même jour de fixture. Le responsable backend confirme les répertoires synthétiques à réutiliser ou leurs copies équivalentes; ne pas réinitialiser une base existante non marquée.

```sh
python3 scripts/perf/drh_backend_bench.py profile --agents 100 --out /private/tmp/atlas-drh-after-100 --repeats 5
python3 scripts/perf/drh_backend_bench.py profile --agents 1000 --out /private/tmp/atlas-drh-after-1000 --repeats 5
```

Les deux commandes ci-dessus doivent être lancées l'une après la fin de l'autre. Les rapports backend mesurent ASGI/SQLite et sérialisation; leur somme ne remplace pas le temps navigateur et ne doit pas être ajoutée à des requêtes déjà mesurées côté navigateur.
