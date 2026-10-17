# Portail candidat emploi.irongs.com

## Produit

`https://emploi.irongs.com` (et `www.emploi.irongs.com`) sert l'accueil public :
recherche, filtres par wilaya, société et contrat, offres réelles paginées, candidature
spontanée, téléchargement Android et QR local vers le site. Aucun compteur ou poste
fictif n'est ajouté au produit. Les brouillons et annonces clôturées restent invisibles
suivant les règles existantes de l'API publique.

Les liens d'offre ouvrent `/espace/offers/<id>`. `/espace/` sert la version web de
l'application, construite depuis `mobile/recruitment` par une étape Docker Node 24.
Expo Router utilise un préfixe `/espace` seulement pour cet export. Le navigateur
appelle `/api` sur la même origine : aucune nouvelle exception CORS n'est nécessaire.
Android/iOS continuent d'utiliser leur configuration API existante.

Le compte, le code SMS, le profil, le CV, les candidatures, les échanges et les
convocations utilisent exactement les API existantes. Aucun second stockage candidat
ni nouvelle table. Les sessions web restent dans sessionStorage, limitées à l'onglet.
Les CV restent protégés par les mêmes contrôles serveur. Le PDF de convocation se
 télécharge dans le navigateur ; il n'est pas conservé durablement par le site.
Un téléchargement conservé par le candidat reste sous sa responsabilité.

## Configuration et ouverture

1. Déployer ce code après tests et CI. L'export web est construit dans Docker et
   copié dans l'image, pas versionné. `/emploi` permet de vérifier l'accueil sur
   l'hébergement existant avant de basculer le DNS.
2. Dans le DNS du domaine, créer `emploi` en A vers **l'adresse IPv4 actuelle vérifiée
   du serveur ATLAS**. Pour `www.emploi`, ajouter un CNAME vers `emploi.irongs.com`.
   Ne pas copier une adresse supposée sans contrôle.
3. Ajouter `https://emploi.irongs.com` et `https://www.emploi.irongs.com` aux domaines
   de l'application ATLAS dans Coolify. Garder les domaines existants. Activer/contrôler
   le certificat HTTPS, puis tester les deux adresses.
4. Pour le téléchargement durable, copier l'APK Android vérifié et signé sur un
   emplacement persistant hors Git ; le monter en lecture seule dans le conteneur,
   par exemple `/app/downloads`. Définir `RECRUITMENT_ANDROID_APK_PATH` vers le fichier
   `.apk` exact. `/emploi/telecharger` gardera la même adresse pour les prochaines versions.
   Alternative provisoire : `RECRUITMENT_ANDROID_APK_URL`, une URL HTTPS de téléchargement
   valide. Aucune URL Expo temporaire n'est codée en dur. Sans fichier ni URL configurés,
   le téléchargement retourne 503 avec un motif, le site reste utilisable.
5. Vérifier catalogue, recherche, filtre, retour navigateur et actualisation d'une
   URL profonde ; identification SMS avec un numéro du personnel ; dépôt d'un CV,
   candidature puis présence du dossier dans recrute.irongs.com ; téléchargement et QR.
6. Ne pas ouvrir les accès administratifs au candidat : leurs routes gardent les
   droits existants. `fr.irongs.com` et `recrute.irongs.com` ne changent pas de rôle.

Ce changement ne configure ni le DNS ni Coolify à lui seul. Il ne téléverse aucun APK.

## Compteurs dans l'application et sur le site

Les pastilles numériques remplacent le point de la cloche, affichent les messages non
lus et les convocations à consulter (version envoyée non encore vue, entretien à venir).
À zéro elles disparaissent ; au-delà de 99 elles affichent 99+.
L'icône de l'application demande le badge total des notifications non lues, sans ajouter
les messages une seconde fois. Le payload push comporte ce total au moment de l'envoi.
Il est resynchronisé après une lecture, au retour dans l'application et périodiquement.
La déconnexion remet le badge à zéro. Un changement de compte n'affiche pas les compteurs
de l'ancien compte en attendant la nouvelle réponse.

Le rendu du badge système dépend du lanceur Android et des autorisations. Les compteurs
à l'intérieur de l'application sont indépendants de cette capacité. Les notifications
push web ne sont pas ajoutées : le suivi dans le site utilise les compteurs serveur.
Un nouvel APK est nécessaire pour les changements natifs ; aucun build EAS ni essai
physique n'est effectué par ce correctif.

## Retour arrière

Pas de migration à annuler. Revenir au code précédent et retirer les nouveaux domaines
si nécessaire. Les profils et candidatures restent dans les tables existantes.

## Vérifications de cette livraison

- 44 tests serveur ciblés : portail, téléchargements, séparation des domaines,
  notifications et leur file, compteurs et convocations.
- 41 tests mobiles, typage et lint sans erreur.
- 2 tests du catalogue (filtres envoyés, contenu échappé, erreur/reprise/absence de résultat).
- Chrome réel contre un serveur SQLite isolé : catalogue, filtre, détail, demande et
  validation d'un code avec passerelle locale fictive, ouverture de session, choix d'un
  vrai PDF par le sélecteur du navigateur, envoi, vérification de la pièce dans le dossier
  recruteur et rechargement d'une URL profonde. Le profil est prérempli par API dans ce
  scénario pour isoler la sélection du fichier ; sa saisie complète n'est pas rejouée.
- Revue visuelle locale à 1440 et 390 px. Aucun accès à la production durant ces essais.
- Exports web, Android et iOS réussis. Aucun APK/IPA construit ni essai sur téléphone.
- DNS, certificats, montage de l'APK et construction Docker complète restent à vérifier
  dans l'environnement de déploiement ; ces accès ne sont pas disponibles ici.
