#!/usr/bin/env bash
#
# backup_restore_test.sh — Restauration D'ESSAI d'une sauvegarde produite par backup.sh.
#
# Déchiffre l'archive dans un dossier privé, restaure la base dans une base JETABLE créée par
# ce script, puis vérifie : sommes de contrôle, nombre de tables, de contraintes et d'index,
# nombre de lignes de chaque table, révision Alembic, et chaque fichier archivé.
#
# Garde-fous : la base cible est toujours nouvelle, nommée  atlas_restore_test_<date>_<pid> ;
# le script refuse de continuer si elle existe déjà et ne supprime que la base qu'il a créée.
# Il ne restaure jamais dans une base existante.
#
# Usage :  backup_restore_test.sh <atlas-backup_….tar.gpg>
#
# Variables :
#   RESTORE_PG_CONTAINER      conteneur PostgreSQL d'essai (vide : outils locaux, variables PG*)
#   RESTORE_PG_USER           rôle autorisé à créer une base
#   RESTORE_PG_MAINTENANCE_DB base de connexion pour les contrôles (défaut : postgres)
#   RESTORE_PASSPHRASE_FILE   fichier privé (600) si l'archive est chiffrée par phrase secrète ;
#                             sinon la clé privée doit être dans le trousseau GnuPG courant
#   RESTORE_WORK_DIR          dossier parent du dossier de travail (défaut : TMPDIR ou /tmp)
#   RESTORE_REPORT            fichier où écrire le rapport
#   RESTORE_KEEP_DB           1 : conserver la base d'essai (à supprimer ensuite à la main)
#
# Code de retour : 0 si tous les contrôles passent, 1 sinon.
#
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_lib.sh
. "${SCRIPT_DIR}/backup_lib.sh"

ARCHIVE="${1:?Usage : backup_restore_test.sh <atlas-backup_….tar.gpg>}"
PG_CONTAINER="${RESTORE_PG_CONTAINER:-}"
PG_USER="${RESTORE_PG_USER:-}"
MAINT_DB="${RESTORE_PG_MAINTENANCE_DB:-postgres}"
TARGET="atlas_restore_test_$(date -u +%Y%m%d%H%M%S)_$$"
WORK=""
CREATED=0
FAILURES=0
REPORT_LINES=""

report() { REPORT_LINES="${REPORT_LINES}$*
"; log "$*"; }
ok()   { report "  OK      $*"; }
fail() { report "  ÉCHEC   $*"; FAILURES=$((FAILURES + 1)); }

finish() {
  local rc=$?
  trap - EXIT
  [ -n "$WORK" ] && rm -rf "$WORK"
  if [ "$CREATED" = 1 ] && [ "${RESTORE_KEEP_DB:-0}" != 1 ]; then
    case "$TARGET" in
      atlas_restore_test_*) pg_run dropdb --if-exists "$TARGET" >/dev/null 2>&1 \
                              || log "ATTENTION : base d'essai ${TARGET} non supprimée" >&2 ;;
    esac
  fi
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

need gpg tar find sort python3
if [ -n "$PG_CONTAINER" ]; then need docker; else need pg_restore psql createdb dropdb; fi
[ -f "$ARCHIVE" ] || die "archive introuvable : ${ARCHIVE}"
[ -z "${RESTORE_PASSPHRASE_FILE:-}" ] || require_private "$RESTORE_PASSPHRASE_FILE"

exists="$(pg_query "$MAINT_DB" "select count(*) from pg_database where datname = '${TARGET}'")"
[ "$exists" = 0 ] || die "la base ${TARGET} existe déjà : refus"

report "Restauration d'essai de $(basename "$ARCHIVE")"

# ── Archive ──────────────────────────────────────────────────────────────────────────────
if [ -f "${ARCHIVE}.sha256" ]; then
  expected="$(cut -d' ' -f1 "${ARCHIVE}.sha256")"
  if [ "$expected" = "$(sha256_of "$ARCHIVE")" ]; then ok "somme de contrôle de l'archive chiffrée"
  else fail "somme de contrôle de l'archive chiffrée"; die "archive altérée : restauration refusée"; fi
else
  report "  INFO    pas de fichier .sha256 à côté de l'archive"
fi

WORK="$(mktemp -d "${RESTORE_WORK_DIR:-${TMPDIR:-/tmp}}/atlas-restore.XXXXXX")"
mkdir "${WORK}/bundle"
# GPG peut produire du clair avant de signaler une erreur d’intégrité en fin de flux.
# Ne jamais donner ce flux à tar : attendre son succès complet, puis valider toutes
# les archives et leurs fichiers AVANT createdb / pg_restore.
if gpg_decrypt "$ARCHIVE" > "${WORK}/bundle.tar"; then ok "déchiffrement"
else die "déchiffrement impossible (clé ou intégrité GPG incorrecte)"; fi
if python3 "${SCRIPT_DIR}/backup_archive_check.py" "${WORK}/bundle.tar" "$WORK"; then
  ok "extraction et sommes de contrôle du contenu et des fichiers"
else die "archive invalide : restauration refusée"; fi
B="${WORK}/bundle"
if ! pg_run pg_restore --list < "${B}/db.dump" > "${WORK}/toc.list" 2> "${WORK}/toc.error"; then
  die "dump PostgreSQL invalide : restauration refusée"
fi

# ── Base ─────────────────────────────────────────────────────────────────────────────────
pg_run createdb "$TARGET"
CREATED=1
if pg_run pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET" < "${B}/db.dump" > "${WORK}/restore.log" 2>&1; then
  ok "pg_restore dans ${TARGET}"
else
  fail "pg_restore dans ${TARGET} ($(tail -n 1 "${WORK}/restore.log"))"
fi

pg_structure "$TARGET" > "${WORK}/structure.txt"
for key in tables constraints indexes; do
  want="$(manifest_get "${B}/manifest.txt" "$key")"; got="$(manifest_get "${WORK}/structure.txt" "$key")"
  if [ -n "$want" ] && [ "$want" = "$got" ]; then ok "${key} : ${got}"
  else fail "${key} : ${got} restaurés, ${want} attendus"; fi
done

want="$(manifest_get "${B}/manifest.txt" alembic_version)"
got="$(pg_query "$TARGET" "select version_num from alembic_version limit 1" 2>/dev/null || true)"
if [ "$want" = "$got" ]; then ok "révision Alembic : ${got:-aucune}"
else fail "révision Alembic : ${got} restaurée, ${want} attendue"; fi

# Chaque table doit contenir un nombre de lignes compris entre le relevé d'avant et celui
# d'après le dump (identiques sur une base au repos).
pg_row_counts "$TARGET" > "${WORK}/row_counts_restored.tsv"
mismatches="$(awk -F '\t' '
  FILENAME == ARGV[1] { before[$1] = $2; next }
  FILENAME == ARGV[2] { after[$1] = $2; next }
  { seen[$1] = 1
    if (!($1 in before)) { print $1 " : table inattendue"; next }
    lo = before[$1] + 0; hi = after[$1] + 0; if (lo > hi) { t = lo; lo = hi; hi = t }
    if ($2 + 0 < lo || $2 + 0 > hi) print $1 " : " $2 " lignes, attendu " lo (lo == hi ? "" : " à " hi) }
  END { for (t in before) if (!(t in seen)) print t " : table absente" }
' "${B}/row_counts_before.tsv" "${B}/row_counts_after.tsv" "${WORK}/row_counts_restored.tsv")"
total_rows="$(awk -F '\t' '{ s += $2 } END { print s + 0 }' "${WORK}/row_counts_restored.tsv")"
if [ -z "$mismatches" ]; then
  ok "nombre de lignes de chaque table ($(wc -l < "${WORK}/row_counts_restored.tsv" | tr -d ' ') tables, ${total_rows} lignes)"
else
  fail "nombre de lignes : écarts ci-dessous"
  report "$(printf '%s\n' "$mismatches" | sed 's/^/            /')"
fi

# ── Fichiers ─────────────────────────────────────────────────────────────────────────────
restored_files=0
for label in $(manifest_get "${B}/manifest.txt" files_sets); do
  if sha256_check "${WORK}/files/${label}" "${B}/files/${label}.sha256"; then
    n="$(find "${WORK}/files/${label}" -type f | wc -l | tr -d ' ')"
    restored_files=$((restored_files + n))
    if [ "$n" = "$(wc -l < "${B}/files/${label}.sha256" | tr -d ' ')" ]; then ok "fichiers « ${label} » : ${n}, tous vérifiés"
    else fail "fichiers « ${label} » : ${n} extraits, nombre différent de la liste"; fi
  else
    fail "fichiers « ${label} » : extraction ou somme de contrôle"
  fi
done
want="$(manifest_get "${B}/manifest.txt" files_total)"
if [ "$restored_files" = "$want" ]; then ok "total des fichiers : ${restored_files}"
else fail "total des fichiers : ${restored_files} restaurés, ${want} attendus"; fi

if [ "$FAILURES" = 0 ]; then report "RÉSULTAT : RESTAURATION D'ESSAI RÉUSSIE (sauvegarde du $(manifest_get "${B}/manifest.txt" created_utc))"
else report "RÉSULTAT : ${FAILURES} CONTRÔLE(S) EN ÉCHEC"; fi
if [ -n "${RESTORE_REPORT:-}" ]; then printf '%s' "$REPORT_LINES" > "$RESTORE_REPORT"; fi
[ "${RESTORE_KEEP_DB:-0}" != 1 ] || report "Base d'essai conservée : ${TARGET}"
[ "$FAILURES" = 0 ]
