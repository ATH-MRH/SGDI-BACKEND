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
- **Le QR reste celui de l'existant** : il ouvre la page publique signée `/public/badge/{ref}`.
  Les badges déjà en circulation restent valides. Il est généré sur le serveur.
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
- Polices du PDF : Helvetica, Times, Courier (alphabet latin).
- Le modèle « IRON GLOBAL — Référence » est créé au premier accès et n'est pas modifiable : on le
  duplique pour le personnaliser, par société si besoin.

## API (`/api/drh/badges`)

Sous `/api/drh` : module « drh » requis, périmètre société appliqué, actions journalisées dans
`badge_events` et dans le journal d'audit. La gestion des modèles, des paramètres et la
révocation sont réservées aux rôles DRH/RH/administration.

| Méthode | Chemin | Rôle |
|---|---|---|
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

## Données et migration

Migration `20261015_0001_badge_studio` : quatre tables nouvelles (`badge_templates`,
`employee_badges`, `badge_events`, `badge_settings`). Aucune table existante n'est modifiée.

Retour arrière : `alembic downgrade 20261014_0001` supprime ces quatre tables (les badges émis et
leur historique sont alors perdus — exporter avant si nécessaire). Comme `start.sh` lance
`alembic upgrade head`, redéployer un commit antérieur exige d'abord ce downgrade avec le code
courant.

## Tests

- `tests/test_drh_badges.py` : maquette, émission et instantané, remplacement, révocation,
  impression, lot, modèles, périmètre société et rôles.
- `tests_frontend/drh-badges.test.js` : rendu SVG et échappement, aperçus, écrans, émission,
  éditeur (ajout, alignement, verrouillage, annulation, enregistrement).
