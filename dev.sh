#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VENV_PYTHON="$HOME/sgdi-venv/bin/python"

if [ ! -x "$VENV_PYTHON" ]; then
  echo "Création de l'environnement virtuel..."
  python3 -m venv "$HOME/sgdi-venv"
  "$VENV_PYTHON" -m pip install -q -r requirements.txt
fi

export SGDI_UPLOADS_DIR="$(pwd)/uploads"
export DATABASE_URL="postgresql+psycopg2://sgdi:sgdi_local_password@localhost:5432/sgdi"
export JWT_SECRET="sgdi-local-dev-secret-change-me"
export ADMIN_INITIAL_USERNAME="admin"
export ADMIN_INITIAL_PASSWORD="admin12345"
export IRON_API_URL="http://localhost:3000"
export IRON_SYNC_SECRET="atlas-iron-sync-2026"

echo "Serveur SGDI → http://localhost:8000"
exec "$VENV_PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
