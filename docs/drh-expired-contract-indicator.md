# Alerte de contrat expiré dans les effectifs DRH

L’alerte est limitée à « Gestion des effectifs » (`actifs`) dans le contexte DRH. Elle conserve le statut ACTIF : capsule verte, texte blanc et point blanc en temps normal, point rouge animé et ligne légèrement rosée si l’échéance est passée. Les autres écrans, statuts, colonnes et actions restent inchangés.

## Données réutilisées

`GET /api/drh/employees` expose déjà `Employee.contract_end_date`. Le mapping existant `employeeFromApi()` fournit `dateFinContrat` (avec sa priorité historique `extra.dateFinContrat`). L’alerte appelle `employeePositionContractDaysLeft()`, qui utilise `employeePositionContractEndDate()` : même échéance que la fiche de position et le tableau Contrats, y compris les contrats liés déjà chargés (`db.contrats`, `db.contratsPersonnel`) et la durée explicitement renseignée.

`employeeExpiredContractAlert()` ne retient que les employés actifs, non sortants et non bloqués/blacklistés, avec une échéance strictement antérieure à `today()`. La fin aujourd’hui et les échéances futures ne sont pas expirées. Une date de recrutement seule ne suffit pas : la durée de douze mois par défaut du formulaire ne doit pas fabriquer un contrat absent. Aucun endpoint, requête par ligne, statut enregistré, timer JavaScript ou calcul contractuel existant n’est modifié.

## Accessibilité et interaction

Le tooltip « Contrat expiré depuis X jour(s) » est disponible au survol du point ou de la capsule et au focus clavier. Le badge reste un `span` sans action RH ni gestionnaire de clic ; celles-ci restent dans la colonne Action. `aria-label` fournit l’information sans dépendre de la couleur. Seul le point pulse en CSS (1,8 seconde) ; `prefers-reduced-motion: reduce` le rend fixe. Les styles de survol et de sélection de ligne gardent la priorité.

## Validation

`tests_frontend/effectifs-expired-contract.test.js` couvre les limites de dates, les contrats multiples et renouvellements, le mapping API, l’absence de contrat, la priorité des statuts, l’absence de requêtes/minuteurs et le maintien des colonnes/liens/actions. Un test Chrome contrôle les couleurs, le point seul animé, les tooltips souris/clavier, le mouvement réduit et les largeurs 390, 768 et 1440 px. Les captures de recette peuvent être produites dans un répertoire existant avec `EXPIRED_INDICATOR_SCREENSHOTS`.
