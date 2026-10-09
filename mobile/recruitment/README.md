# IRON Recrutement — application mobile native V4

Application React Native / Expo pour Android et iOS, avec écrans natifs et appels directs à l’API existante. Aucun WebView. Base vérifiée : commit `6b2aac3da145bf4d8c7ba1dd04a3cd2c83922023`.

## Fonctionnalités livrées

- Accueil avec espaces candidat et RH.
- Dépôt public : identité, téléphone/email, poste, wilaya, adresse, disponibilité, photo JPEG facultative via caméra/photothèque, consentement et référence de réception.
- Suivi public avec référence et nom, selon l’API existante ; affiche aussi les informations de convocation retournées par le serveur.
- Connexion RH avec compte existant, vérification serveur `/auth/me`, jeton conservé dans SecureStore sur Android/iOS, suppression locale à la déconnexion ou après un refus 401.
- Consultation RH : recherche, nouveaux dossiers, réserve, transmis/recrutés, pagination, actualisation et fiche candidat.
- Délais réseau, annulation des recherches obsolètes, messages d’erreur et absence de répétition automatique des dépôts.

## Démarrer sur votre Mac

À partir de la racine du dépôt contenant cette branche :

```sh
cd mobile/recruitment
npm ci
npm start
```

Scanner le QR depuis Expo Go compatible SDK 57. Pour un simulateur iOS ou Android configuré, utiliser les raccourcis proposés par Expo. Les permissions caméra et le stockage sécurisé doivent être vérifiés sur un vrai téléphone. L’export web sert uniquement à la revue d’interface ; SecureStore ne fournit pas une session RH persistante dans le navigateur.

## Produire les applications installables

Les identifiants proposés sont `com.irongs.recruitment`. Vérifier qu’ils sont disponibles dans vos comptes développeur avant la première signature.

```sh
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform ios --profile preview
```

Le profil Android preview génère un APK signé. Le profil iOS interne nécessite le compte Apple Developer, les certificats et l’enregistrement des appareils. La publication en magasin nécessite vos comptes développeur et des fiches validées. Aucun binaire APK/IPA ni aucune publication n’a été produit dans cette intervention.

## API réutilisées

Base fixe HTTPS : `https://recrute.irongs.com/api`.

| Usage | Route |
|---|---|
| Connexion RH | POST `/auth/login` |
| Autorisation réelle du compte | GET `/auth/me` |
| Recherche / consultation RH | GET `/drh/candidates/page` |
| Dépôt candidat | POST `/public/candidates` |
| Suivi candidat | POST `/public/candidates/status` |

Aucun changement backend, migration ou déploiement. Aucune candidature de test envoyée à la production. Les contrôles serveur existants restent l’autorité pour le vivier groupe et les droits RH.

## Limites avant diffusion générale

- La fiche RH reprend les champs du formulaire recrute.html et permet leur édition, y compris l’avis du recruteur. Les entretiens, convocations, ventilations et transferts DRH restent réalisés sur le site existant.
- Les comptes candidats, offres d’emploi publiées, téléchargement de CV/PDF, notifications push et fonctionnement hors connexion ne sont pas implémentés.
- Des constats de sécurité backend ont été identifiés et sont suivis séparément dans un rapport de sécurité privé.
- Un dépôt dont la réponse se perd peut avoir été reçu : l’application ne le répète pas automatiquement et invite à vérifier auprès du recrutement.
- Les tests d’API utilisent des réponses simulées. Aucun compte RH connecté ni téléphone physique utilisé pendant cette intervention ; vérifier les deux parcours avec des comptes de test et une API de recette avant distribution.

## Vérifications

```sh
npm test
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform ios --platform android --platform web
```

Résultats : six tests du client HTTP réussis, TypeScript et lint réussis, Expo Doctor 21/21 contrôles réussis, génération des bundles Hermes Android/iOS et de l’aperçu web réussie. Un bundle Hermes n’est pas un APK/IPA signé.

Documentation officielle utilisée : https://docs.expo.dev/router/installation/, https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/, https://docs.expo.dev/versions/latest/sdk/securestore/.

La vérification visuelle automatisée n’a pas pu être menée : Chromium absent et téléchargement du navigateur interrompu par le réseau. Ne pas considérer l’affichage ou les parcours sur appareil comme validés.

## Correction du formulaire — 8 octobre 2026

Les rubriques et listes sont reprises du formulaire `app/static/recrute.html` : identification, coordonnées, candidature/profil, expérience et avis du recruteur. Les notes et l’avis ne sont accessibles que dans l’espace RH. Les dates sont saisies au format AAAA-MM-JJ sur mobile. La photo se choisit dans la galerie ou avec la caméra.

Le serveur doit recevoir la correction `app/modules/public_candidates.py` avant les nouveaux dépôts publics : ajout des champs CNAS, contact d’urgence, source, taille, pointure et chemise. Aucun changement de base de données n’est requis (données JSON existantes). L’application vérifie `/api/public/candidates/form-config` avant l’envoi pour éviter de perdre les nouveaux champs avec un serveur ancien. Cette correction n’est pas déployée en production.

Vérifications : typecheck et lint passent ; tests HTTP mobiles (7) passent ; export iOS/Android/Web. Le test serveur ajouté vérifie la conservation des champs et l’impossibilité de fournir un avis public. Ce test a depuis été exécuté avec succès dans la suite ciblée de 29 tests backend. La validation visuelle sur iPhone/Android reste à faire.

## CV facultatif

Un CV PDF, JPG/JPEG ou PNG de 5 Mo maximum peut être joint au dépôt candidat, remplacé ou retiré lors de l’édition RH. Le fichier reste privé dans les données JSON du candidat ; les listes ne renvoient que son nom, type et taille. Le téléchargement `/api/drh/candidates/{id}/cv` exige la connexion et l’accès recrutement. La mise à jour serveur est indispensable (form-config version 3). Aucun CV n’est publié dans le répertoire statique uploads. Aucun changement de schéma SQL n’est nécessaire.

Sur mobile, « Ouvrir / enregistrer le CV joint » affiche la feuille système permettant de l’ouvrir dans une application compatible ou de l’enregistrer. Sur web, ce bouton télécharge le fichier. Les nouveaux modules Expo DocumentPicker, FileSystem et Sharing sont installés dans les versions SDK 57. Tester le sélecteur et l’ouverture sur les appareils réels avant diffusion. Sept tests unitaires CV valident les formats, les contenus, la limite, la conservation, le remplacement et le retrait. Le test API complet a depuis été exécuté avec succès.

## Identification candidat et code SMS

L’accueil, l’identification et la saisie du code SMS précèdent maintenant le formulaire. La connexion du téléphone passerelle et les paramètres serveur restent à configurer ; l’envoi SMS est désactivé par défaut. Consulter `SMS_SETUP.md` pour la migration, les paramètres, le contrat d’intégration Android et les tests réalisés. Cette archive fournit l’application recrutement et la connexion serveur ; elle ne contient pas encore l’application Android passerelle à installer sur le téléphone de la société.
