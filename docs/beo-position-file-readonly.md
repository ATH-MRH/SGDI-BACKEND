# BEO — Fiche de position en lecture seule, champs autorisés par compte

Portail : `beo.irongs.com` (Bureau des Effectifs Ouest). Rôle : Chargé des effectifs. Clé RBAC
unique : `site_workforce`. Aucune clé `beo` et aucun module `drh` ne sont ajoutés au compte.

## Objectif

- Le Chargé des effectifs consulte la Fiche de position des employés de son périmètre, sans
  pouvoir la modifier.
- L'administrateur choisit, compte par compte, les champs de cette fiche que le compte peut voir.
- Le serveur fait foi : un champ non autorisé n'est jamais calculé ni transmis.

## Sources de données (aucune copie)

La fiche est une **projection** calculée à chaque requête. Le module est
`app/modules/site_workforce/position_file.py`. Aucune table ne duplique les données RH ; la
seule nouvelle table stocke les droits.

| Groupe | Source canonique |
|---|---|
| Identité (nom, prénom, code, statut, naissance, téléphone, NIN, adresse) | colonnes `employees` (DRH) |
| N° de pièce d'identité, coordonnées bancaires | `Employee.extra` fusionné avec `extra._legacy`, la même fusion que DRH et les badges |
| Groupe sanguin | `badge_routes.blood_group_of` (DRH) |
| Photo | photo canonique (`ops/employee_photos.canonical_photos`), servie par `GET /api/site-workforce/positions/{id}/photo` |
| Position actuelle | `Assignment` active sur un site autorisé, `Site`, `RotationTemplate` (OPS) |
| Vacation du jour | `attendance/official.official_shift`, la source officielle du travail posté |
| Fonction contractuelle | `Employee.position` |
| Contrat | `Employee.contract_type`, `recruit_date`, `trial_end_date`, `contract_end_date` et le dernier `Contract` ; date de fin = la plus tardive, même règle que la fiche DRH |
| État du contrat, ancienneté | calculés à partir des dates ci-dessus, comme la fiche DRH |
| Historique des affectations | lignes `Assignment` + `Site.name` |
| Historique des contrats | lignes `Contract`, **sans le salaire** |
| Sanctions | lignes `Sanction` : date, type, jours de mise à pied, site ; **jamais le texte de la faute** |

Constats de l'audit :

- La fiche DRH principale (`sgdi-app.js`, `renderAgentForm`) lit surtout `Employee.extra`.
- `GET /api/drh/employees/{id}/fiche-position` existe, mais exige le module `drh` et renvoie
  l'employé entier.
- Le BEO ne l'appelle donc jamais : les mêmes tables sont lues côté serveur par le module
  `site_workforce`.

## Endpoints

### Portail BEO

Module `site_workforce`, action `read`, périmètre résolu par `resolve_scope`.

- `GET /api/site-workforce/positions?society=&site_id=&q=&position=&status=&page=&page_size=`
  - Liste paginée en SQL : 3 requêtes, quel que soit le volume.
  - Colonnes et valeurs limitées aux champs autorisés.
  - Une recherche ou un filtre ne porte **que** sur des champs autorisés. Sinon, il servirait
    d'oracle sur une donnée masquée.
- `GET /api/site-workforce/positions/{employee_id}` renvoie
  `{employee_id, site_id, sections:[{key,label,fields:[{key,label,kind,value,columns?}]}], read_only:true}`.
- `GET /api/site-workforce/positions/{employee_id}/photo` exige que le champ `identity.photo`
  soit autorisé.
- Aucune route d'écriture n'existe sous `/positions`.

### Administration

Garde `require_admin`, la même que `PATCH /api/auth/users`. Ces routes sont montées sous
`/api/auth`, que le compte BEO ne peut pas appeler avec succès.

- `GET /api/auth/site-workforce/position-fields` : le catalogue. Pour chaque champ : sections,
  clés, libellés, ordre, sensibilité, valeur par défaut. Plus le profil standard et le total.
- `GET /api/auth/users/{user_id}/site-workforce/position-fields` : la sélection effective du
  compte, avec `profile` = `beo_standard`, `custom` ou `none`.
- `PUT /api/auth/users/{user_id}/site-workforce/position-fields` avec le corps
  `{"fields": [...]}` remplace la sélection. Les refus :
  - 404 : utilisateur inconnu ;
  - 403 : compte de l'administrateur lui-même ;
  - 422 : compte sans `site_workforce` ;
  - 422 : clé inconnue (rien n'est écrit).

## Règle d'accès

Un accès n'est accordé que si **toutes** ces conditions sont remplies :

- utilisateur actif ;
- module `site_workforce` ;
- action `read` ;
- société autorisée ;
- site autorisé (affectation active) ;
- champ autorisé.

Les droits par champ ne remplacent jamais le périmètre. Retirer le champ « Site » masque la
valeur, mais l'employé d'un site non autorisé reste refusé.

Réponses hors périmètre :

- Employé hors périmètre, ou inexistant : **403** avec le même message. On ne laisse pas deviner
  qu'un employé existe ailleurs.
- `site_id` ou `society` forgés : 403 (`build_scope`).

## Stockage des droits

Table `user_field_permissions` : `id, user_id, module_key, resource_key, field_key, created_at,
created_by_user_id`, avec l'unicité `(user_id, module_key, resource_key, field_key)`.

- Une ligne correspond à un champ autorisé.
- Pour cette fiche : `module_key = site_workforce`, `resource_key = position_file`.
- La structure est générique et réutilisable pour d'autres ressources ; aucune autre n'est
  branchée dans ce lot.
- Il n'y a pas de contrainte CHECK sur les clés : le catalogue applicatif peut évoluer sans
  migration. Une clé inconnue est refusée à l'écriture et ignorée à la lecture.

Le modèle `UserFieldPermission` est dans `app/modules/auth/field_permissions.py`, et non dans
`auth/models.py`. La migration initiale et `migrations/env.py` importent `auth/models.py` et font
`create_all` : la table serait alors créée sur toute base reconstruite depuis zéro, avant sa
propre migration. Ce n'est pas le chemin de la production. La migration garde malgré tout un
contrôle `has_table` par sécurité.

Pourquoi pas `user_feature_permissions` :

- C'est le moteur préparatoire « non activé ».
- Ses contraintes CHECK figent la liste des fonctionnalités et des actions.
- L'étendre à environ 30 champs aurait demandé de reconstruire ces contraintes et aurait mélangé
  champs et fonctionnalités.

## Deny by default

- Aucune ligne pour un compte signifie **aucun champ métier**. Une sélection vide ne veut jamais
  dire « tout ».
- Les sections sans champ autorisé sont absentes de la réponse.
- Un champ interdit est absent, jamais renvoyé à `null`.
- Seuls des identifiants techniques sont toujours renvoyés : `employee_id` et `site_id`. Ils
  servent à identifier la ligne et à signaler une anomalie.

## Catalogue des champs

Légende de la colonne Statut :

- **S** : coché par le profil BEO Standard ;
- **sensible** : jamais coché par défaut ; cocher en masse demande une confirmation.

| Section | Clé | Libellé | Statut |
|---|---|---|---|
| Identité | `identity.last_name` | Nom | S |
| | `identity.first_name` | Prénom | S |
| | `identity.employee_code` | Code employé | S |
| | `identity.photo` | Photo professionnelle | S |
| | `identity.status` | Statut | S |
| | `identity.birth_date` | Date de naissance | — |
| | `identity.phone` | Téléphone personnel | sensible |
| | `identity.nin` | NIN | sensible |
| | `identity.id_document` | N° pièce d'identité | sensible |
| | `identity.address` | Adresse personnelle | sensible |
| | `identity.blood_group` | Groupe sanguin (donnée médicale) | sensible |
| Position actuelle | `assignment.society` | Société | S |
| | `assignment.site` | Site | S |
| | `assignment.client` | Client du site | — |
| | `assignment.position` | Poste (affectation) | S |
| | `assignment.function` | Fonction contractuelle | S |
| | `assignment.start_date` | Date d'affectation | S |
| | `assignment.group` | Groupe | S |
| | `assignment.vacation` | Vacation du jour | S |
| | `assignment.rotation` | Rotation | S |
| | `assignment.work_regime` | Régime de travail | S |
| Contrat | `contract.type` | Type de contrat | S |
| | `contract.start_date` | Date de début | S |
| | `contract.end_date` | Date de fin | S |
| | `contract.status` | État du contrat | S |
| | `contract.trial_end_date` | Fin de période d'essai | — |
| | `contract.recruit_date` | Date de recrutement | — |
| | `contract.seniority` | Ancienneté | — |
| | `contract.salary` | Salaire net | sensible |
| | `contract.bank` | Coordonnées bancaires (RIB) | sensible |
| Historique | `history.assignments` | Historique des affectations (sites et postes) | S |
| | `history.contracts` | Historique des contrats | — |
| | `history.sanctions` | Sanctions disciplinaires | sensible |

Au total, 33 champs : 19 dans le profil BEO Standard et 8 sensibles. Le catalogue (`CATALOG`)
est la seule source. Une assertion au chargement du module interdit qu'un champ sensible figure
dans le profil standard.

« Responsable / superviseur » n'apparaît pas : aucune donnée canonique ne le porte (ni Employee,
ni Assignment, ni Site). Il n'a pas été inventé.

## Migration et comptes existants

La révision `20261024_0001` est additive. Elle crée la table et son index.

- Chaque compte qui possède **déjà** `site_workforce` reçoit explicitement le profil BEO
  Standard. Ce profil est un instantané figé dans la migration ; un test vérifie qu'il reste
  égal au catalogue. Aucun champ sensible n'est accordé.
- Un compte BEO créé après la migration ne reçoit rien tant qu'un administrateur n'a pas coché
  ses champs ou cliqué « Profil BEO Standard ».
- Le downgrade supprime la table ; seules ces habilitations sont perdues.
- La migration n'est jamais lancée depuis un poste local vers la production : elle passe par le
  déploiement normal, après validation et fusion.

## Audit

Chaque modification enregistre un `AuditEvent`, le journal d'audit existant, avec
`action=site_workforce.position_fields.replace` et `resource=user_field_permission`. Il contient :

- l'administrateur ;
- la date et l'heure ;
- l'identifiant et le nom du compte cible ;
- les champs ajoutés et les champs retirés.

Les tentatives refusées (clé inconnue, compte non BEO, son propre compte) sont journalisées avec
`result=refused`.

Les consultations ne sont pas auditées : c'est la convention actuelle des lectures BEO (seules les
actions sensibles le sont).

## Interface

### Portail BEO

- Menu « Fiche de position » placé après Personnel, route `#/position` ; la fiche est sur
  `#/position/<id>`. Le routeur accepte désormais un paramètre après la clé d'écran ; les routes
  existantes sont inchangées.
- Dans Personnel, chaque ligne a un bouton « Voir la fiche de position ».
- La liste, la fiche, les libellés et l'ordre sont rendus uniquement depuis la réponse de l'API.
- La fiche ne contient aucun input. Elle s'affiche en 2 colonnes sur desktop et 1 colonne sous
  900 px. Les historiques défilent dans leur propre conteneur.
- « Signaler une anomalie » ne modifie jamais la fiche :
  1. il crée une réclamation (`category=fiche_position`) avec la route existante
     `POST /site-workforce/reclamations` ;
  2. il la transmet à la DRH ou aux OPS avec la route existante `POST /site-workforce/transmissions`.
  - Le destinataire est proposé selon la nature (poste, contrat ou identité → DRH ; site, date
    d'affectation ou rotation → OPS) et reste modifiable.
  - Le suivi se fait dans Réclamations.

### Administration système › Bureau des Effectifs Ouest

- Chaque utilisateur a un bouton « ▥ Champs accessibles » dans la colonne Actions.
- La modal est alimentée par le catalogue serveur. Elle propose :
  - une recherche ;
  - les boutons « Profil BEO Standard », « Tout cocher » et « Tout décocher » ;
  - « Sélectionner toute la section » ;
  - un compteur global et un compteur par section ;
  - un badge « Sensible ».
- Cocher en masse des champs sensibles demande une confirmation.

## Tests

| Fichier | Contenu |
|---|---|
| `tests/test_site_workforce_position_file.py` | catalogue, deny by default, cas BEO_TEST (5 champs autorisés, clés interdites absentes du JSON brut), changements admin, cross-site, cross-société, identifiants forgés, liste sans oracle, action `read`, module, auto-élévation impossible, validation des clés, audit, absence d'écriture, photo, migration (instantané et seed) |
| `tests_frontend/site-workforce-position.test.js` | menu, liste, filtres, Personnel → fiche, rendu dynamique, section absente, lecture seule, signalement |
| `tests_frontend/admin-beo-position-fields.test.js` | modal, BEO Standard, Tout cocher et Tout décocher, section, recherche, compteur, sauvegarde, erreur API, réouverture |

## Limites

- L'annuaire **Personnel** existant (`/api/site-workforce/employees`) affiche toujours code, nom,
  poste et groupe à tout compte BEO. Il n'est pas gouverné par ces cases, et ce lot ne modifie
  pas les écrans existants. Les cases gouvernent la Fiche de position.
- L'historique des affectations peut nommer des sites hors du périmètre actuel du compte. C'est
  l'historique de l'employé, et il n'est visible que si le champ est coché.
- Les sanctions affichées sont celles de la table `sanctions`. Les sanctions saisies seulement
  dans `Employee.extra.sanctions` par l'ancienne fiche DRH n'y figurent pas.
- La vacation n'est renseignée que pour le travail posté au cycle officiel ancré. Sinon : « — ».
