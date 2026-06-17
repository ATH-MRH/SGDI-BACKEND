#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_DIR="$(pwd)"
VENV_DIR="$HOME/sgdi-venv"
VENV_PYTHON="$VENV_DIR/bin/python"

echo "Preparation du serveur SGDI..."
trap 'echo ""; echo "Arret du demarrage SGDI."; exit 130' INT

if [ ! -x "$VENV_PYTHON" ]; then
  echo "Environnement Python absent. Creation dans $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
  "$VENV_PYTHON" -m pip install -q -r requirements.txt
fi

echo "Demarrage depuis $PROJECT_DIR sur http://0.0.0.0:8000"
cd "$PROJECT_DIR"
exec "$VENV_PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
