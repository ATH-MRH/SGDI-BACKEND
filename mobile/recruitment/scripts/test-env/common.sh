# Réglages communs de l'environnement d'essai local (aucun lien avec la production).
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
STATE="$APP/.test-env"                       # ignoré par Git : secrets locaux, journaux, pièces déposées
ROOT="$(cd "$APP/../../.." && pwd)"          # dossier des copies de travail
BACKEND="${ATLAS_BACKEND:-$ROOT/iron-emploi}"
PYTHON="${ATLAS_PYTHON:-$ROOT/../.venv/bin/python}"
DB="iron_emploi_essai_telephone"
PGHOST_DIR="${PGHOST_DIR:-/tmp}"
PORT=8765
lan_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null; }
