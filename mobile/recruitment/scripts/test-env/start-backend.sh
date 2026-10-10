#!/bin/sh
# Démarre le serveur ATLAS de la branche serveur sur une base PostgreSQL locale et isolée,
# avec des annonces et un candidat fictifs. Rien ne touche la production ni SMSGate.
. "$(dirname "$0")/common.sh"
set -e
[ -d "$BACKEND/app" ] || { echo "Serveur introuvable : $BACKEND (variable ATLAS_BACKEND)"; exit 1; }
mkdir -p "$STATE/uploads"
if [ ! -f "$STATE/env" ]; then
  # Secrets tirés au hasard, valables uniquement pour cette base locale.
  umask 077
  cat > "$STATE/env" <<ENV
export APP_ENV=development
export DATABASE_URL="postgresql+psycopg2://$(whoami)@/$DB?host=$PGHOST_DIR"
export JWT_SECRET=$(openssl rand -hex 32)
export ADMIN_SYSTEM_USERNAME=essai-systeme
export ADMIN_SYSTEM_PASSWORD=$(openssl rand -hex 9)
export ADMIN_INITIAL_USERNAME=recruteur
export ADMIN_INITIAL_PASSWORD=$(openssl rand -hex 9)
export ADMIN_INITIAL_FULL_NAME="Recruteur d'essai"
export RECRUITMENT_SMS_ENABLED=true
export RECRUITMENT_SMS_PROVIDER=poll
export RECRUITMENT_SMS_GATEWAY_KEY=$(openssl rand -hex 24)
export RECRUITMENT_PUSH_ENABLED=false
export CORS_ALLOWED_ORIGINS="http://localhost:8091,http://127.0.0.1:8091"
export SGDI_UPLOADS_DIR="$STATE/uploads"
export LOG_LEVEL=WARNING
ENV
fi
. "$STATE/env"
NEW=0
if ! psql -h "$PGHOST_DIR" -lqt | cut -d '|' -f 1 | grep -qw "$DB"; then createdb -h "$PGHOST_DIR" "$DB"; NEW=1; fi
cd "$BACKEND"
"$PYTHON" -m alembic upgrade head 2>&1 | tail -1
# Compte recruteur local (droits complets) : c'est lui qui ouvre recrute.html et crée le jeu d'essai.
"$PYTHON" -m scripts.create_initial_admin >/dev/null 2>&1 || true
if lsof -tiTCP:$PORT -sTCP:LISTEN >/dev/null; then echo "Un serveur écoute déjà sur le port $PORT."; else
  nohup "$PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port $PORT --log-level warning > "$STATE/backend.log" 2>&1 &
  n=0; until curl -s -o /dev/null "http://127.0.0.1:$PORT/api/public/emploi/config" || [ $n -ge 40 ]; do sleep 1; n=$((n+1)); done
fi
curl -s -o /dev/null "http://127.0.0.1:$PORT/api/public/emploi/config" || { echo "Le serveur n'a pas démarré : voir $STATE/backend.log"; exit 1; }
if [ "$NEW" = 1 ]; then
  # Le serveur ne connaît une société que si un compte, un employé ou un dossier la porte : le compte
  # (administrateur à périmètre global, pour pouvoir affecter un dossier à la société du contrat)
  # recruteur local reçoit les trois sociétés fictives du jeu d'essai.
  psql -h "$PGHOST_DIR" "$DB" -qc "update users set global_society_access = true, authorized_societies = '[\"IRON Global Sécurité\", \"IRON Global Solution\", \"IRON Global Services\"]' , authorized_actions = '[\"read\", \"create\", \"update\", \"validate\", \"delete\", \"export\", \"admin\"]' where username ilike 'recruteur'"
  "$PYTHON" "$HERE/cv_fictif.py" "$STATE" >/dev/null; "$PYTHON" "$HERE/seed.py" "$STATE"
fi
echo "Serveur d'essai prêt : http://$(lan_ip):$PORT  (recruteur : http://$(lan_ip):$PORT/static/recrute.html)"
echo "Compte recruteur local : identifiant et mot de passe dans $STATE/env (ADMIN_INITIAL_*)."
