# Gestion des équipements (Administration Système)

Rubrique **Administration → Identités & accès → Gestion des équipements** (route
`admin/terminaux-faciaux`, inchangée pour les liens existants). Réservée à l'Administration
Système : administrateur global, ou *Sécurité des accès × Administrer* (`require_system_admin`).

## Registres utilisés — aucune nouvelle table

| Donnée | Table existante |
|---|---|
| Tablettes, smartphones, iPad, iPhone (bornes `/borne`) | `biometric_terminals` |
| Caméras IP lues par le serveur | `cameras` (déclarées dans Gestion du pointage → Caméras) |
| Affectation compte × équipement | `facial_device_authorizations` (une ligne par paire, unique) |
| Historique | `audit_events` (`biometrics.terminal.*`, `biometrics.camera.*`, `biometrics.device.authorizations` avec listes avant / après) |

Aucune migration. L'écran historique (`/facial-devices/authorizations`) et le nouveau module
écrivent les mêmes lignes et la même trace d'audit.

## Routes (`/api/biometrics`)

| Route | Rôle |
|---|---|
| `GET /equipment?society=&site_id=&kind=&type=&state=&user_id=` | Tableau de bord, liste filtrée, options de filtres |
| `GET /equipment/{trm:id\|cam:id}` | Fiche : états administratif / appairage / disponibilité, autorisation faciale, capacités, comptes, historique |
| `GET /equipment/accounts` | Comptes actifs du module Pointeur et leurs équipements |
| `POST /equipment/assignments/check` `{keys, user_ids, action}` | Vérification préalable par paire (société, site, éligibilité) — n'écrit rien |
| `POST /equipment/assignments` `{keys, user_ids, action: grant\|revoke}` | Affectation / retrait, **tout ou rien** |
| `GET /pointer/terminals` (Pointeur) | Ajoute `unavailable` : équipements affectés mais inutilisables, avec motif |

Création, modification (nom, emplacement), appairage, révocation, suppression : routes
existantes `/terminals*`. Activation faciale : réglage distinct (`facial_attendance_enabled`),
jamais modifié par une affectation.

## Règles

- Une affectation ne donne que l'usage de l'équipement au poste Pointeur : aucune permission
  biométrique, aucun accès société, aucune activation faciale ; le verrou d'enrôlement
  (`BIOMETRIC_ENROLLMENT_LOCKED`) n'est pas concerné.
- Refus par paire : compte désactivé, compte hors module Pointeur, administrateur global (accès
  déjà complet), équipement révoqué, société / site hors du périmètre du compte. Une seule paire
  refusée annule tout (422, liste des motifs).
- Concurrence : verrou des équipements concernés (ordre stable), relecture sous verrou ; la
  contrainte unique reste le dernier filet (409).
- Le poste Pointeur revérifie tout à « Utiliser » (`/pointer/terminals/activate`) : un retrait
  d'affectation pendant une session prend effet au relevé suivant (≤ 10 s) et à toute activation.
- Aucune réponse ne contient d'adresse réseau, d'identifiant de connexion, de clé, d'empreinte,
  d'identifiant public de terminal ni de code d'appairage.
