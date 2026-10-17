#!/usr/bin/env bash
#
# backup_lib.sh — fonctions communes à backup.sh, backup_restore_test.sh et backup_check.sh.
# À inclure avec `.`, jamais à exécuter. Compatible bash 3.2 (macOS) et Linux.
#
# Les scripts appelants définissent PG_CONTAINER (vide = outils PostgreSQL locaux) et PG_USER.

BACKUP_PREFIX="atlas-backup_"
BACKUP_SUFFIX=".tar.gpg"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERREUR : $*" >&2; exit 1; }

need() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "outil absent : $tool"
  done
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Vérifie un fichier de sommes « <sha256>  <chemin relatif> » depuis le dossier $1.
sha256_check() {
  if command -v sha256sum >/dev/null 2>&1; then (cd "$1" && sha256sum --quiet -c "$2")
  else (cd "$1" && shasum -a 256 -c "$2" >/dev/null); fi
}

size_of() { wc -c < "$1" | tr -d ' '; }

# Droits d'un fichier en octal (GNU stat, puis BSD stat).
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# Refuse un fichier secret ou de configuration lisible par le groupe ou les autres.
require_private() {
  local mode
  [ -f "$1" ] || die "fichier introuvable : $1"
  mode="$(mode_of "$1")"
  case "$mode" in
    600|400) ;;
    *) die "droits trop larges sur $1 ($mode) : attendu 600" ;;
  esac
}

# Charge un fichier de configuration privé, sans écraser les variables déjà définies par
# l'appelant (un essai peut ainsi surcharger une valeur sans modifier le fichier).
load_env_file() {
  local file="$1" line key
  [ -n "$file" ] || return 0
  require_private "$file"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    case "$key" in *[!A-Za-z0-9_]*|'') die "ligne invalide dans $file (clé « $key »)" ;; esac
    if [ -z "${!key+x}" ]; then
      eval "export $line"
    fi
  done < "$file"
}

# pg_run <outil> [arguments…] — psql, pg_dump, pg_restore, createdb, dropdb ; l'entrée standard
# est transmise. Dans un conteneur si PG_CONTAINER est défini, sinon avec les outils locaux.
pg_run() {
  local tool="$1"; shift
  if [ -n "${PG_CONTAINER:-}" ]; then
    docker exec -i "$PG_CONTAINER" "$tool" ${PG_USER:+-U "$PG_USER"} "$@"
  else
    "$tool" ${PG_USER:+-U "$PG_USER"} "$@"
  fi
}

pg_query() {  # pg_query <base> <requête> — une valeur ou des lignes séparées par des tabulations
  pg_run psql -X -A -t -q -F "$(printf '\t')" -v ON_ERROR_STOP=1 -d "$1" -c "$2"
}

# Nombre de lignes de chaque table utilisateur : « schéma.table<TAB>n », trié.
pg_row_counts() {
  pg_query "$1" "select table_schema || '.' || table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
 order by 1;"
}

# Structure : « tables=…, constraints=…, indexes=… », une clé par ligne.
pg_structure() {
  pg_query "$1" "select 'tables=' || count(*) from information_schema.tables
   where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
  union all
  select 'constraints=' || count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
  union all
  select 'indexes=' || count(*) from pg_indexes where schemaname not in ('pg_catalog', 'information_schema');"
}

manifest_get() { sed -n "s/^$2=//p" "$1" | head -n 1; }

# Chiffre l'entrée standard vers $1. Clé publique (BACKUP_GPG_RECIPIENT) ou, à défaut, phrase
# secrète lue dans un fichier privé (BACKUP_PASSPHRASE_FILE) — jamais sur la ligne de commande.
gpg_encrypt_to() {
  if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
    gpg --batch --yes --quiet --no-tty --trust-model always --encrypt \
        --recipient "$BACKUP_GPG_RECIPIENT" --output "$1"
  else
    gpg --batch --yes --quiet --no-tty --pinentry-mode loopback --symmetric --cipher-algo AES256 \
        --passphrase-file "$BACKUP_PASSPHRASE_FILE" --output "$1"
  fi
}

# Déchiffre $1 vers la sortie standard (clé privée du trousseau, ou RESTORE_PASSPHRASE_FILE).
gpg_decrypt() {
  if [ -n "${RESTORE_PASSPHRASE_FILE:-}" ]; then
    gpg --batch --quiet --no-tty --pinentry-mode loopback --passphrase-file "$RESTORE_PASSPHRASE_FILE" --decrypt "$1"
  else
    gpg --batch --quiet --no-tty --decrypt "$1"
  fi
}

# Sauvegardes terminées d'un dossier, de la plus récente à la plus ancienne (le nom porte la date).
list_backups() {
  find "$1" -maxdepth 1 -type f -name "${BACKUP_PREFIX}*${BACKUP_SUFFIX}" 2>/dev/null | sort -r
}
