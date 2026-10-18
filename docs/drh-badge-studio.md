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
  site, code officiel du site (`sites.official_code` du site de l'affectation active, saisi dans
  Gestion des sites ; jamais l'indicatif radio ni le nom) et statut y sont lus ; aucune
  fiche n'est dupliquée. Une photo ajoutée depuis le studio est enregistrée par le circuit de la
  fiche (même API, même synchronisation de la référence faciale).
- **Un badge émis est un instantané.** Identité, site, fonction, photo et maquette sont figés à
  l'émission : une réimpression reproduit le badge remis, même si la fiche ou le modèle ont
  changé depuis.
- **Un seul badge actif par employé.** Émettre un nouveau badge marque le précédent « remplacé ».
  Une révocation (perte, vol, départ…) est tracée et la page de vérification scannée affiche
  alors « Badge désactivé ».
- **Un seul QR pour pointer et vérifier** : le QR d'un badge émis (format A1, `/p/<code>`) est lu
  par le Pointeur (douchette, caméra) et ouvre au téléphone la page publique du badge ; les badges
  déjà en circulation (`/public/badge/{ref}?t=…`) restent valides. Voir « QR code ».
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
- Voir « Polices et alphabets » pour le français et l'arabe.
- Toute maquette enregistrée ou imprimée passe par `sanitize_design` : seules les propriétés
  connues sont conservées, bornées et typées ; les images embarquées sont des PNG ou JPEG
  vérifiés, 600 Ko au plus chacune.
- Studio : dimensions libres (20 à 300 mm), règles graduées en millimètres, grille de 5 mm
  affichable, aimant de 0,5 mm commutable, guides tirés depuis les règles, zoom propre à la
  surface de conception.
- Le modèle « IRON GLOBAL — Référence » est créé au premier accès et n'est pas modifiable : on le
  duplique pour le personnaliser, par société si besoin.

## Verrou de consultation de l'application

À chaque navigation, l'application repasse en mode consultation (`sgdi-view-mode`) : les champs
de la page sont désactivés jusqu'à **Outils › Déverrouiller**, et une règle CSS les rend
insensibles à la souris. Ce verrou protège les formulaires enregistrables ; il ne s'applique pas
aux champs du studio, selon la convention `data-no-lock` déjà employée ailleurs :

- recherches et filtres (sociétés, sites, fonctions, historique) : toujours utilisables
  (`data-no-lock`, conteneur `data-nav-filter`) ;
- cases et options de l'impression en lot, champs d'émission : utilisables avec le droit
  correspondant (`export` ou `create`), sinon désactivés explicitement ;
- éditeur de modèles et paramètres : modifiables avec le droit `admin`, sinon en consultation
  seule (champs désactivés, outils inactifs, aucun déplacement, aucun enregistrement).

Le serveur contrôle toujours chaque action : une manipulation du navigateur reste refusée (403).
Les champs dont la casse compte (texte des modèles et ses champs `{{nom}}`, légendes, nom du
modèle, référence d'autorisation) portent `data-no-uppercase="1"` : sans cela, l'application les
mettrait en majuscules et `{{nom}}` deviendrait `{{NOM}}`, qui n'est plus un champ.

Après un enregistrement réussi des paramètres, le formulaire n'est plus « modifié » pour
l'application : sa garde de navigation ne bloque plus la sortie de l'écran.

## Groupe sanguin

Donnée médicale sensible, lue dans la fiche employé (`groupeSanguin`), sans nouvelle colonne ni
migration.

- **Valeurs** : O+, O−, A+, A−, B+, B−, AB+, AB−. Les saisies courantes sont normalisées (`AB-`,
  `ab −`, `O pos`, `0+` saisi pour O+). Toute autre valeur est ignorée : rien n'est jamais déduit.
- **Autorisation explicite** : Paramètres › Groupe sanguin sur les badges. L'activation exige le
  droit `admin` des badges et la référence de l'autorisation interne qui encadre ce traitement ;
  sans référence, l'option reste désactivée. Chaque changement est tracé dans l'historique.
- **Obligatoire une fois autorisé** : chaque badge officiel émis avec un modèle qui comporte
  l'élément « Groupe sanguin » le porte. Absent ou non reconnu, l'émission est refusée (unitaire
  et en lot) jusqu'à la régularisation de la fiche. Procédure si la donnée est indisponible :
  un responsable habilité (droit `validate`) émet avec une **dérogation motivée** (non
  communiqué, analyse en attente, refus de l'employé), tracée dans l'historique sans aucune
  valeur ; le badge ne porte alors pas de groupe sanguin et sera renouvelé après régularisation.
- **Masqué** tant que l'affichage n'est pas autorisé (aucune obligation dans ce cas). L'écran
  « Créer un badge » indique toujours l'état de la fiche (renseigné, non renseigné, valeur non
  reconnue) pour régulariser les données à l'avance, sans jamais montrer la valeur.
- **Conformité** : l'activation reste subordonnée à la validation du responsable de la
  conformité. Repères à vérifier par lui : loi algérienne n° 18-07 du 10 juin 2018 (données de
  santé = données sensibles : base légale ou consentement exprès, déclaration ou autorisation
  auprès de l'ANPDP), nécessité de l'affichage sur un badge porté visiblement, information des
  employés. Sans cette validation, ne pas activer l'option en production.
- **Jamais public** : absent de l'API publique du badge, de la page ouverte par le QR (serveur et
  application), du QR lui-même, des journaux et de l'écran historique des autres portails.
- **Côté serveur** : la valeur n'est transmise aux écrans DRH que si son affichage est autorisé
  pour la société de l'employé.
- Information **déclarative**, reprise de la fiche : le badge ne la présente pas comme une
  preuve médicale vérifiée.

Élément de maquette `blood` (« Groupe sanguin ») : position, largeur, hauteur, taille du groupe
et de la légende, couleur, fond, bordure, arrondi, alignement, affichage, verrouillage. Les huit
groupes sont dessinés avec la même police embarquée (signe moins typographique). Sur le modèle
de référence (version 2), il est placé à gauche du QR, sur sa bande : l'espace entre le matricule
et le QR (1,2 mm) ne permet pas de l'y insérer sans réduire le QR sous 12 mm.

### Badges déjà émis

- Le modèle de référence est mis à jour (version 1 → 2) au premier accès, avec une entrée
  dans l'historique. Les badges déjà émis gardent leur maquette (instantané).
- Le groupe sanguin n'est figé dans l'instantané que si son affichage est autorisé au moment
  de l'émission. Il n'est jamais ajouté après coup : il faut émettre un nouveau badge.
- En réimpression, il n'apparaît que s'il figure dans l'instantané **et** que l'affichage est
  toujours autorisé : un retrait d'autorisation le masque aussi sur les anciens badges.

## Aperçu et impression

- **Aperçu du badge** (création, studio, modèles, badge émis, lot) : badge seul ou réaliste
  (porte-badge et cordon, jamais imprimés), recto, verso ou les deux, zoom et **taille réelle**
  (100 % = dimensions physiques à 96 px par pouce, selon l'écran). L'aperçu n'émet rien.
- **Imprimer le badge** : vérification des informations, aperçu de l'instantané, format (carte au
  format exact ou planche A4 avec marges et traits de coupe), PDF. Une réimpression est
  identique au badge remis, comptée et tracée, sans nouvelle émission. Pour un autre modèle,
  on émet un nouveau badge (renouvellement ou remplacement). « Émettre puis imprimer » enchaîne
  les deux pour un employé sans badge.
- **Impression en lot** : recherche, filtres par société, site et fonction, sélection multiple
  (y compris tous les résultats), modèle des badges à émettre, sortie, aperçu collectif (24
  badges au plus), PDF A4 multipage. Chaque badge garde les données de son employé.
- Les PDF demandent une impression **à 100 %** (`/PrintScaling /None`) : désactivez aussi
  « Ajuster à la page » dans la fenêtre d'impression.

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
| GET | `/employees/facets` | Sociétés, sites et fonctions proposés par les filtres |
| GET | `/`, `/{id}`, `/{id}/photo` | Badges émis |
| POST | `/{id}/revoke` | Révocation motivée |
| POST | `/print/pdf` | PDF d'impression (compté et tracé) |
| POST | `/preview/pdf` | Épreuve « SPÉCIMEN » |
| GET | `/history` | Historique |
| GET, PUT | `/settings` | Paramètres (communs ou par société) |

## Permissions

L'accès **explicite** au module « Studio Badges » (clé `badge`, Administration › Utilisateurs ›
Modules) vaut **droit opérationnel** : consulter, rechercher, prévisualiser, émettre, renouveler,
imprimer (seul ou en lot), consulter l'historique, sans autre permission ni action générique
du profil (`BADGE_OPERATIONAL_ROUTES`, `auth/dependencies.py`). Le module DRH seul ne donne rien.
Les opérations sensibles restent des permissions explicites, Administration › Permissions ›
**Studio Badges** :

| Permission | Autorise |
|---|---|
| `create` | Émettre, renouveler, remplacer (accordé aussi par le module) |
| `export` | Imprimer, carte ou planche A4 (accordé aussi par le module) |
| `validate` | Révoquer un badge ; dérogation au groupe sanguin |
| `admin` | Modèles partagés, paramètres (dont l'autorisation du groupe sanguin) |

Restent toujours appliqués : compte actif, sociétés autorisées, **sites autorisés** (un compte
limité à des sites ne voit, n'émet et n'imprime que les badges de ces sites), et la restriction
explicite de **lecture seule** (actions du compte sans aucune écriture : `read`, éventuellement
`validate`/`unlock`), plus forte que le module. Un administrateur global possède tout. Chaque
refus est journalisé (`authorization.badge`) et le portail affiche sa raison précise
(`GET /permissions` → `reasons`).

## QR code

- Généré par le serveur (PDF, aperçus, page publique, écran historique) : le lien signé n'est
  transmis à aucun service externe.
- Le QR d'un badge émis porte l'identifiant de CE badge et une signature qui lui est propre.
  Révoqué, remplacé ou expiré, il affiche « Badge désactivé », même si l'employé a reçu un
  nouveau badge depuis. Une signature ne peut pas être rejouée sur un autre badge.

### Format A1 (badges émis depuis la PR « QR de pointage A1 »)

`https://<hôte>/p/A1<numéro : 7 car.><signature : 16 car.>` — exemple au contenu factice :
`https://badge.irongs.com/p/A10000042ZZZZZZZZZZZZZZZZ` (52 caractères).

- **Pourquoi** : une douchette émule un clavier. La HENEX HC-866 réglée « AZERTY PC » et branchée
  sur un Mac AZERTY tape « - » au lieu de « = » (et « ! » au lieu de « _ ») : l'adresse précédente
  `…?t=…&b=…` arrivait en `…?t-…`, refusée (« QR mal lu par le lecteur »). Le format A1 n'emploie
  que des lettres, des chiffres et « : / . », identiques sur les deux AZERTY et vérifiés sur la
  HC-866 réelle.
- **Code** : base 32 de Crockford (chiffres et majuscules, sans I, L, O, U), insensible à la casse
  par définition (Verr. Maj. sans effet). Aucun autre caractère n'est réinterprété ; une lecture
  abîmée n'est jamais « réparée » (`?t-` reste refusé).
- **Signature** : HMAC-SHA256 du numéro de badge, 80 bits, clé dérivée du secret de l'application
  et propre à cet usage (un jeton de lien public ou de session ne vaut rien en A1).
- **Contrôles au Pointeur** : identiques au badge Studio — badge actif, remplacé, révoqué, expiré,
  employé, société, site, liste noire, vacation, clôture, doublons (`app/modules/portal/routes.py`,
  `_scan_issued_badge`).
- **Téléphone** : `/p/<code>` (et `/P/<code>`) affiche la page publique du badge ; `/api/p/<code>`
  sa version JSON. Aucune donnée personnelle dans le QR.
- **Badges déjà émis** : leur QR est enregistré à l'émission (`snapshot.qr_url`) et n'est jamais
  réécrit ; ils restent valides au Pointeur et au téléphone. Pour qu'un employé passe au format A1,
  on **réémet** son badge depuis le studio (l'ancien est alors révoqué : un seul badge physique).
- **Retour arrière** : le code antérieur ne connaît pas `/p/` ; les badges émis en A1 entre-temps
  seraient refusés jusqu'au retour du code A1. Les badges plus anciens ne sont pas concernés.
  **Branche `rollback/a1-emission-v0` (déployée en cas de retour arrière)** : les nouveaux badges
  reprennent le format précédent ; la lecture A1 (Pointeur, `/p/`, `/api/p/`) est intégralement
  conservée, si bien qu'aucun badge A1 déjà imprimé ne devient invalide.
- Le studio contrôle le QR en direct et à l'enregistrement : 12 mm de côté au minimum, cadre
  carré, entièrement sur la carte, opaque, sombre sur fond clair.

## Polices et alphabets (français et arabe)

- **Latin, français accentué compris** : polices standard du PDF (Helvetica, Times, Courier),
  inchangées.
- **Arabe et noms mixtes** : dès qu'un texte sort du latin, il est dessiné avec **DejaVu Sans**
  (normal et gras), embarquée dans l'application (`app/static/fonts/`, licence jointe) et
  incorporée au PDF. Le serveur met les lettres en forme liée (`arabic-reshaper`) et calcule
  l'ordre d'affichage bidirectionnel Unicode (`python-bidi`) : l'arabe se lit de droite à
  gauche, les mots latins et les nombres restent de gauche à droite dans la même ligne. Le sens
  d'une ligne est celui de son premier caractère directionnel. Voir
  `app/modules/drh/badge_text.py`.
- **Aperçu** : le navigateur charge la même police depuis l'application et fait lui-même la
  mise en forme ; chaque segment est isolé pour suivre la même règle de sens que le PDF.
- Aucun texte, aucune police et aucun QR ne passent par un service externe ; générer un badge
  ne demande aucun accès réseau.
- Le texte de la fiche est conservé tel quel dans l'instantané du badge ; seule sa mise en forme
  est calculée au rendu.
- Une écriture sans police dans l'application (idéogrammes, par exemple) reste refusée à
  l'émission, avec un message explicite.
- Limites connues : pas d'italique en arabe ; les ligatures décoratives (« الله » en un seul
  signe) sont écrites en lettres liées ordinaires ; DejaVu Sans est une police sobre, non
  calligraphique.

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

- `20261017_0003_site_official_code` : colonne facultative `sites.official_code` (+ index), le
  code officiel imprimé sur les badges (ex. ETP/DF/H01). `sites.indicatif` est l'indicatif radio
  du site, pas ce code. Aucune valeur n'est déduite : les codes se saisissent dans la fiche du
  site, chaque changement est journalisé (`ops.site.official_code`). Sans code, l'émission avec
  un modèle qui l'imprime est refusée. Descente : colonne conservée.

- `20261015_0001_badge_studio` : quatre tables nouvelles (`badge_templates`, `employee_badges`,
  `badge_events`, `badge_settings`). Aucune table existante n'est modifiée.
- `20261015_0002_badge_permissions` : ajoute la fonctionnalité « badges » aux contraintes de
  `user_feature_permissions`. Aucune permission n'est créée.
- Les deux révisions viennent après la chaîne IRON Emploi : `20261014_0001` →
  `20261014_0002` … `20261016_0001` → `20261015_0001` → `20261015_0002` (une seule tête). Les
  identifiants ne suivent donc pas l'ordre des dates ; seule la parenté compte.
  `20261016_0001` est la révision du code de `main` sans le studio : c'est la cible de tout
  `stamp` de retour arrière. Ne jamais viser `20261014_0001`, qui ferait rejouer, ou retirer
  avec `downgrade`, les migrations IRON Emploi (annonces, espaces candidats, candidatures).

## Retour arrière (non destructif)

Ne jamais lancer `alembic downgrade` en production comme procédure automatique.

1. **Couper la fonctionnalité** : variable d'environnement `BADGE_STUDIO_ENABLED=false`, puis
   redémarrage. Toute l'API `/api/drh/badges` répond 503 ; aucune donnée n'est touchée. Remettre
   `true` pour rétablir.
2. **Revenir au code précédent** si nécessaire : avec le code courant,
   `alembic stamp 20261016_0001` (n'écrit que la révision, ne supprime rien), puis redéployer le
   commit précédent. Répété sur PostgreSQL local avec le code de `main` : il démarre et
   fonctionne sur la base contenant les nouvelles tables ; badges, modèles et historique sont
   intacts au retour (`alembic upgrade head`). Pendant ce retour arrière :
   - le QR des badges émis par le studio répond « lien invalide » (l'ancien code ne connaît pas
     le lien propre à chaque badge) ; il revalide dès le retour au code du studio ;
   - réenregistrer les droits d'un utilisateur dans l'ancienne Matrice des droits efface ses
     permissions badges (la simple consultation ne les touche pas) : elles sont à réattribuer.
3. **Garde-fou** : si `alembic downgrade` est tout de même exécuté, les tables et les
   permissions sont conservées dès qu'elles contiennent des données ; elles ne sont retirées
   que si le studio n'a jamais servi.
4. **Dernier recours** : restauration de la sauvegarde PostgreSQL prise avant le déploiement.

### Groupe sanguin, aperçu et impression (sans migration)

Cette évolution n'ajoute ni colonne ni migration : le retour au commit précédent est un simple
redéploiement, sans `stamp`. L'ancien code ignore l'élément « Groupe sanguin » des maquettes et
les nouveaux paramètres : rien ne s'affiche, aucune donnée n'est perdue. En revanche, il
exposerait de nouveau le groupe sanguin sur la page publique du QR : un retour arrière doit
rester bref, et ne pas être fait sans en mesurer cet effet.

## Tests

- `tests/test_drh_badges.py` : maquette, émission et instantané, remplacement, révocation,
  impression, lot, modèles, périmètre société, permissions, QR, arabe et noms mixtes,
  interrupteur, retour arrière.
- `tests_frontend/drh-badges.test.js` : rendu SVG et échappement, aperçus, écrans, émission,
  éditeur (ajout, alignement, verrouillage, annulation, enregistrement).
- `tests/test_drh_badges_blood_print.py` : groupe sanguin (normalisation, autorisation,
  instantané, réimpression, confidentialité de l'API et de la page publiques, journaux), modèle
  de référence version 2, PDF aux formats 54 × 86 et 85,6 × 54 mm, filtres et PDF A4 du lot.
- `tests_frontend/drh-badges-blood-print.test.js` : verrou de consultation (code réel de
  l'application), droits, groupe sanguin, aperçu, impression individuelle, lot, paramètres,
  éditeur et consultation seule, casse des champs.
