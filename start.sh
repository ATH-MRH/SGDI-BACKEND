#!/bin/sh
set -e

echo "[start] Applying database migrations..."
python3 -m alembic upgrade head

echo "[start] Starting server..."
exec python3 -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --proxy-headers \
  --forwarded-allow-ips "*"
