#!/usr/bin/env bash
#
# backup.sh — Sauvegarde CHIFFRÉE de la base PostgreSQL et des fichiers de l'application.
#
# Produit  <BACKUP_DIR>/atlas-backup_<date UTC>.tar.gpg  et sa somme  .sha256.
# L'archive contient : db.dump (pg_dump format custom), files/<nom>.tar.gz, les compteurs de
# lignes avant et après le dump, la structure, et les sommes de contrôle de chaque élément.
# Rien n'est écrit en clair dans BACKUP_DIR ; le dossier de travail est privé et toujours effacé.
#
# Configuration : variables d'environnement, ou fichier privé (600) désigné par BACKUP_ENV_FILE.
#   BACKUP_DIR                  dossier des sauvegardes (créé en 700)                  OBLIGATOIRE
#   BACKUP_PG_DB                base à sauvegarder                                     OBLIGATOIRE
#   BACKUP_PG_CONTAINER         conteneur PostgreSQL (vide : pg_dump local, variables PG*)
#   BACKUP_PG_USER              rôle PostgreSQL
#   BACKUP_FILES_DIRS           dossiers à inclure : « nom=/chemin nom2=/chemin2 »
#   BACKUP_FILES_EXCLUDE        motifs exclus des dossiers (défaut : « *.tmp .cache »)
#   BACKUP_GPG_RECIPIENT        empreinte de la clé PUBLIQUE de sauvegarde (recommandé : le
#                               serveur ne peut alors pas déchiffrer ses propres sauvegardes)
#   BACKUP_PASSPHRASE_FILE      à défaut : fichier privé (600) contenant une phrase secrète
#   BACKUP_KEEP_DAYS            âge maximal conservé localement, en jours (défaut 14)
#   BACKUP_KEEP_MIN             nombre minimal de sauvegardes conservées (défaut 7)
#   BACKUP_MIN_FREE_MB          espace libre exigé avant de commencer (défaut 1024)
#   BACKUP_OFFSITE_RCLONE_DEST  destination rclone hors serveur, ex. « coffre:bucket/atlas »
#   BACKUP_OFFSITE_MONTHLY_RCLONE_DEST  destination des archives mensuelles (rétention longue) :
#                               reçoit la première sauvegarde réussie de chaque mois
#   BACKUP_OFFSITE_REQUIRED     1 : l'absence ou l'échec de la copie externe est un échec
#                               (défaut : 1 si une destination est définie, sinon 0)
#   BACKUP_ALERT_COMMAND        commande lancée en cas d'échec (message dans ATLAS_BACKUP_MESSAGE)
#   BACKUP_HEARTBEAT_URL        URL appelée après un succès (surveillance par absence de signal)
#
# Codes de retour : 0 succès ; 75 une autre sauvegarde est en cours ; autre : échec.
# Planification, restauration d'essai et surveillance : docs/backups.md.
#
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_lib.sh
. "${SCRIPT_DIR}/backup_lib.sh"

load_env_file "${BACKUP_ENV_FILE:-}"

BACKUP_DIR="${BACKUP_DIR:?Définir BACKUP_DIR}"
PG_DB="${BACKUP_PG_DB:?Définir BACKUP_PG_DB}"
PG_CONTAINER="${BACKUP_PG_CONTAINER:-}"
PG_USER="${BACKUP_PG_USER:-}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
KEEP_MIN="${BACKUP_KEEP_MIN:-7}"
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-1024}"
FILES_DIRS="${BACKUP_FILES_DIRS:-}"
FILES_EXCLUDE="${BACKUP_FILES_EXCLUDE:-*.tmp .cache}"
OFFSITE_DEST="${BACKUP_OFFSITE_RCLONE_DEST:-}"
OFFSITE_MONTHLY_DEST="${BACKUP_OFFSITE_MONTHLY_RCLONE_DEST:-}"
if [ -n "$OFFSITE_DEST" ]; then OFFSITE_REQUIRED="${BACKUP_OFFSITE_REQUIRED:-1}"; else OFFSITE_REQUIRED="${BACKUP_OFFSITE_REQUIRED:-0}"; fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NAME="${BACKUP_PREFIX}${STAMP}${BACKUP_SUFFIX}"
OUT="${BACKUP_DIR}/${NAME}"
STATUS_DIR="${BACKUP_DIR}/status"
LOCK_DIR="${BACKUP_DIR}/.lock"
WORK=""
STEP="préparation"
LOCKED=0
WRITTEN=0
SEALED=0
OFFSITE_STATE="non configurée"

write_status() {  # write_status <OK|FAILED> <fichier d'état>
  local tmp="${2}.tmp.$$"
  {
    echo "result=$1"
    echo "started=${STARTED}"
    echo "finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "database=${PG_DB}"
    echo "offsite=${OFFSITE_STATE}"
    if [ "$1" = OK ]; then
      echo "file=${NAME}"
      echo "size=$(size_of "$OUT")"
      echo "sha256=$(sha256_of "$OUT")"
    else
      echo "failed_step=${STEP}"
    fi
  } > "$tmp"
  mv -f "$tmp" "$2"
}

finish() {
  local rc=$?
  trap - EXIT
  [ -n "$WORK" ] && rm -rf "$WORK"
  if [ "$LOCKED" = 1 ]; then
    rm -f "${OUT}.partial"
    if [ "$rc" -ne 0 ]; then
      # Jamais de sauvegarde incomplète présentée comme valide ; une archive achevée est gardée
      # même si une étape ultérieure (copie externe) échoue. Ne touche qu'à l'archive de CETTE
      # exécution.
      if [ "$WRITTEN" = 1 ] && [ "$SEALED" = 0 ]; then rm -f "$OUT" "${OUT}.sha256"; fi
      write_status FAILED "${STATUS_DIR}/last_run.status" || true
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED step=${STEP}" >> "${STATUS_DIR}/history.log" || true
      log "ÉCHEC de la sauvegarde à l'étape : ${STEP}" >&2
      if [ -n "${BACKUP_ALERT_COMMAND:-}" ]; then
        ATLAS_BACKUP_MESSAGE="Sauvegarde ATLAS en échec (étape : ${STEP}, base : ${PG_DB})" \
          bash -c "$BACKUP_ALERT_COMMAND" || log "alerte non envoyée" >&2
      fi
    fi
    rm -rf "$LOCK_DIR"
  fi
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── Contrôles préalables ─────────────────────────────────────────────────────────────────
need gpg tar find sort
if [ -n "$PG_CONTAINER" ]; then need docker; else need pg_dump pg_restore psql; fi
if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  gpg --batch --quiet --no-tty --list-keys "$BACKUP_GPG_RECIPIENT" >/dev/null 2>&1 \
    || die "clé publique de sauvegarde absente du trousseau (BACKUP_GPG_RECIPIENT)"
elif [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  require_private "$BACKUP_PASSPHRASE_FILE"
  [ -s "$BACKUP_PASSPHRASE_FILE" ] || die "BACKUP_PASSPHRASE_FILE est vide"
else
  die "aucun chiffrement configuré : définir BACKUP_GPG_RECIPIENT (ou BACKUP_PASSPHRASE_FILE)"
fi
if [ -n "$OFFSITE_DEST" ]; then need rclone
elif [ "$OFFSITE_REQUIRED" = 1 ]; then die "copie hors serveur exigée mais BACKUP_OFFSITE_RCLONE_DEST est vide"; fi
[ -z "$OFFSITE_MONTHLY_DEST" ] || [ -n "$OFFSITE_DEST" ] || die "BACKUP_OFFSITE_MONTHLY_RCLONE_DEST exige BACKUP_OFFSITE_RCLONE_DEST"
for entry in $FILES_DIRS; do
  case "$entry" in
    *=*) [ -d "${entry#*=}" ] || die "dossier à sauvegarder introuvable : ${entry#*=}" ;;
    *) die "BACKUP_FILES_DIRS : entrée « $entry » invalide (attendu nom=/chemin)" ;;
  esac
  case "${entry%%=*}" in *[!A-Za-z0-9_-]*|'') die "BACKUP_FILES_DIRS : nom « ${entry%%=*} » invalide" ;; esac
done

mkdir -p "$BACKUP_DIR" "$STATUS_DIR"
chmod 700 "$BACKUP_DIR" "$STATUS_DIR"

# Une seule sauvegarde à la fois. Un verrou laissé par un processus disparu est repris.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  other="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
    log "une autre sauvegarde est en cours (processus ${other}) : abandon" >&2
    exit 75
  fi
  log "verrou orphelin repris"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ > "${LOCK_DIR}/pid"
LOCKED=1
[ ! -e "$OUT" ] || die "l'archive ${NAME} existe déjà : relancer dans une seconde"

# Restes d'une exécution tuée brutalement : jamais de clair qui traîne.
rm -rf "${BACKUP_DIR}/.work".* 2>/dev/null || true
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.partial' -delete

free_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
[ "$free_kb" -ge $((MIN_FREE_MB * 1024)) ] || die "espace libre insuffisant dans ${BACKUP_DIR} (moins de ${MIN_FREE_MB} Mo)"

WORK="$(mktemp -d "${BACKUP_DIR}/.work.XXXXXX")"
mkdir "${WORK}/bundle" "${WORK}/bundle/files"
B="${WORK}/bundle"

log "Sauvegarde démarrée : base ${PG_DB}"

# ── PostgreSQL ───────────────────────────────────────────────────────────────────────────
STEP="compteurs avant dump"
pg_row_counts "$PG_DB" > "${B}/row_counts_before.tsv"
[ -s "${B}/row_counts_before.tsv" ] || die "aucune table trouvée dans ${PG_DB}"

STEP="dump PostgreSQL"
pg_run pg_dump -Fc -d "$PG_DB" > "${B}/db.dump"

STEP="contrôle du dump"
pg_run pg_restore --list < "${B}/db.dump" > "${WORK}/toc.list"
dumped_tables="$(grep -c ' TABLE DATA ' "${WORK}/toc.list" || true)"
[ "$dumped_tables" -gt 0 ] || die "le dump ne contient aucune donnée de table"

STEP="compteurs après dump"
pg_row_counts "$PG_DB" > "${B}/row_counts_after.tsv"
pg_structure "$PG_DB" > "${WORK}/structure.txt"
alembic="$(pg_query "$PG_DB" "select version_num from alembic_version limit 1" 2>/dev/null || true)"
pg_version="$(pg_query "$PG_DB" "show server_version")"

# ── Fichiers ─────────────────────────────────────────────────────────────────────────────
STEP="archive des fichiers"
excludes=""
for pattern in $FILES_EXCLUDE; do excludes="${excludes} --exclude=${pattern}"; done
files_total=0
for entry in $FILES_DIRS; do
  label="${entry%%=*}"; dir="${entry#*=}"
  # shellcheck disable=SC2086
  tar -czf "${B}/files/${label}.tar.gz" $excludes -C "$dir" .
  # Somme de chaque fichier archivé : la restauration d'essai les revérifie une à une.
  mkdir "${WORK}/check"
  tar -xzf "${B}/files/${label}.tar.gz" -C "${WORK}/check"
  (cd "${WORK}/check" && find . -type f | sort | while IFS= read -r f; do
     printf '%s  %s\n' "$(sha256_of "$f")" "$f"; done) > "${B}/files/${label}.sha256"
  count="$(wc -l < "${B}/files/${label}.sha256" | tr -d ' ')"
  files_total=$((files_total + count))
  rm -rf "${WORK}/check"
  log "  fichiers « ${label} » : ${count}"
done

# ── Manifeste et sommes de contrôle ──────────────────────────────────────────────────────
STEP="manifeste"
{
  echo "format=atlas-backup-1"
  echo "created_utc=${STARTED}"
  echo "database=${PG_DB}"
  echo "pg_server_version=${pg_version}"
  echo "alembic_version=${alembic}"
  echo "dumped_tables=${dumped_tables}"
  cat "${WORK}/structure.txt"
  echo "files_total=${files_total}"
  echo "files_sets=$(for entry in $FILES_DIRS; do printf '%s ' "${entry%%=*}"; done | sed 's/ $//')"
} > "${B}/manifest.txt"
(cd "$B" && find . -type f ! -name SHA256SUMS | sort | while IFS= read -r f; do
   printf '%s  %s\n' "$(sha256_of "$f")" "$f"; done) > "${WORK}/SHA256SUMS"
mv "${WORK}/SHA256SUMS" "${B}/SHA256SUMS"

# ── Chiffrement : le clair ne quitte jamais le dossier de travail ────────────────────────
STEP="chiffrement"
tar -cf - -C "$B" . | gpg_encrypt_to "${OUT}.partial"
[ -s "${OUT}.partial" ] || die "archive chiffrée vide"
WRITTEN=1
mv "${OUT}.partial" "$OUT"
printf '%s  %s\n' "$(sha256_of "$OUT")" "$NAME" > "${OUT}.sha256"
rm -rf "$WORK"; WORK=""
SEALED=1
log "  créé : ${NAME} ($(size_of "$OUT") octets)"

# ── Copie hors serveur ───────────────────────────────────────────────────────────────────
offsite_copy() {  # offsite_copy <destination> : copie l'archive et sa somme, puis vérifie
  rclone copyto --immutable "$OUT" "$1/${NAME}" \
    && rclone copyto --immutable "${OUT}.sha256" "$1/${NAME}.sha256" \
    && rclone check --one-way --include "${NAME}" "$BACKUP_DIR" "$1"
}

if [ -n "$OFFSITE_DEST" ]; then
  STEP="copie hors serveur"
  OFFSITE_STATE="échec"
  offsite_ok=1
  if offsite_copy "$OFFSITE_DEST"; then
    OFFSITE_STATE="copiée et vérifiée"
    log "  copie hors serveur vérifiée"
    # Archive mensuelle : la première sauvegarde réussie de chaque mois, dans une destination
    # à part dont la rétention est plus longue.
    if [ -n "$OFFSITE_MONTHLY_DEST" ]; then
      STEP="copie mensuelle hors serveur"
      month="$(printf '%s' "$STAMP" | cut -c1-6)"
      if this_month="$(rclone lsf --include "${BACKUP_PREFIX}${month}*${BACKUP_SUFFIX}" "$OFFSITE_MONTHLY_DEST")"; then
        if [ -n "$this_month" ]; then
          log "  archive mensuelle ${month} déjà présente"
        elif offsite_copy "$OFFSITE_MONTHLY_DEST"; then
          OFFSITE_STATE="copiée et vérifiée, archive mensuelle ${month} créée"
          log "  archive mensuelle ${month} créée et vérifiée"
        else
          offsite_ok=0
        fi
      else
        offsite_ok=0
      fi
      [ "$offsite_ok" = 1 ] || OFFSITE_STATE="copiée, archive mensuelle en échec"
    fi
  else
    offsite_ok=0
  fi
  if [ "$offsite_ok" = 0 ]; then
    [ "$OFFSITE_REQUIRED" != 1 ] || die "copie hors serveur en échec"
    log "  ATTENTION : copie hors serveur en échec, sauvegarde locale conservée" >&2
  fi
else
  log "  ATTENTION : aucune copie hors serveur configurée" >&2
fi

# ── Rétention locale : jamais moins de KEEP_MIN sauvegardes, quel que soit leur âge ──────
STEP="rétention"
kept=0
list_backups "$BACKUP_DIR" | while IFS= read -r file; do
  kept=$((kept + 1))
  [ "$kept" -le "$KEEP_MIN" ] && continue
  if [ -n "$(find "$file" -mtime "+${KEEP_DAYS}" 2>/dev/null)" ]; then
    rm -f "$file" "${file}.sha256"
    log "  rétention : $(basename "$file") supprimée"
  fi
done

STEP="état"
write_status OK "${STATUS_DIR}/last_run.status"
cp -f "${STATUS_DIR}/last_run.status" "${STATUS_DIR}/last_success.status"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) OK file=${NAME} size=$(size_of "$OUT") offsite=${OFFSITE_STATE}" >> "${STATUS_DIR}/history.log"

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  curl -fsS -m 20 -o /dev/null "$BACKUP_HEARTBEAT_URL" || log "  signal de vie non envoyé" >&2
fi
log "Sauvegarde terminée"
