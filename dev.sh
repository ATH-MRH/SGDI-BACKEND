#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VENV_PYTHON="$HOME/sgdi-venv/bin/python"

if [ ! -x "$VENV_PYTHON" ]; then
  echo "Création de l'environnement virtuel..."
  python3 -m venv "$HOME/sgdi-venv"
  "$VENV_PYTHON" -m pip install -q -r requirements.txt
fi

# Secrets de DÉVELOPPEMENT LOCAL uniquement — JAMAIS utilisés en production
# (la prod a ses propres valeurs dans Coolify). Pour personnaliser sans committer
# de secret, créez un fichier .env.dev (gitignoré) qui exporte vos variables.
[ -f .env.dev ] && { set -a; . ./.env.dev; set +a; }

export SGDI_UPLOADS_DIR="$(pwd)/uploads"
export DATABASE_URL="${DATABASE_URL:-postgresql+psycopg2://sgdi:sgdi@localhost:5432/sgdi}"
export JWT_SECRET="${JWT_SECRET:-dev-only-secret-not-for-production}"
export ADMIN_INITIAL_USERNAME="${ADMIN_INITIAL_USERNAME:-admin}"
export ADMIN_INITIAL_PASSWORD="${ADMIN_INITIAL_PASSWORD:-changeme-dev}"
# Sync Iron désactivée par défaut en dev (renseignez-les dans .env.dev si besoin).
export IRON_API_URL="${IRON_API_URL:-}"
export IRON_SYNC_SECRET="${IRON_SYNC_SECRET:-}"

echo "Serveur SGDI → http://localhost:8000"
exec "$VENV_PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
