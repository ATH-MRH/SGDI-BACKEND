# ATLAS — Essais physiques du Mode Test facial sur le pointeur

## Préconditions

- Utiliser l’URL HTTPS de `pointeur.irongs.com` et un compte ATLAS autorisé sur le site, avec la permission `attendance × biometric_admin × validate` (ou `admin`).
- Le backend doit retourner `test_mode_enabled=true`, `engine_available=true`, `permitted=true` et `records_attendance=false` ; sinon le bouton **Mode Test** reste masqué ou le démarrage est refusé.
- Le Mode Test est indépendant du vrai pointage facial. Ne pas activer `BIOMETRIC_ENABLED` pour ces essais. Ne jamais utiliser **Facial** pour tester les images du navigateur.
- Informer les personnes filmées et suivre les règles internes applicables aux essais biométriques. Les cases « Scénarios de test » sont locales à la page.

## Scénario commun

1. Se connecter au pointeur, sélectionner un site autorisé et confirmer que les boutons **Facial** et **Mode Test** sont distincts.
2. Ouvrir **Mode Test** ; vérifier la bannière persistante « AUCUN POINTAGE NE SERA ENREGISTRÉ » et le message NO-GO de validation du liveness en production.
3. Choisir une caméra si plusieurs périphériques sont proposés, puis démarrer et autoriser la caméra dans le navigateur.
4. Vérifier le flux, l’état, le résultat et les détails techniques. Vérifier les appels réseau : statut test-only et reconnaissance test-only uniquement, jamais `/api/biometrics/cameras/{id}/recognize` ni une route d’écriture de présence.
5. Arrêter : l’indicateur caméra du système/navigateur doit disparaître. Reprendre le test, puis passer à **Scanner**, **Planning intelligent** et **Facial** ; le Mode Test doit s’arrêter et ne pas laisser de flux actif.
6. Changer de site pendant le test : la session doit s’arrêter ; redémarrer uniquement après la sélection du nouveau site autorisé.
7. Confirmer que l’historique, les compteurs d’entrée/sortie, le feed et le planning ne reçoivent aucun pointage de test. Vérifier le fonctionnement QR indépendamment si nécessaire.

## Mac / PC

- Chrome : caméra intégrée (dont FaceTime HD sur Mac), webcam intégrée et webcam USB.
- Tester le changement de caméra, le refus de permission, la caméra utilisée par une autre application et le débranchement/interruption pendant le flux.
- Répéter en fenêtre normale et en mode PWA si celui-ci est utilisé.

## iPhone / iPad — Safari

- Ouvrir le domaine HTTPS dans Safari, autoriser la caméra par l’invite native et vérifier que la vidéo reste intégrée (pas de lecteur plein écran).
- Tester portrait/paysage, la caméra frontale, la caméra arrière si le navigateur la propose, le passage en arrière-plan puis le retour.
- Sur iPad, répéter avec clavier/clavier externe et caméra intégrée si disponible.

## Android / tablette — Chrome

- Ouvrir le domaine HTTPS dans Chrome et autoriser la caméra.
- Vérifier la sélection frontale initiale et **Changer de caméra** pour la caméra arrière lorsqu’elle est disponible.
- Répéter portrait/paysage, arrière-plan/retour, refus de permission et libération de la caméra après arrêt.

## Scénarios diagnostiques

Effectuer séparément : vrai visage, photo imprimée, photo sur smartphone, photo sur tablette, vidéo, plusieurs personnes, faible lumière et contre-jour. Consigner l’état, `liveness.result` et les timings seulement dans le cadre prévu par l’organisation. Le Mode Test **ne valide pas la sécurité du liveness** : son statut reste **NO-GO pour la production** jusqu’aux essais matériels de la checklist site.

> L’E2E automatisé utilise Chrome et une caméra virtuelle simulée. Aucun essai physique sur Mac/PC, iPhone/iPad ou Android n’est revendiqué par ce guide ; ces vérifications restent à exécuter sur les appareils concernés.
