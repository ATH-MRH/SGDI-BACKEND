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

# Placé volontairement en fin de Dockerfile : change à chaque commit, donc
# n'invalide le cache Docker que des couches suivantes (aucune couche
# précédente — pip install, copie de app/, contrôle JS/Python — n'est
# reconstruite juste parce que le commit a changé). Coolify définit
# automatiquement SOURCE_COMMIT comme build-arg pour les déploiements basés
# sur git ; en local (docker compose build sans le passer), reste "unknown"
# plutôt que de faire échouer le build — voir /api/version, qui ne doit
# jamais planter faute de cette seule information de traçabilité.
ARG SOURCE_COMMIT=unknown
ENV SOURCE_COMMIT=${SOURCE_COMMIT}

RUN useradd --create-home --shell /usr/sbin/nologin sgdi \
    && chown -R sgdi:sgdi /app \
    && chmod +x /app/start.sh

USER sgdi

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).read()"

CMD ["/app/start.sh"]
