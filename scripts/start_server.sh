#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_DIR="$(pwd)"
VENV_PYTHON="/private/tmp/sgdi-venv/bin/python"
RUNTIME_DIR="/private/tmp/sgdi-runtime"

echo "Preparation du serveur SGDI..."
trap 'echo ""; echo "Arret du demarrage SGDI."; exit 130' INT

if [ ! -x "$VENV_PYTHON" ]; then
  echo "Environnement Python serveur absent. Creation dans /private/tmp/sgdi-venv..."
  python3 -m venv /private/tmp/sgdi-venv
  "$VENV_PYTHON" -m pip install -r requirements.txt
fi

echo "Synchronisation des fichiers applicatifs..."
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"
rsync -r --exclude='__pycache__' --exclude='*.pyc' app "$RUNTIME_DIR/"
cp .env "$RUNTIME_DIR/.env"

echo "Demarrage sur http://0.0.0.0:8000"
cd "$RUNTIME_DIR"
export SGDI_RUNTIME_DIR="$RUNTIME_DIR"
exec "$VENV_PYTHON" "$PROJECT_DIR/scripts/run_server.py"
