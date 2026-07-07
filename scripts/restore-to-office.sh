#!/usr/bin/env bash
#
# restore-to-office.sh — À exécuter SUR le serveur du bureau, dans le dossier du projet.
# Restaure la base + les photos issues de migrate-from-ovh.sh dans la stack Docker Compose.
#
# Usage :
#   bash scripts/restore-to-office.sh sgdi_<date>.dump uploads_<date>.tar.gz
#
# Prérequis :
#   - .env.production rempli (mêmes POSTGRES_* et surtout MÊME JWT_SECRET que la prod)
#   - docker compose disponible
#
# Le script :
#   1) démarre uniquement PostgreSQL
#   2) restaure le dump complet (la base arrive stampée à la dernière migration)
#   3) restaure les photos dans le volume persistant sgdi_uploads
#   4) démarre l'application
#
set -euo pipefail

DUMP_FILE="${1:?Usage: restore-to-office.sh <dump> <uploads.tar.gz>}"
UPLOADS_TAR="${2:?Usage: restore-to-office.sh <dump> <uploads.tar.gz>}"

# Charge POSTGRES_USER / POSTGRES_DB depuis .env.production si présent
ENV_FILE="${ENV_FILE:-.env.production}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
PG_USER="${POSTGRES_USER:?POSTGRES_USER manquant (dans $ENV_FILE)}"
PG_DB="${POSTGRES_DB:?POSTGRES_DB manquant (dans $ENV_FILE)}"

COMPOSE="docker compose --env-file ${ENV_FILE}"

echo "[1/4] Démarrage de PostgreSQL seul..."
$COMPOSE up -d postgres
echo "    Attente que PostgreSQL soit prêt..."
until $COMPOSE exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; do
  sleep 2
done

echo "[2/4] Restauration de la base (${DUMP_FILE})..."
$COMPOSE exec -T postgres pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists < "$DUMP_FILE" \
  || echo "    (avertissements pg_restore ignorables sur objets inexistants)"

echo "[3/4] Restauration des photos dans le volume sgdi_uploads..."
TMP_DIR="$(mktemp -d)"
tar xzf "$UPLOADS_TAR" -C "$TMP_DIR"
# uploads_backup contient le dossier copié depuis /app/uploads
docker run --rm \
  -v sgdi_uploads:/dest \
  -v "${TMP_DIR}/uploads_backup":/src:ro \
  alpine sh -c "cp -a /src/. /dest/ && echo '    photos copiées'"
rm -rf "$TMP_DIR"

echo "[4/4] Démarrage de l'application..."
$COMPOSE up -d

echo
echo "Terminé. Vérifier : docker compose logs -f sgdi"
echo "Puis /health et /health/db (migration attendue : dernière révision Alembic)."
