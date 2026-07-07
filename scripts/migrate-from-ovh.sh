#!/usr/bin/env bash
#
# migrate-from-ovh.sh — À exécuter SUR le VPS OVH.
# Produit deux artefacts à transférer vers le serveur du bureau :
#   1) sgdi_<date>.dump      : dump PostgreSQL COMPLET (schéma + données + séquences + alembic_version)
#   2) uploads_<date>.tar.gz : dossier des photos/fichiers (/app/uploads), NON inclus dans le dump SQL
#
# Prérequis : Docker installé, conteneurs PostgreSQL et app en cours d'exécution.
#
# Variables (via env ou édition ci-dessous) :
#   PG_CONTAINER   nom du conteneur PostgreSQL   (ex: sgdi-postgres-1)
#   APP_CONTAINER  nom du conteneur applicatif    (ex: sgdi-sgdi-1)
#   PG_USER        utilisateur PostgreSQL
#   PG_DB          nom de la base
#   UPLOADS_PATH   chemin des uploads dans le conteneur app (défaut: /app/uploads)
#
# Repérer les noms : docker ps
# Repérer user/db  : docker exec <APP_CONTAINER> env | grep POSTGRES
#
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:?Définir PG_CONTAINER (voir: docker ps)}"
APP_CONTAINER="${APP_CONTAINER:?Définir APP_CONTAINER (voir: docker ps)}"
PG_USER="${PG_USER:?Définir PG_USER}"
PG_DB="${PG_DB:?Définir PG_DB}"
UPLOADS_PATH="${UPLOADS_PATH:-/app/uploads}"

STAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="sgdi_${STAMP}.dump"
UPLOADS_TAR="uploads_${STAMP}.tar.gz"

echo "[1/3] Dump PostgreSQL complet -> ${DUMP_FILE}"
docker exec -t "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$DUMP_FILE"

echo "[2/3] Copie des photos/fichiers (${UPLOADS_PATH})"
rm -rf uploads_backup
docker cp "${APP_CONTAINER}:${UPLOADS_PATH}" uploads_backup
tar czf "$UPLOADS_TAR" uploads_backup
rm -rf uploads_backup

echo "[3/3] Terminé."
echo "  Base   : ${DUMP_FILE}   ($(du -h "$DUMP_FILE" | cut -f1))"
echo "  Photos : ${UPLOADS_TAR} ($(du -h "$UPLOADS_TAR" | cut -f1))"
echo
echo "IMPORTANT : récupérer aussi le JWT_SECRET de production pour le réutiliser"
echo "            à l'identique sur le serveur du bureau (sinon QR badges/sessions cassés) :"
echo "  docker exec ${APP_CONTAINER} env | grep JWT_SECRET"
echo
echo "Transférer vers le bureau :  scp ${DUMP_FILE} ${UPLOADS_TAR} user@bureau:/chemin/"
