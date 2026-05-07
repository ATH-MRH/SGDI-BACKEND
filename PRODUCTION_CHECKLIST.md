# SGDI - Checklist Production Coolify

## 1. Secrets Coolify

Configurer ces variables dans Coolify, jamais dans Git :

```text
POSTGRES_PASSWORD=mot_de_passe_postgresql_tres_fort
JWT_SECRET=cle_jwt_longue_aleatoire
```

## 2. Deploiement Coolify

1. Creer un projet Coolify.
2. Ajouter le depot Git du projet.
3. Choisir `Docker Compose`.
4. Renseigner les variables d'environnement.
5. Associer le domaine au service `sgdi` avec le port interne `8000`.
6. Deployer.

## 3. Verifications Apres Deploiement

Tester ces URLs :

```text
https://votre-domaine.com/health
https://votre-domaine.com/health/db
https://votre-domaine.com/
```

Resultat attendu :

- `/health` retourne `ok: true`.
- `/health/db` confirme PostgreSQL.
- `/` affiche SGDI.

## 4. Portail RH Et GPS

Le pointage GPS mobile exige HTTPS.

Utiliser uniquement :

```text
https://votre-domaine.com
```

Ne pas utiliser :

```text
http://adresse-ip:8000
```

## 5. Sauvegardes

Activer une sauvegarde PostgreSQL quotidienne dans Coolify ou via `pg_dump`.

Verifier regulierement que la restauration est possible.

## 6. Securite

- Changer le mot de passe admin apres mise en ligne.
- Ne pas publier `.env`.
- Garder `APP_DEBUG=false`.
- Utiliser HTTPS uniquement.
- Limiter l'acces Coolify aux administrateurs.

## 7. Performance

- Compresser les photos avant import.
- Eviter les photos trop lourdes en base.
- Surveiller la taille PostgreSQL.
- Prevoir une migration progressive vers des tables metier si le volume augmente.
