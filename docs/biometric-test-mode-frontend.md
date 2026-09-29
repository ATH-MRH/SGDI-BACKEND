# ATLAS — Mode Test biométrique : guide frontend

## Préconditions

- Servir ATLAS en HTTPS (ou `localhost` pour les essais locaux) ; les navigateurs exigent un contexte sécurisé pour `getUserMedia`.
- `BIOMETRIC_TEST_MODE_ENABLED=true` uniquement dans l’environnement de test, moteur et modèles configurés, sans modifier les variables de production.
- Ouvrir l’administration Pointage avec un compte autorisé sur le site et doté de `attendance × biometric_admin × validate` (ou `admin`), puis choisir **Biométrie → Mode Test facial**.
- Autoriser la caméra dans le navigateur et sélectionner un site dans la liste des sites autorisés. Le panneau reste strictement en Mode Test ; aucune présence n’est écrite.

## Ordinateur Mac / PC

1. Sur Chrome, sélectionner la caméra intégrée (FaceTime HD ou caméra intégrée) ou une webcam USB dans **Caméra**.
2. Cliquer sur **Démarrer le test**, accepter l’invite de permission navigateur, puis patienter devant la caméra.
3. Vérifier l’affichage de l’état, des détails techniques (facultatifs) et du résultat ; contrôler que la bannière « AUCUN POINTAGE NE SERA ENREGISTRÉ » reste visible.
4. Cliquer sur **Arrêter**, puis vérifier que l’indicateur caméra du système/navigateur disparaît. Tester le changement de caméra si plusieurs périphériques existent.
5. Répéter à 1440 px et 1024 px.

## iPhone / iPad

1. Ouvrir l’URL HTTPS dans Safari récent et autoriser l’accès caméra.
2. Vérifier le flux intégré en ligne (sans plein écran), la disposition portrait puis paysage, et l’arrêt de la caméra en quittant l’écran.
3. Si Safari n’expose pas le choix avant la permission, autoriser d’abord l’accès, puis sélectionner la caméra affichée.

## Android / tablette Android

1. Ouvrir l’URL HTTPS dans Chrome et autoriser la caméra.
2. Vérifier que la caméra frontale est proposée par défaut ; utiliser **Changer de caméra** pour tester la caméra arrière si proposée.
3. Répéter en portrait et paysage, puis arrêter le test et vérifier la libération de la caméra.

## Scénarios de diagnostic

Utiliser les cases locales à la page pour planifier les essais avec vrai visage, photo imprimée, photo sur écran, vidéo, plusieurs personnes, faible lumière et contre-jour. Les cases restent dans le navigateur et ne sont pas transmises. **Le Mode Test ne valide pas la sécurité du liveness en production** ; suivre la checklist matériel de site séparément.

> Les essais physiques sur FaceTime, iPhone/iPad et appareils Android ne sont pas certifiés par les tests automatisés ; ils restent à réaliser sur les appareils concernés.
