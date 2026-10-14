# Importer contractualisation Excel

Branche : `feat/drh-contract-excel-import`.

Le bouton de l’écran « Contrats à établir » ouvre Fichier → Correspondance → Vérification → Résultat. La barre latérale n’est pas modifiée. Le lecteur sécurisé, les limites, les sessions privées et le parseur de dates sont partagés avec l’import candidats ; les sessions `contract-…` sont isolées des sessions de recrutement. Aucune nouvelle table ni dépendance Excel n’est introduite. Les migrations existantes des sessions d’import et du rattachement DC doivent être présentes.

## Règles

- Société active obligatoire ; accès DRH et action `create` exigés, avec vérification du périmètre à chaque requête. Sessions liées au compte et à l’empreinte de son périmètre, expiration et rétention identiques à l’import candidats.
- `.xlsx` et `.xls` déjà supportés ; 5 Mo, 1 000 lignes, 60 colonnes, 10 feuilles maximum. Le lecteur existant contrôle archives, formules et contenu.
- Dates uniquement : identifiant candidat, date début, et éventuellement date fin manuelle. Les autres colonnes sont ignorées ; les informations contractuelles proviennent des données communes.
- Import complet : poste, client/site, type, durée, essai, modèle, salaire, paiement, banque, RIB/IBAN peuvent varier par ligne.
- Priorité explicitement affichée : valeurs communes renseignées prioritaires par défaut, ou valeurs Excel renseignées prioritaires. Une cellule vide utilise la valeur commune. Les identifiants et dates restent individuels.
- Identification : référence/ID/CAND-ID, puis code stable, téléphone unique, enfin nom et prénom. Un identifiant explicite inconnu ne déclenche pas de recherche par nom. Une correspondance multiple est « À VÉRIFIER ». Tous les doublons résolus d’un candidat sont bloqués.
- Seuls les candidats transmis (`a_contractualiser`) avec décision favorable peuvent être recrutés. Les dossiers déjà convertis sont bloqués.
- Poste, type, modèle actif compatible et client/site DC actif de la société sont obligatoires. Les noms DC doivent correspondre sans ambiguïté ; les identifiants `client_id:site_id` sont également acceptés. Un modèle est identifié par son ID.
- Durée : `12m`, `6m`, `30d` (également mois/jours). Essai : nombre de jours ou même syntaxe. Les mois reproduisent le report de `Date.setMonth` du formulaire existant ; une date de fin Excel explicite est conservée. Les dates futures sont acceptées sans modifier la règle des dates de naissance. CDI sans durée : fin vide.
- Les RIB/IBAN doivent être stockés en texte dans Excel ; une cellule numérique est bloquée pour éviter une perte silencieuse des zéros.
- L’aperçu n’écrit ni employé ni contrat ni document. La confirmation réclame la session par mise à jour conditionnelle, réanalyse les données et ne traite que les lignes approuvées PRÊT dont le candidat et les valeurs n’ont pas changé.
- Transaction par candidat : recrutement, contrat unique, document Word, numéro, lien candidat/contrat, audit et résultat de succès sont validés ensemble. Une erreur annule toute la ligne, puis le traitement continue. Une confirmation terminée rejouée renvoie le résultat existant. Une écriture conditionnelle réserve également chaque candidat pendant sa transaction, pour empêcher deux imports concurrents de créer deux contrats. Le lien existant `extra.sourceCandidateId` est réutilisé ; aucune colonne de provenance d’employé ni permission de création directe n’est ajoutée.
- Le rapport CSV compatible Excel protège contre l’injection de formules. Le filtre « uniquement les erreurs » est disponible en vérification et résultat. Si le navigateur dépasse son délai réseau, le résultat peut être rechargé pendant le traitement serveur.

## API

Préfixe `/api/drh/contracts/import` :

- `GET /config`, `GET /template?mode=dates|full`
- `POST ?society=…` (multipart `file`)
- `POST /{session_id}/preview` (`sheet`, `mapping`, `mode`, `precedence`, `common`)
- `POST /{session_id}/confirm`, `POST /{session_id}/cancel`
- `GET /{session_id}/result`, `GET /{session_id}/report`

## Vérification

Backend : `tests/test_drh_contract_excel_import.py`, plus les suites existantes `test_candidate_import.py`, `test_recruit_to_contract_flow.py`, `test_drh_contract_dc_client_sites.py`.

Frontend : `tests_frontend/drh-contract-excel-import.test.js` (parcours, échappement, filtre, double clic, Chrome aux quatre étapes à 390/768/1440 px), plus `drh.test.js` et `recrute-import.test.js`.

Aucun merge ni déploiement.
