#!/usr/bin/env bash
#
# backup-coolify.sh — Sauvegarde ponctuelle (base + fichiers) d'une production déployée par Coolify.
#
# À la différence de backup.sh (docker compose + volume sgdi_uploads), ce script vise l'organisation
# Coolify : PostgreSQL dans un conteneur séparé, fichiers dans un dossier de l'hôte monté dans
# l'application. Il ne modifie ni la base ni les fichiers : il lit, écrit dans BACKUP_DIR, vérifie.
#
# Usage, sur le serveur, en root :
#   bash backup-coolify.sh <conteneur_postgres> <dossier_fichiers_hote> [base]
#
# Variables (via env) :
#   BACKUP_DIR   répertoire de destination (défaut : /root/backups/atlas)
#
# L'utilisateur PostgreSQL est lu dans le conteneur ; aucun identifiant n'est affiché ni écrit.
#
set -euo pipefail
umask 077

DB_CONTAINER="${1:?conteneur PostgreSQL manquant}"
FILES_DIR="${2:?dossier des fichiers manquant}"
DB_NAME="${3:-sgdi}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/atlas}"
STAMP="$(date -u +%Y%m%d_%H%M%SZ)"
OUT="${BACKUP_DIR}/${STAMP}"

fail() { echo "ÉCHEC : $*" >&2; exit 1; }
in_db() { docker exec -i "$DB_CONTAINER" sh -c "$1"; }
sql() { in_db "psql -U \"\$POSTGRES_USER\" -d '$DB_NAME' -v ON_ERROR_STOP=1 -Atc \"$1\""; }

[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" = "true" ] || fail "conteneur $DB_CONTAINER introuvable ou arrêté"
[ -d "$FILES_DIR" ] || fail "dossier $FILES_DIR introuvable"
sql "select 1" >/dev/null || fail "connexion à la base $DB_NAME impossible"

mkdir -p "$OUT"
FREE_KB="$(df -Pk "$OUT" | awk 'NR==2 {print $4}')"
NEED_KB="$(( $(sql "select pg_database_size(current_database())/1024") + $(du -sk "$FILES_DIR" | cut -f1) ))"
[ "$FREE_KB" -gt "$(( NEED_KB * 2 ))" ] || fail "espace disque insuffisant dans $BACKUP_DIR"

echo "[1/4] Export PostgreSQL ($DB_NAME)"
in_db "pg_dump -U \"\$POSTGRES_USER\" -Fc --no-owner --no-privileges '$DB_NAME'" > "$OUT/db.dump"

echo "[2/4] Archive des fichiers ($FILES_DIR)"
tar -czf "$OUT/files.tar.gz" -C "$FILES_DIR" .

echo "[3/4] Vérification"
[ -s "$OUT/db.dump" ] || fail "export PostgreSQL vide"
TABLES_LIVE="$(sql "select count(*) from pg_tables where schemaname='public'")"
TABLES_DUMP="$(in_db "pg_restore --list" < "$OUT/db.dump" | grep -c ' TABLE DATA public ' || true)"
[ "$TABLES_DUMP" -eq "$TABLES_LIVE" ] || fail "l'export contient $TABLES_DUMP tables, la base en a $TABLES_LIVE"
FILES_LIVE="$(find "$FILES_DIR" -type f | wc -l | tr -d ' ')"
FILES_ARCHIVE="$(tar -tzf "$OUT/files.tar.gz" | grep -vc '/$' || true)"
[ "$FILES_ARCHIVE" -eq "$FILES_LIVE" ] || fail "l'archive contient $FILES_ARCHIVE fichiers, le dossier en a $FILES_LIVE"

echo "[4/4] Inventaire et empreintes"
{
  echo "date_utc=$STAMP"
  echo "base=$DB_NAME"
  echo "postgresql=$(sql "show server_version")"
  echo "alembic_version=$(sql "select version_num from alembic_version")"
  echo "taille_base=$(sql "select pg_size_pretty(pg_database_size(current_database()))")"
  echo "tables=$TABLES_LIVE"
  echo "fichiers=$FILES_LIVE"
} > "$OUT/INVENTAIRE.txt"
( cd "$OUT" && sha256sum db.dump files.tar.gz INVENTAIRE.txt > SHA256SUMS )

echo
cat "$OUT/INVENTAIRE.txt"
du -h "$OUT"/db.dump "$OUT"/files.tar.gz
echo
echo "Sauvegarde vérifiée : $OUT"
echo "Elle n'est complète qu'une fois copiée hors du serveur et ses empreintes recontrôlées (SHA256SUMS)."
