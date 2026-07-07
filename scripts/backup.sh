#!/usr/bin/env bash
#
# backup.sh — Sauvegarde quotidienne CHIFFRÉE (base + photos) avec rotation.
# À planifier via cron sur le serveur du bureau, dans le dossier du projet.
#
# Produit un fichier unique chiffré :  sgdi-backup_<date>.tar.gz.gpg
# contenant le dump PostgreSQL + les photos. Chiffrement symétrique GPG (AES256).
#
# Variables (via env) :
#   BACKUP_DIR          répertoire de destination        (défaut: ./backups)
#   BACKUP_PASSPHRASE   phrase de chiffrement (OBLIGATOIRE)
#   KEEP_DAYS           nombre de jours à conserver       (défaut: 14)
#   ENV_FILE            fichier d'env compose             (défaut: .env.production)
#   OFFSITE_DEST        cible rsync/scp hors-site (option, ex: user@nas:/backups/sgdi)
#
# Exemple cron (tous les jours à 2h) :
#   0 2 * * * cd /opt/sgdi && BACKUP_PASSPHRASE='motdepasse_fort' bash scripts/backup.sh >> /var/log/sgdi-backup.log 2>&1
#
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
PG_USER="${POSTGRES_USER:?POSTGRES_USER manquant (dans $ENV_FILE)}"
PG_DB="${POSTGRES_DB:?POSTGRES_DB manquant (dans $ENV_FILE)}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:?Définir BACKUP_PASSPHRASE}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

COMPOSE="docker compose --env-file ${ENV_FILE}"
STAMP="$(date +%Y%m%d_%H%M%S)"
WORK="$(mktemp -d)"
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Sauvegarde SGDI démarrée"

echo "  - dump PostgreSQL"
$COMPOSE exec -T postgres pg_dump -U "$PG_USER" -Fc "$PG_DB" > "${WORK}/db.dump"

echo "  - archive des photos (volume sgdi_uploads)"
docker run --rm -v sgdi_uploads:/src:ro -v "${WORK}":/out alpine \
  sh -c "tar czf /out/uploads.tar.gz -C /src ."

echo "  - assemblage + chiffrement (AES256)"
tar czf "${WORK}/bundle.tar.gz" -C "$WORK" db.dump uploads.tar.gz
OUT="${BACKUP_DIR}/sgdi-backup_${STAMP}.tar.gz.gpg"
gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "$BACKUP_PASSPHRASE" -o "$OUT" "${WORK}/bundle.tar.gz"

rm -rf "$WORK"
echo "  - créé : ${OUT} ($(du -h "$OUT" | cut -f1))"

echo "  - rotation (> ${KEEP_DAYS} jours)"
find "$BACKUP_DIR" -name 'sgdi-backup_*.tar.gz.gpg' -type f -mtime "+${KEEP_DAYS}" -delete || true

if [ -n "${OFFSITE_DEST:-}" ]; then
  echo "  - copie hors-site vers ${OFFSITE_DEST}"
  rsync -a "$OUT" "$OFFSITE_DEST/" || echo "    (échec copie hors-site, sauvegarde locale conservée)"
fi

echo "[$(date)] Sauvegarde terminée"
echo
echo "Restauration d'une sauvegarde chiffrée :"
echo "  gpg --batch --passphrase '<phrase>' -d sgdi-backup_<date>.tar.gz.gpg | tar xz"
echo "  -> fournit db.dump (pg_restore) et uploads.tar.gz"
