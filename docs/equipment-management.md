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

## Associer un appareil par QR code

**Administration → Gestion des équipements → Associer un appareil** (terminal non associé), ou
« Remplacer le matériel » (terminal déjà associé). La fenêtre affiche :

- un grand QR code : l'adresse `https://pointeur.irongs.com/borne#pair=CODE` ;
- le même code en clair (`XXXXX-XXXXX`) pour une saisie manuelle ;
- la durée de validité restante (10 minutes), « Générer un nouveau QR » (l'ancien code est
  aussitôt invalide) et « Fermer » ;
- « Association réussie » dès que l'appareil est associé (suivi toutes les 3 s).

Sur la tablette ou le smartphone, page `/borne` : « Scanner le QR d'association » ouvre la caméra
arrière (lecteur QR du navigateur, ou `html5-qrcode` local sur Safari). Seul le code est extrait
du QR — aucune autre adresse n'est ouverte. Après validation par le serveur, « ✓ Association
réussie » puis retour automatique à l'écran de la borne. Caméra refusée ou absente : « Caméra
indisponible — saisissez le code manuellement ».

Même mécanisme qu'avant (aucun second système) : `POST /terminals/{id}/pairing-code` puis
`POST /terminal/pair`. Code aléatoire (≈ 49 bits), 10 minutes, usage unique, empreinte SHA-256
seulement, limite de 10 échecs par adresse IP. Refus distincts :

| Code | HTTP | Message |
|---|---|---|
| `PAIRING_CODE_INVALID` | 401 | Code d'association invalide |
| `PAIRING_CODE_EXPIRED` | 410 | QR expiré — générez un nouveau code |
| `PAIRING_CODE_USED` | 409 | QR déjà utilisé |
| `PAIRING_REFUSED` | 403 | Association refusée — appareil ou site non autorisé (terminal révoqué, supprimé, désactivé, site inactif) |

Après usage, l'empreinte du code reste sur le terminal sans date de validité : un second essai
(QR rescanné, deux appareils simultanés — verrou de ligne, une seule écriture réussit) est
reconnu « déjà utilisé ». Le code associe toujours le terminal pour lequel il a été émis, donc sa
société et son site. L'association n'active jamais le pointage facial, n'attribue aucune
permission et ne modifie ni les affectations ni les autres équipements. Chaque essai est
journalisé (`biometrics.terminal.pair`, motif), jamais avec le code.
