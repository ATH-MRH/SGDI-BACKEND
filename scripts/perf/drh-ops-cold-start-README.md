# DRH + OPS cold-start harness (Chrome réel, conteneur réel)

**À lire d'abord** : ce dossier contenait déjà, avant ce lot, un harnais DRH
spécifique et plus poussé — voir `README.md` (profiling backend SQL/ORM/
sérialisation via un serveur ASGI synthétique) et `frontend-README.md`
(mesure navigateur détaillée, y compris le suivi des requêtes dupliquées,
Long Tasks, Resource Timing complet). Ce fichier-ci documente un harnais
complémentaire, pas un remplacement — voir la comparaison en bas de page.

Mesure reproductible du cold start des modules DRH et OPS via un vrai Chrome
(Puppeteer-core, CDP — aucun Chromium téléchargé, réutilise une install Chrome
existante) contre un vrai conteneur `docker-compose` (Postgres réel, pas de
SQLite/ASGI synthétique). Ne cible jamais un domaine réel : toujours une
instance locale ou de test passée explicitement.

## Utilisation

```sh
BASE_URL=http://127.0.0.1:8001 \
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node scripts/perf/drh-ops-cold-start.js \
  --runs 5 --user <utilisateur_de_test> --password <mot_de_passe> \
  --societe "Nom Société" --out scripts/perf/results.json
```

Alterne DRH/OPS/DRH/OPS/... (jamais 5+5 d'affilée), profil Chrome jetable à
chaque passage froid, cache HTTP désactivé. `--mode warm` réutilise le même
profil et active le cache pour une mesure de comparaison "retour utilisateur".

`PERF_DEBUG=1` en préfixe affiche la console/les erreurs de la page pour le
débogage.

**Important** : n'utilisez jamais le compte `admin` (ou tout nom correspondant
au motif « Administration système », voir `isAdminSystemUsernameCandidate`
dans `sgdi-app.js`) — ce compte bascule sur un flux de connexion différent
(`#/admin/dashboard`) qui ne traverse pas le portail société normal. Utilisez
un compte de test dédié, `role: admin`, nom d'utilisateur ordinaire.

## Définition de firstReady

`firstReady` = apparition d'un marqueur texte stable du tableau de bord
(`TABLEAU DE BORD` pour DRH, `NBR SITE` pour OPS) après un clic programmatique
réel sur la tuile du module depuis le portail société
(`window.enterSocietePortalRoute(...)`, exactement l'appel déclenché par un
vrai clic utilisateur) — jamais un sélecteur CSS interne fragile (deviné puis
invalidé une première fois pendant cette investigation, voir DRH Cold Start V2).

## Fichiers de ce dossier ajoutés par ce lot

- `drh-ops-cold-start.js` — le harnais lui-même
- `results_base.json` — 5 passages froids alternés DRH/OPS, AVANT le correctif de coalescing (2026-09-19)
- `results_after.json` — les mêmes 5 passages, APRÈS le correctif (2026-09-19)
- `summary.csv` — comparatif médian/min/max extrait des deux fichiers ci-dessus

## Complémentarité avec le harnais existant

| | Existant (`drh_backend_bench.py` / `frontend-browser-server.js`) | Ce lot (`drh-ops-cold-start.js`) |
|---|---|---|
| Modules couverts | DRH uniquement | DRH **et** OPS |
| Backend mesuré | ASGI synthétique + SQLite en mémoire | Vrai conteneur Docker + PostgreSQL réel |
| Niveau de détail | Très fin (SQL, ORM, sérialisation) | Réseau/navigateur (waterfall, firstReady) |
| Détection de doublons de requêtes | Déjà suivie | Découverte indépendamment dans ce lot, confirme l'existant |

Pour une investigation future, privilégier le harnais existant pour un
diagnostic SQL/ORM fin sur DRH, et celui-ci pour une mesure de bout en bout
incluant OPS et un vrai PostgreSQL.
