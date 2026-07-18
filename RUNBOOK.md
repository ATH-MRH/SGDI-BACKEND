# RUNBOOK — Optimisation & migration SGDI

Ce document décrit, pas à pas, comment (1) valider les optimisations sur une instance
de **test** OVH avec des sous-domaines dédiés, puis (2) migrer vers le **serveur du bureau**
(données chez vous), avec exposition Internet via **Cloudflare Tunnel**.

Branche de travail : `optimisation-et-migration`.

---

## 0. Ce qui a changé dans cette branche

**Performance**
- Serveur **multi-workers** (Gunicorn + workers Uvicorn) au lieu d'un seul process. Réglable via `WEB_CONCURRENCY` (vide = auto : `2×coeurs + 1`).
- Le **planificateur d'emails** est isolé par un verrou PostgreSQL → un seul worker/conteneur envoie les alertes (plus de doublons).
- Le **démarrage** (création schéma + seed) est sérialisé entre workers par un verrou → pas de course au boot.
- Suppression de la **réécriture des codes employés sur les lectures** (dashboard/listes) — c'était une écriture massive sur de simples affichages.
- **Index composites** ajoutés (migration `20260707_0014`) sur les requêtes chaudes.
- **N+1** réduits dans le pont legacy (`employee_by_ref`/`site_by_ref` : mémo par session).

**Correctifs / staging**
- Module `/finance` réparé (bug d'appel) + filtrage par société ajouté.
- Nom d'hôte du **Portail RH configurable** via `PORTAL_HOSTNAMES` (pour le sous-domaine de test).

**Infra**
- `docker-compose.yml` : **volume persistant `sgdi_uploads`** (les photos ne se perdent plus), service **`cloudflared`** optionnel (profil `tunnel`).
- Scripts : `migrate-from-ovh.sh`, `restore-to-office.sh`, `backup.sh`.

> Aucune de ces modifications ne change les données. `alembic upgrade head` n'ajoute que des index.

---

## PHASE A — Instance de TEST sur OVH (validation fluidité)

Objectif : déployer cette branche sur `test.irongs.com` + `portail-rh-test.irongs.com`,
avec une **copie** de la base de prod, **sans toucher** à la production.

### A.1 DNS (Cloudflare/OVH)
Créer les enregistrements pour les 2 sous-domaines de test pointant vers le service Coolify de test.

### A.2 Base de test = copie de la prod
Sur le VPS OVH :
```bash
# Repérer les conteneurs et identifiants
docker ps
docker exec <APP_CONTAINER> env | grep -E "POSTGRES|JWT_SECRET"

# Dump de la prod
PG_CONTAINER=<pg> APP_CONTAINER=<app> PG_USER=<user> PG_DB=<db> \
  bash scripts/migrate-from-ovh.sh
```
Créer une **nouvelle base** `sgdi_test` et y restaurer le dump (base séparée de la prod).

### A.3 Déploiement Coolify (test)
- Nouveau service Coolify basé sur la branche `optimisation-et-migration`.
- **Build = Dockerfile** (pas Nixpacks).
- Variables d'environnement (copier `.env.production.example`), notamment :
  - `DATABASE_URL` → base **de test** `sgdi_test`
  - `JWT_SECRET` → **le même** que la prod (pour tester les QR badges réels)
  - `PORTAL_HOSTNAMES=portail-rh.irongs.com,portail-rh-test.irongs.com`
  - `CORS_ALLOWED_ORIGINS=https://test.irongs.com,https://portail-rh-test.irongs.com`
  - `WEB_CONCURRENCY=` (laisser vide = auto) ou une valeur fixe (ex. `4`)
  - `STARTUP_MAINTENANCE_ENABLED=false`
- Associer les domaines `test.irongs.com` et `portail-rh-test.irongs.com` au service, port interne `8000`.

### A.4 Vérifications
- `https://test.irongs.com/health` → `ok`
- `https://test.irongs.com/health/db` (admin) → `migration = 20260707_0014`
- `https://test.irongs.com/` → back-office
- `https://portail-rh-test.irongs.com/` → **le Portail RH** doit s'afficher (valide `PORTAL_HOSTNAMES`)
- **Fluidité** : ouvrir dashboard, listes employés, fiches — comparer le ressenti à la prod.
  Vérifier l'en-tête `X-Process-Time-ms` (temps de traitement) sur les requêtes.
- Portail mobile : GPS, scan QR caméra, notifications (HTTPS OK via le domaine).

> Si la fluidité est validée ici, elle le sera aussi sur le serveur du bureau (même image, mêmes optims).

---

## PHASE B — Migration vers le serveur du BUREAU

À faire une fois la Phase A validée. La base et les photos vivent désormais **chez vous**.

### B.1 Prérequis serveur bureau
- Linux (Ubuntu Server conseillé) + **Docker + Docker Compose**.
- **Onduleur (UPS)**, SSD, sauvegardes (voir Phase D).
- Domaine `irongs.com` géré par **Cloudflare** (compte Zero Trust pour le tunnel).

### B.2 Récupérer les données de prod (sur OVH)
```bash
PG_CONTAINER=<pg> APP_CONTAINER=<app> PG_USER=<user> PG_DB=<db> \
  bash scripts/migrate-from-ovh.sh
# Récupérer aussi le JWT_SECRET de prod :
docker exec <app> env | grep JWT_SECRET
```
Transférer `sgdi_<date>.dump` et `uploads_<date>.tar.gz` vers le serveur bureau.

### B.3 Préparer la stack au bureau
```bash
git clone https://github.com/ATH-MRH/SGDI-BACKEND.git /opt/sgdi
cd /opt/sgdi
git checkout optimisation-et-migration
cp .env.production.example .env.production
# éditer .env.production :
#   POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD
#   DATABASE_URL=postgresql+psycopg2://<user>:<pass>@postgres:5432/<db>
#   JWT_SECRET = LE MÊME QUE LA PROD
#   ADMIN_INITIAL_USERNAME / ADMIN_INITIAL_PASSWORD (fort)
#   PORTAL_HOSTNAMES=portail-rh.irongs.com
#   STARTUP_MAINTENANCE_ENABLED=false
```

### B.4 Restaurer base + photos
```bash
bash scripts/restore-to-office.sh sgdi_<date>.dump uploads_<date>.tar.gz
```
Le script démarre PostgreSQL, restaure la base, remet les photos dans le volume `sgdi_uploads`, puis démarre l'app.

### B.5 Exposition Internet via Cloudflare Tunnel
1. Cloudflare Zero Trust → **Tunnels** → créer un tunnel → copier le **token**.
2. Router dans le tunnel (Public Hostnames) vers `http://sgdi:8000` :
   - `atlas.irongs.com` (+ `drh`, `ops`, `materiel`, `finances`, `comptabilite`, `facturation`, `commercial`, `agenda`)
   - `portail-rh.irongs.com`
3. Dans `.env.production` : `CLOUDFLARE_TUNNEL_TOKEN=<token>`
4. Lancer avec le tunnel :
   ```bash
   docker compose --env-file .env.production --profile tunnel up -d
   ```
5. Vérifier `https://atlas.irongs.com/health` et `https://portail-rh.irongs.com/`.

### B.6 Bascule DNS (cutover)
- Fenêtre de maintenance : geler les écritures sur OVH.
- **Dump final** OVH (delta) → restaurer au bureau (rejouer B.2/B.4).
- Basculer le DNS Cloudflare de `atlas.irongs.com` (et sous-domaines) vers le tunnel.
- Vérifier tout (health, login, portail, GPS, QR, photos).
- **Garder OVH en secours** quelques jours avant de couper.

---

## PHASE C — Durcissement sécurité (AVANT ouverture publique)

Obligatoire dès que l'app est joignable depuis Internet :
- [ ] Supprimer / changer le mot de passe du compte `fac01` (créé au démarrage avec mot de passe faible).
- [ ] Régénérer les secrets committés dans `dev.sh` (ne jamais les réutiliser en prod).
- [ ] Mot de passe admin fort ; auditer les comptes à `authorized_societies` vide (= accès toutes sociétés).
- [ ] Activer un **rate-limiting** (règles Cloudflare + niveau app) sur `/api/auth/login` et le portail.
- [ ] Corriger `/api/portal/self-reset-password` (réinitialisation sur infos devinables).
- [ ] `APP_DEBUG=false`, HTTPS uniquement.

> Ces corrections ne sont pas incluses dans cette branche (hors périmètre perf/migration) — à traiter dans une passe sécurité dédiée.

---

## PHASE D — Sauvegardes & résilience (serveur bureau)

La base vit chez vous → les sauvegardes sont VOTRE responsabilité.
```bash
# Test manuel
BACKUP_PASSPHRASE='phrase_forte' bash scripts/backup.sh

# Cron quotidien 2h + copie hors-site
0 2 * * * cd /opt/sgdi && BACKUP_PASSPHRASE='phrase_forte' OFFSITE_DEST='user@nas:/backups/sgdi' \
  bash scripts/backup.sh >> /var/log/sgdi-backup.log 2>&1
```
- [ ] Tester une **restauration** au moins une fois (une sauvegarde non testée n'est pas une sauvegarde).
- [ ] Onduleur en place.

---

## Rollback

- **Phase A** : instance de test isolée — aucun impact prod, il suffit de la supprimer.
- **Phase B/cutover** : si problème après bascule DNS, **repointer le DNS vers OVH** (laissé actif en secours). RTO = propagation DNS.
