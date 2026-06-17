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

`start.sh` exécute les migrations Alembic puis démarre Uvicorn.

## Variables importantes

Configurer au minimum :

```text
DATABASE_URL=postgresql://...
JWT_SECRET=...
ADMIN_SYSTEM_PASSWORD=...
```

Les secrets doivent être configurés dans le panneau de l'hébergeur, pas dans le Dockerfile.

## Domaines

Les sous-domaines suivants peuvent pointer vers le même service :

```text
sgdi.irongs.com
drh.irongs.com
ops.irongs.com
materiel.irongs.com
```

`sgdi.irongs.com` garde le portail global, tandis que les sous-domaines modules ouvrent leur portail dédié.
