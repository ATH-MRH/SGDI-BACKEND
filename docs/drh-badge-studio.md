# Studio Badges DRH

Création, émission, impression et suivi des badges du personnel, dans le Portail DRH.

## Où le trouver

- Menu latéral DRH, rubrique **GESTION DES BADGES** : Tableau de bord, Créer un badge, Badges du
  personnel, Studio de conception, Modèles, Impression en lot, Historique, Paramètres.
- Fiche employé : bouton **Créer / gérer le badge**.
- Routes : `#/drh/badges/<écran>[/<paramètre>]` (`creer/<id employé>`, `studio/<id modèle>`).
- Dans le Portail DRH, l'ancien écran `#/fiches/badge` redirige vers le studio. Les autres
  portails (OPS, Matériel, Administration), qui n'ont pas accès aux routes DRH, gardent l'écran
  historique.

## Principes

- **La fiche employé reste la source de vérité.** Société, nom, prénom, matricule, fonction,
  site, code du site (indicatif du site de l'affectation active) et statut y sont lus ; aucune
  fiche n'est dupliquée. Une photo ajoutée depuis le studio est enregistrée par le circuit de la
  fiche (même API, même synchronisation de la référence faciale).
- **Un badge émis est un instantané.** Identité, site, fonction, photo et maquette sont figés à
  l'émission : une réimpression reproduit le badge remis, même si la fiche ou le modèle ont
  changé depuis.
- **Un seul badge actif par employé.** Émettre un nouveau badge marque le précédent « remplacé ».
  Une révocation (perte, vol, départ…) est tracée et la page de vérification scannée affiche
  alors « Badge désactivé ».
- **Le QR ouvre la page publique signée existante** `/public/badge/{ref}` ; les badges déjà en
  circulation restent valides. Voir « QR code ».
- **Le porte-badge et le cordon ne sont qu'un aperçu d'écran.** Le PDF d'impression est produit
  par le serveur et ne contient que la carte, au format exact (54 × 86 mm par défaut), ou une
  planche A4 avec traits de coupe. Une épreuve PDF (studio, création) est barrée « SPÉCIMEN » et
  n'est pas comptée comme une impression.

## Maquette

Une maquette est un document JSON en millimètres (`app/modules/drh/badge_design.py`) : une ou
deux faces, chacune avec un fond et des éléments `text`, `photo`, `qr`, `image`, `shape`, `line`.
Le navigateur la dessine en SVG (`app/static/js/modules/badges.js`), le serveur en PDF
(`app/modules/drh/badge_pdf.py`), à partir des mêmes coordonnées.

- Champs disponibles dans un texte : `{{societe}}`, `{{nom}}`, `{{prenom}}`, `{{nom_complet}}`,
  `{{matricule}}`, `{{fonction}}`, `{{site}}`, `{{site_code}}`, `{{statut}}`, `{{numero}}`,
  `{{date_emission}}`, `{{validite}}`. Gras local entre `**doubles astérisques**`.
- Toute maquette enregistrée ou imprimée passe par `sanitize_design` : seules les propriétés
  connues sont conservées, bornées et typées ; les images embarquées sont des PNG ou JPEG
  vérifiés, 600 Ko au plus chacune.
- Studio : dimensions libres (20 à 300 mm), règles graduées en millimètres, grille de 5 mm
  affichable, aimant de 0,5 mm commutable, guides tirés depuis les règles, zoom propre à la
  surface de conception.
- Le modèle « IRON GLOBAL — Référence » est créé au premier accès et n'est pas modifiable : on le
  duplique pour le personnaliser, par société si besoin.

## API (`/api/drh/badges`)

Sous `/api/drh` : module « drh » requis, périmètre société appliqué, actions journalisées dans
`badge_events` et dans le journal d'audit. Voir « Permissions ».

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/permissions` | Permissions badges de l'utilisateur |
| GET | `/dashboard` | Compteurs et activité récente |
| GET | `/employees`, `/employees/{id}`, `/employees/{id}/photo` | Employés et état de leur badge |
| GET, POST, PUT, DELETE | `/templates…` | Modèles (dupliquer, par défaut, archiver) |
| POST | `/issue`, `/issue-batch` | Émission unitaire ou en lot |
| GET | `/`, `/{id}`, `/{id}/photo` | Badges émis |
| POST | `/{id}/revoke` | Révocation motivée |
| POST | `/print/pdf` | PDF d'impression (compté et tracé) |
| POST | `/preview/pdf` | Épreuve « SPÉCIMEN » |
| GET | `/history` | Historique |
| GET, PUT | `/settings` | Paramètres (communs ou par société) |

## Permissions

L'accès au module DRH permet de **consulter** (tableau de bord, listes, historique, aperçus,
épreuves « SPÉCIMEN »). Chaque action exige une permission explicite, accordée dans
Administration › Matrice des droits › DRH › **Badges du personnel** :

| Permission | Autorise |
|---|---|
| `create` | Émettre, renouveler, remplacer un badge (unitaire ou en lot) |
| `validate` | Révoquer un badge |
| `export` | Imprimer (PDF carte ou planche A4) |
| `admin` | Créer, modifier, dupliquer, archiver les modèles ; paramètres |

Un administrateur global les possède toutes. Un refus est journalisé (`authorization.badge`).
Après la mise en production, personne d'autre ne peut émettre tant que ces permissions n'ont
pas été accordées.

## QR code

- Généré par le serveur (PDF, aperçus, page publique, écran historique) : le lien signé n'est
  transmis à aucun service externe.
- Le QR d'un badge émis porte l'identifiant de CE badge (`b=`) et un jeton qui lui est propre.
  Révoqué, remplacé ou expiré, il affiche « Badge désactivé », même si l'employé a reçu un
  nouveau badge depuis. Un jeton ne peut pas être rejoué sur un autre badge.
- Le studio contrôle le QR en direct et à l'enregistrement : 12 mm de côté au minimum, cadre
  carré, entièrement sur la carte, opaque, sombre sur fond clair.

## Polices et alphabets

Le PDF utilise Helvetica, Times et Courier : tout le français accentué est imprimé. Un texte dans
un autre alphabet (arabe, par exemple) n'est pas imprimable avec ces polices : l'émission est
alors refusée avec un message explicite, plutôt que d'imprimer des caractères illisibles.
Prise en charge prévue si le besoin est confirmé : police embarquée couvrant l'arabe, mise en
forme des lettres liées et sens d'écriture droite-à-gauche, côté PDF et côté aperçu.

## Écran historique (`#/fiches/badge`)

Encore accessible hors Portail DRH (Administration, Matériel, OPS, Superviseur par adresse
directe). Il n'émet pas de badge officiel ; désormais :

- son QR est dessiné par le serveur ;
- chaque impression est enregistrée côté serveur AVANT d'être lancée (historique des badges,
  action « Impression (écran historique) », et journal d'audit) ; sans trace, pas d'impression ;
- un bandeau renvoie vers le Portail DRH pour l'émission officielle.

Transition proposée : (1) cette version — impressions tracées ; (2) ouvrir le Studio Badges aux
profils concernés par les permissions ci-dessus ; (3) remplacer l'écran historique par une
redirection, une fois les usages constatés dans l'historique.

## Données et migrations

- `20261015_0001_badge_studio` : quatre tables nouvelles (`badge_templates`, `employee_badges`,
  `badge_events`, `badge_settings`). Aucune table existante n'est modifiée.
- `20261015_0002_badge_permissions` : ajoute la fonctionnalité « badges » aux contraintes de
  `user_feature_permissions`. Aucune permission n'est créée.

## Retour arrière (non destructif)

Ne jamais lancer `alembic downgrade` en production comme procédure automatique.

1. **Couper la fonctionnalité** : variable d'environnement `BADGE_STUDIO_ENABLED=false`, puis
   redémarrage. Toute l'API `/api/drh/badges` répond 503 ; aucune donnée n'est touchée. Remettre
   `true` pour rétablir.
2. **Revenir au code précédent** si nécessaire : avec le code courant,
   `alembic stamp 20261014_0001` (n'écrit que la révision, ne supprime rien), puis redéployer le
   commit précédent. Les tables et les badges émis restent en base. Au retour du studio,
   `alembic upgrade head` les retrouve tels quels (répété sur PostgreSQL local : 6 badges,
   13 événements et 4 permissions conservés).
3. **Garde-fou** : si `alembic downgrade` est tout de même exécuté, les tables et les
   permissions sont conservées dès qu'elles contiennent des données ; elles ne sont retirées
   que si le studio n'a jamais servi.
4. **Dernier recours** : restauration de la sauvegarde PostgreSQL prise avant le déploiement.

## Tests

- `tests/test_drh_badges.py` : maquette, émission et instantané, remplacement, révocation,
  impression, lot, modèles, périmètre société et rôles.
- `tests_frontend/drh-badges.test.js` : rendu SVG et échappement, aperçus, écrans, émission,
  éditeur (ajout, alignement, verrouillage, annulation, enregistrement).
