#!/usr/bin/env bash
#
# backup_check.sh — Surveillance : la dernière sauvegarde existe-t-elle, est-elle récente et
# intacte ? À planifier séparément de backup.sh : une sauvegarde qui n'a pas tourné du tout
# ne peut pas signaler son propre échec.
#
# Variables (ou fichier privé BACKUP_ENV_FILE, le même que backup.sh) :
#   BACKUP_DIR              dossier des sauvegardes                           OBLIGATOIRE
#   BACKUP_MAX_AGE_HOURS    âge maximal de la dernière sauvegarde (défaut 26)
#   BACKUP_MIN_SIZE_BYTES   taille minimale plausible (défaut 1024)
#   BACKUP_ALERT_COMMAND    commande lancée si un contrôle échoue (message dans ATLAS_BACKUP_MESSAGE)
#
# Code de retour : 0 tout va bien ; 1 sauvegarde absente, trop ancienne, altérée ou en échec.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_lib.sh
. "${SCRIPT_DIR}/backup_lib.sh"

load_env_file "${BACKUP_ENV_FILE:-}"
BACKUP_DIR="${BACKUP_DIR:?Définir BACKUP_DIR}"
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
MIN_SIZE="${BACKUP_MIN_SIZE_BYTES:-1024}"

problem() {
  log "SAUVEGARDE À VÉRIFIER : $*" >&2
  if [ -n "${BACKUP_ALERT_COMMAND:-}" ]; then
    ATLAS_BACKUP_MESSAGE="Sauvegarde ATLAS à vérifier : $*" bash -c "$BACKUP_ALERT_COMMAND" || log "alerte non envoyée" >&2
  fi
  exit 1
}

latest="$(list_backups "$BACKUP_DIR" | head -n 1)"
[ -n "$latest" ] || problem "aucune sauvegarde dans ${BACKUP_DIR}"
name="$(basename "$latest")"

[ -z "$(find "$latest" -mmin "+$((MAX_AGE_HOURS * 60))")" ] || problem "${name} a plus de ${MAX_AGE_HOURS} h"
[ "$(size_of "$latest")" -ge "$MIN_SIZE" ] || problem "${name} est anormalement petite"
[ -f "${latest}.sha256" ] || problem "${name} n'a pas de somme de contrôle"
[ "$(cut -d' ' -f1 "${latest}.sha256")" = "$(sha256_of "$latest")" ] || problem "${name} ne correspond plus à sa somme de contrôle"

status="${BACKUP_DIR}/status/last_run.status"
if [ -f "$status" ] && [ "$(manifest_get "$status" result)" != OK ]; then
  problem "la dernière exécution a échoué (étape : $(manifest_get "$status" failed_step))"
fi

log "Sauvegarde correcte : ${name} ($(size_of "$latest") octets)"
