# --- Étape de contrôle : valide la syntaxe JavaScript AVANT de construire l'image. ---
# Si un fichier JS est cassé (parenthèse/accolade en trop, etc.), le build échoue ici
# et Coolify garde l'ancien conteneur en marche -> jamais de page blanche en production.
FROM node:20-alpine AS jscheck
WORKDIR /check
COPY app/static/*.js ./
RUN for f in *.js; do case "$f" in *.min.js) ;; *) echo "check $f" && node --check "$f" ;; esac; done \
    && echo ok > /check/passed

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# Contrôle syntaxe Python au build : échoue si un fichier .py est cassé.
RUN python -m compileall -q app
# Force l'exécution de l'étape de contrôle JS ci-dessus (échoue le build si un JS est invalide).
COPY --from=jscheck /check/passed /tmp/jscheck.passed
COPY scripts ./scripts
COPY migrations ./migrations
COPY alembic.ini .
COPY gunicorn.conf.py .
COPY start.sh .

RUN useradd --create-home --shell /usr/sbin/nologin sgdi \
    && chown -R sgdi:sgdi /app \
    && chmod +x /app/start.sh

USER sgdi

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).read()"

CMD ["/app/start.sh"]
