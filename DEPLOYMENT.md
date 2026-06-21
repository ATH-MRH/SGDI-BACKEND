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
sgdi.irongs.com
drh.irongs.com
ops.irongs.com
materiel.irongs.com
finances.irongs.com
comptabilite.irongs.com
facturation.irongs.com
commercial.irongs.com
```

`sgdi.irongs.com` garde le portail global. `finances.irongs.com` et
`comptabilite.irongs.com` ouvrent Finances & Comptabilité, tandis que
`facturation.irongs.com` ouvre exclusivement le module Facturation.
