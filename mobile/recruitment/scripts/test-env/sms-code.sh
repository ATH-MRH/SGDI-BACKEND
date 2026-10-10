#!/bin/sh
# Affiche les derniers codes SMS de l'environnement d'essai.
# Ici le serveur n'envoie aucun SMS : il met le message en file pour une passerelle locale
# (fournisseur « poll »). Cette passerelle, lancée avec le serveur d'essai, note le code dans
# .test-env/codes.log au lieu de l'envoyer. Le code reste vérifié par le serveur. En production le
# fournisseur est SMSGate : cette file n'y est pas servie et la clé locale n'y existe pas.
. "$(dirname "$0")/common.sh"
pgrep -f "sms-gateway.py $PORT" >/dev/null || echo "La passerelle locale ne tourne pas : relancez start-backend.sh."
if [ -s "$STATE/codes.log" ]; then tail -n "${1:-3}" "$STATE/codes.log"; else echo "Aucun code pour l'instant. Demandez-le dans l'application, puis relancez cette commande."; fi
