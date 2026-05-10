# Generation automatique des contrats DRH

## Architecture retenue

La fonctionnalite est integree dans la pile actuelle SGDI : FastAPI, SQLAlchemy, PostgreSQL et interface web statique `app/static/index.html`. Les modeles Word `.docx` sont stockes en base PostgreSQL, puis rendus avec `python-docx`. La generation PDF est disponible si LibreOffice/`soffice` est installe sur le serveur.

## Tables principales

- `contract_templates` : modeles Word, type de contrat, poste/fonction cible, fichier `.docx`, balises detectees.
- `contract_conditional_clauses` : paragraphes conditionnels injectes selon une valeur de fiche, par exemple `FONCTION = Cadre`.
- `generated_contracts` : contrats generes, fichier final, valeurs appliquees, reference, statut.
- `contracts` et `documents` : le contrat genere est aussi rattache au dossier employe.

## Balises disponibles

Les modeles Word peuvent contenir des balises au format `{{NOM}}`, `{{PRENOM}}`, `{{NOM_PRENOM}}`, `{{ADRESSE}}`, `{{NIN}}`, `{{DATE_DEBUT}}`, `{{DATE_FIN}}`, `{{POSTE}}`, `{{FONCTION}}`, `{{SALAIRE}}`, `{{SOCIETE}}`, `{{CLAUSES_CONDITIONNELLES}}`.

## Procedure utilisateur

1. Aller dans `Administration systeme > Contrats du personnel`.
2. Cliquer sur `Ajouter modele Word`.
3. Importer un fichier `.docx` contenant les balises.
4. Associer le modele a un type de contrat, et optionnellement a un poste ou une fonction.
5. Ajouter des paragraphes conditionnels si necessaire.
6. Cliquer sur `Generer un contrat`, choisir l employe, le type de contrat et le format.
7. Le fichier est genere, rattache au dossier employe et telechargeable.

## API ajoutee

- `GET /api/drh/contract-templates`
- `POST /api/drh/contract-templates`
- `PUT /api/drh/contract-templates/{id}`
- `DELETE /api/drh/contract-templates/{id}`
- `GET /api/drh/contract-templates/{id}/download`
- `GET /api/drh/contract-clauses`
- `POST /api/drh/contract-clauses`
- `PUT /api/drh/contract-clauses/{id}`
- `DELETE /api/drh/contract-clauses/{id}`
- `POST /api/drh/generated-contracts`
- `GET /api/drh/generated-contracts`
- `GET /api/drh/generated-contracts/{id}/download`

## Note production

Apres deploiement, Coolify doit reconstruire l image pour installer `python-docx`. Pour activer le PDF, installer LibreOffice dans l image ou rester en generation Word `.docx`.
