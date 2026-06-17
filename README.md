# SGDI Backend FastAPI PostgreSQL

Backend modulaire Python FastAPI pour les modules :

- DRH
- OPS
- Matériel & Équipement

La base de données est PostgreSQL uniquement.

## Installation

```bash
cd SGDI-BACKEND-FASTAPI-SQLITE
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
createuser --pwprompt --createdb sgdi
createdb -O sgdi sgdi
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --log-level info --access-log
```

Documentation interactive :

```text
http://localhost:8000/docs
```

Vérification opérationnelle PostgreSQL :

```text
GET /health/db
```

## Authentification

Login :

```text
POST /api/auth/login
```

Toutes les routes métier utilisent un token Bearer.
La base ne contient aucun compte de démonstration. L'inscription publique est
désactivée par défaut avec `ALLOW_PUBLIC_REGISTRATION=false`.

Création ponctuelle d'un premier utilisateur administrateur :

```bash
ADMIN_INITIAL_USERNAME=<identifiant> ADMIN_INITIAL_PASSWORD=<mot_de_passe_fort> python -m scripts.create_initial_admin
```

## API IRONGS BASE

Le prototype `IRONGS-BASE.html` utilise beaucoup de collections locales
(`agents`, `sites`, `candidats`, `factures`, `prospects`, `pointages`, etc.).
Le backend expose maintenant une API JSON générique compatible avec ces
collections :

```text
GET  /api/irongs/bootstrap
GET  /api/irongs/db
PUT  /api/irongs/db

GET    /api/irongs/collections/{name}
PUT    /api/irongs/collections/{name}
GET    /api/irongs/collections/{name}/items
POST   /api/irongs/collections/{name}/items
GET    /api/irongs/collections/{name}/items/{item_id}
PUT    /api/irongs/collections/{name}/items/{item_id}
PATCH  /api/irongs/collections/{name}/items/{item_id}
DELETE /api/irongs/collections/{name}/items/{item_id}
```

Exemple :

```bash
curl http://localhost:8000/api/irongs/bootstrap \
  -H "Authorization: Bearer <token>"
```

## Routes principales

### DRH

- `GET /api/drh/dashboard`
- `GET /api/drh/employees`
- `POST /api/drh/employees`
- `GET /api/drh/employees/{id}/fiche-position`
- `GET /api/drh/candidates`
- `POST /api/drh/candidates/{id}/recruit`
- `GET /api/drh/contracts`
- `GET /api/drh/leaves`
- `POST /api/drh/leaves/{id}/approve`
- `GET /api/drh/sanctions`
- `GET /api/drh/documents`

### OPS

- `GET /api/ops/dashboard`
- `GET /api/ops/sites`
- `POST /api/ops/sites`
- `GET /api/ops/sites/situation-generale`
- `GET /api/ops/sites/{id}`
- `POST /api/ops/site-posts`
- `POST /api/ops/assignments`
- `POST /api/ops/pointage/daily/generate`
- `GET /api/ops/pointage/daily`
- `GET /api/ops/events`
- `POST /api/ops/events`

### Matériel & Équipement

- `GET /api/materiel/dashboard`
- `GET /api/materiel/stores`
- `POST /api/materiel/stores`
- `GET /api/materiel/suppliers`
- `POST /api/materiel/suppliers`
- `GET /api/materiel/articles`
- `POST /api/materiel/articles`
- `GET /api/materiel/inventory`
- `GET /api/materiel/movements`
- `POST /api/materiel/movements`
- `POST /api/materiel/dotations`
- `GET /api/materiel/employees/{id}/equipment`
- `POST /api/materiel/equipment/{id}/return`
- `GET /api/materiel/reversements/pending`

## Tests

Les tests automatises sont dans le dossier `tests/`.

Commandes utiles :

```bash
pytest -q
pytest -q tests/test_drh_society_permissions.py
pytest -q tests/test_drh_contract_maintenance.py
node --check app/static/sgdi-app.js
```

Le test `tests/test_drh_society_permissions.py` verifie notamment que les
utilisateurs limites a une societe peuvent importer ou creer des donnees RH
meme si le libelle de societe arrive avec une difference d'accents, de casse
ou d'espaces. Une societe reellement non autorisee reste refusee en `403`.

## Maintenance RH

Mise a jour globale des fiches de position employes pour appliquer :

- Type de contrat : `CDD`
- Duree du contrat : `12 mois`
- Fin de contrat : date de debut contrat + 12 mois

Simulation sans enregistrer :

```bash
python3 -m scripts.update_employee_contract_terms
```

Application effective :

```bash
python3 -m scripts.update_employee_contract_terms --apply
```

Le script met a jour les employes, les contrats rattaches et les donnees legacy
utilisees par l'interface. Les fiches sans date de debut contrat sont comptees
dans le rapport et ne recoivent pas de date de fin calculee.

## Configuration PostgreSQL et migrations

Le backend utilise SQLAlchemy, PostgreSQL et Alembic. Les tables ne sont pas
créées au démarrage de l'API : elles sont gérées par migrations.

La connexion PostgreSQL doit être fournie par variable d'environnement :

```env
DATABASE_URL=<url_postgresql>
```

Si le mot de passe contient le caractère `@`, il doit rester encodé en `%40` dans l'URL.

Commandes principales :

```bash
alembic upgrade head
alembic current
alembic history
```
