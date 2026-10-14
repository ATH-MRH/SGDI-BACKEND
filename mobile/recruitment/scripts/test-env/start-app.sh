#!/bin/sh
# Lance l'application en développement, reliée au serveur d'essai local, pour Expo Go sur le même Wi-Fi.
. "$(dirname "$0")/common.sh"
IP="$(lan_ip)"
[ -n "$IP" ] || { echo "Adresse Wi-Fi du Mac introuvable."; exit 1; }
cd "$APP"
echo "Application reliée à http://$IP:$PORT/api — scannez le QR code avec l'iPhone (appareil photo) ou le Samsung (Expo Go)."
EXPO_PUBLIC_API_URL="http://$IP:$PORT/api" REACT_NATIVE_PACKAGER_HOSTNAME="$IP" exec npx expo start --lan --clear --port "${APP_PORT:-8082}" "$@"
