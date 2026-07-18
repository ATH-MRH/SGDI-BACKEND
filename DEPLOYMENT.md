# Déploiement production

## Build recommandé

Utiliser le build pack **Dockerfile**.

Ne pas utiliser **Nixpacks** pour ce projet en production : Nixpacks télécharge `nixpkgs` pendant le build et peut échouer avec l'erreur :

```text
no space left on device
écriture dans le fichier : espace insuffisant sur le périphérique
```

Le dépôt contient déjà un `Dockerfile` léger basé sur `python:3.13-slim`.

## Commande de lancement

Le conteneur lance automatiquement :

```bash
/app/start.sh
```

`start.sh` refuse toute base autre que PostgreSQL en production, attend que le
serveur PostgreSQL soit joignable, exécute `alembic upgrade head` à chaque
déploiement, puis démarre Uvicorn. Si PostgreSQL ou une migration échoue,
l'application ne démarre pas.

## Variables importantes

Configurer au minimum :

```text
DATABASE_URL=postgresql+psycopg2://utilisateur:mot_de_passe@serveur:5432/base
JWT_SECRET=...
ADMIN_SYSTEM_PASSWORD=...
```

Les secrets doivent être configurés dans le panneau de l'hébergeur, pas dans le Dockerfile.

`DATABASE_URL` doit toujours viser la base PostgreSQL persistante du serveur.
Ne jamais utiliser SQLite ni une base temporaire en production. Les
déploiements successifs réutilisent la même base et le même volume PostgreSQL ;
les migrations modifient le schéma sans effacer les données.

## Domaines

Les sous-domaines suivants peuvent pointer vers le même service :

```text
atlas.irongs.com
drh.irongs.com
ops.irongs.com
materiel.irongs.com
finances.irongs.com
comptabilite.irongs.com
facturation.irongs.com
commercial.irongs.com
agenda.irongs.com
```

`atlas.irongs.com` garde le portail global. `finances.irongs.com` et
`comptabilite.irongs.com` ouvrent Finances & Comptabilité, tandis que
`facturation.irongs.com` ouvre exclusivement le module Facturation.
`agenda.irongs.com` ouvre le module Agenda.

Important : `atlas.irongs.com` doit pointer vers le service backend SGDI/ATLAS
qui sert `app/static/index.html`. Il ne doit pas pointer vers une page vitrine
ou un site marketing séparé, sinon l'utilisateur verra la page de présentation
au lieu de l'écran de connexion.

## Convention des identifiants

Les comptes SGDI/ATLAS suivent une nomenclature lisible :

```text
ADG01              Administrateur général
ADM01, ADM02      Administrateurs système
ATL01, ATL02      Responsables / direction
DRH01, DRH02      Structure DRH
OPS01, OPS02      Structure OPS
MAT01, MAT02      Matériel / équipement
FIN01, FIN02      Finances & comptabilité
COM01, COM02      Commercial
SEC01, SEC02      Secrétariat général
AGD01, AGD02      Agenda
```

L'identifiant aide à reconnaître le type de compte, mais les droits réels
restent pilotés par le profil d'accès, les structures autorisées, les sociétés
autorisées et les sites autorisés.
