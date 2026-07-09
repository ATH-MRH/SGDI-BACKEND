#!/bin/sh
set -e

case "${APP_ENV:-production}" in
  production|prod)
    if [ -z "${DATABASE_URL:-}" ]; then
      echo "[start] ERROR: DATABASE_URL is required in production." >&2
      exit 1
    fi
    case "$DATABASE_URL" in
      postgres://*|postgresql://*|postgresql+psycopg2://*) ;;
      *)
        echo "[start] ERROR: production DATABASE_URL must point to PostgreSQL." >&2
        exit 1
        ;;
    esac
    ;;
esac

echo "[start] Waiting for PostgreSQL..."
attempt=1
until python3 -c 'from sqlalchemy import text; from app.db.session import engine; assert engine.dialect.name == "postgresql", "PostgreSQL required"; c = engine.connect(); c.execute(text("SELECT 1")); c.close()'; do
  if [ "$attempt" -ge 30 ]; then
    echo "[start] ERROR: PostgreSQL is unavailable after 30 attempts." >&2
    exit 1
  fi
  echo "[start] PostgreSQL unavailable (attempt $attempt/30); retrying in 2s..."
  attempt=$((attempt + 1))
  sleep 2
done
echo "[start] PostgreSQL connection confirmed."

echo "[start] Applying database migrations..."
python3 -m alembic upgrade head

echo "[start] Starting server (${WEB_CONCURRENCY:-4} workers)..."
exec python3 -m gunicorn app.main:app \
  --config gunicorn.conf.py
