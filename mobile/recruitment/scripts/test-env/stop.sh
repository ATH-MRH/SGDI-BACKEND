#!/bin/sh
# Arrête le serveur d'essai. Avec « --effacer », supprime aussi la base locale et ses fichiers.
. "$(dirname "$0")/common.sh"
pkill -f "sms-gateway.py $PORT" 2>/dev/null
PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN)"; [ -n "$PID" ] && kill $PID && echo "Serveur d'essai arrêté."
if [ "$1" = "--effacer" ]; then dropdb -h "$PGHOST_DIR" --if-exists "$DB"; rm -rf "$STATE"; echo "Base et fichiers d'essai supprimés."; fi
