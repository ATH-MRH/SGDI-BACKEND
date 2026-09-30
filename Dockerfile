# --- Étape de contrôle : valide la syntaxe JavaScript AVANT de construire l'image. ---
# Si un fichier JS est cassé (parenthèse/accolade en trop, etc.), le build échoue ici
# et Coolify garde l'ancien conteneur en marche -> jamais de page blanche en production.
# Finance Platform V2 : app/static/finance-platform/{api,shell}.js et views/*.js ajoutés à la
# couverture — le glob top-level *.js ne descend pas dans les sous-répertoires, trouvé en
# construisant l'interface V2 (fichiers séparés par domaine, contrairement à V1 qui était
# un seul fichier auto-porté sans .js externe à valider ici).
FROM node:20-alpine AS jscheck
WORKDIR /check
COPY app/static/*.js ./
COPY app/static/finance-platform/*.js ./finance-platform/
COPY app/static/finance-platform/views/*.js ./finance-platform/views/
RUN for f in *.js finance-platform/*.js finance-platform/views/*.js; do case "$f" in *.min.js) ;; *) echo "check $f" && node --check "$f" ;; esac; done \
    && echo ok > /check/passed

# --- Modèles biométriques (docs/biometrics.md §2) : téléchargés au build depuis des commits
# FIGÉS de leurs dépôts d'origine, puis vérifiés par SHA-256 — le build échoue au moindre écart.
# Aucun binaire dans Git, aucun secret. Le moteur revérifie ces empreintes au chargement.
FROM python:3.13-slim AS biomodels
COPY scripts/fetch_biometric_models.py /tmp/fetch_biometric_models.py
RUN python /tmp/fetch_biometric_models.py /models

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-biometric.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-biometric.txt

# Moteur biométrique : dépendances installées, modèles vérifiés dans BIOMETRIC_MODELS_DIR
# (défaut /app/models/biometrics). Rendre le moteur DISPONIBLE n'active rien : le pointage
# facial reste soumis à BIOMETRIC_ENABLED (faux par défaut), le Mode Test à
# BIOMETRIC_TEST_MODE_ENABLED ; la clé BIOMETRIC_TEMPLATE_KEY est un secret d'exécution,
# jamais présent dans l'image.
COPY --from=biomodels /models /app/models/biometrics

COPY app ./app
# Contrôle syntaxe Python au build : échoue si un fichier .py est cassé.
RUN python -m compileall -q app
# Contrôle du moteur au build : OpenCV, YuNet, SFace et MiniFASNetV2 se chargent avec leurs
# empreintes vérifiées (échec du build sinon). Aucune clé, aucune donnée, aucun visage.
RUN python -c "from app.modules.biometrics.engine import ENGINE_ID, OpenCvFaceEngine; OpenCvFaceEngine('/app/models/biometrics'); print('moteur biométrique OK :', ENGINE_ID)"
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
