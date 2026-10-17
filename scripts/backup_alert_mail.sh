#!/usr/bin/env bash
#
# backup_alert_mail.sh — Envoie par courriel le message d'alerte d'une sauvegarde.
# À désigner dans BACKUP_ALERT_COMMAND ; backup.sh et backup_check.sh fournissent le message
# dans ATLAS_BACKUP_MESSAGE. N'utilise que curl.
#
# Variables (dans le même fichier privé que la sauvegarde) :
#   BACKUP_ALERT_EMAIL_TO      destinataire                                        OBLIGATOIRE
#   BACKUP_ALERT_EMAIL_FROM    expéditeur                                          OBLIGATOIRE
#   BACKUP_ALERT_SMTP_URL      serveur d'envoi, ex. smtps://smtp.exemple.fr:465    OBLIGATOIRE
#   BACKUP_ALERT_SMTP_NETRC    fichier privé (600) au format netrc contenant l'identifiant et
#                              le mot de passe SMTP — jamais en variable ni en argument
#
# Code de retour : 0 si le serveur a accepté le message.
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_lib.sh
. "${SCRIPT_DIR}/backup_lib.sh"

load_env_file "${BACKUP_ENV_FILE:-}"
TO="${BACKUP_ALERT_EMAIL_TO:?Définir BACKUP_ALERT_EMAIL_TO}"
FROM="${BACKUP_ALERT_EMAIL_FROM:?Définir BACKUP_ALERT_EMAIL_FROM}"
URL="${BACKUP_ALERT_SMTP_URL:?Définir BACKUP_ALERT_SMTP_URL}"
MESSAGE="${ATLAS_BACKUP_MESSAGE:-Sauvegarde ATLAS : alerte sans détail}"
need curl

auth=()
if [ -n "${BACKUP_ALERT_SMTP_NETRC:-}" ]; then
  require_private "$BACKUP_ALERT_SMTP_NETRC"
  auth=(--netrc-file "$BACKUP_ALERT_SMTP_NETRC")
fi

{
  printf 'From: %s\r\n' "$FROM"
  printf 'To: %s\r\n' "$TO"
  printf 'Subject: [ATLAS] Sauvegarde - alerte\r\n'
  printf 'Date: %s\r\n' "$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')"
  printf 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n'
  printf '%s\r\n\r\nServeur : %s\r\nHeure (UTC) : %s\r\n' "$MESSAGE" "$(hostname)" "$(date -u '+%Y-%m-%d %H:%M:%S')"
} | curl --silent --show-error --fail --max-time 30 --ssl-reqd ${auth[@]+"${auth[@]}"} \
         --url "$URL" --mail-from "$FROM" --mail-rcpt "$TO" --upload-file -
