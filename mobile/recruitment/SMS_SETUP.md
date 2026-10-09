# Parcours candidat et passerelle SMS — préparation

## État livré

L’accueil affiche uniquement le bouton candidat et un petit « Accès adm. » en bas. Le candidat renseigne nom, prénom et téléphone, demande un code, puis le saisit pour ouvrir le formulaire. Les trois informations vérifiées sont préremplies et non modifiables dans la fiche. Le formulaire et le CV restent ceux de cette version mobile.

Les écrans, l’API serveur et le protocole de connexion de la passerelle sont implémentés. L’application Android de passerelle n’est pas encore installée ni fournie dans cette archive. Aucun SMS réel n’a été envoyé et aucun déploiement n’a été réalisé. L’installation de la passerelle et son raccordement au protocole ci-dessous restent nécessaires lorsque le téléphone sera disponible.

## Configuration serveur

Appliquer le patch cumulatif uniquement sur la base correspondante du dépôt. Il comprend les corrections du formulaire, du CV et du parcours SMS. Si un ancien patch est déjà appliqué, comparer les changements avant application. Exécuter les tests puis la migration Alembic avec la procédure habituelle de déploiement :

```sh
python -m pytest tests/test_recruitment_sms_api.py tests/test_public_candidate_portal.py tests/test_recruitment_sms_unit.py tests/test_candidate_cv_unit.py -q
alembic upgrade head
```

La migration additive `20261008_sms` suit le head du dépôt fourni, `20261010_0001`, et ajoute trois tables dédiées. Vérifier la tête Alembic si la branche serveur a avancé depuis cette archive.

Variables d’environnement :

```dotenv
RECRUITMENT_SMS_ENABLED=false
RECRUITMENT_SMS_GATEWAY_KEY=
```

Créer une clé aléatoire de 32 caractères minimum, réservée au téléphone passerelle et au serveur. Ne pas la mettre dans le code de l’application candidat ni dans Git. Elle doit être conservée dans le stockage sécurisé de la passerelle. N’activer `RECRUITMENT_SMS_ENABLED=true` qu’après installation et configuration de la passerelle. Le serveur refuse les demandes de codes lorsque la passerelle ne s’est pas manifestée depuis 90 secondes.

Le téléphone devra disposer de la SIM de la société, de l’autorisation d’envoyer des SMS, d’Internet et du réseau mobile. Prévoir son fonctionnement permanent et la sélection explicite de la bonne SIM si plusieurs sont présentes. Configurer le proxy pour préserver l’adresse IP réelle des requêtes : le serveur limite les demandes par téléphone et par IP et n’interprète pas directement un en-tête client X-Forwarded-For.

## Protocole réservé à la passerelle Android

Toutes les requêtes utilisent HTTPS et l’en-tête `X-SMS-Gateway-Key`. Le numéro émetteur est celui de la SIM choisie dans le téléphone ; il ne peut pas être choisi en saisissant arbitrairement un numéro sur le serveur.

1. Appeler `POST /api/public/mobile/gateway/poll` toutes les 10 secondes pendant le fonctionnement actif. Le serveur renvoie `{"job": null}` ou un objet `job` contenant `id`, `lease_token`, `phone`, `message` et `expires_at`.
2. Vérifier que la tâche n’a pas expiré. Enregistrer durablement son identifiant et son état local avant l’envoi ; ne pas renvoyer un SMS déjà envoyé si une réponse réseau ou un accusé est perdu.
3. Envoyer `message` au numéro `phone` avec la SIM de la société. Attendre le résultat d’envoi Android ; ce résultat indique l’envoi, pas la réception garantie sur le téléphone candidat.
4. Appeler `POST /api/public/mobile/gateway/ack` avec `{"job_id": "…", "lease_token": "…", "sent": true}` après succès. En cas d’échec confirmé, transmettre `sent: false`. Un accusé réussi peut être répété. Une ancienne location remplacée est refusée.
5. Effacer le texte du SMS et le code du stockage de travail local lorsque l’accusé est accepté. Ne pas journaliser les messages, codes ou clés.

Une tâche est réservée 60 secondes. Le serveur peut reprendre une tâche après perte de réservation et limite les tentatives d’envoi à trois : la déduplication durable côté téléphone est donc nécessaire. La passerelle doit obtenir une nouvelle réservation au besoin pour accuser un envoi déjà effectué sans répéter le SMS.

## Contrôles serveur

- Numéros algériens mobiles 05, 06 et 07 normalisés en +213.
- Code aléatoire à six chiffres, expiration après cinq minutes, cinq essais maximum.
- Renvoi après 60 secondes ; au maximum cinq demandes par téléphone et vingt par IP sur une heure calendaire.
- Code de validation conservé sous empreinte HMAC ; message en attente chiffré et effacé après l’envoi ou la validation.
- Jeton candidat opaque distinct des jetons RH, valable deux heures et conservé uniquement en mémoire dans l’application.
- Dépôt via `POST /api/public/mobile/candidates`, contrôlé par ce jeton. Identité et téléphone doivent correspondre à ceux vérifiés. Un renvoi du même dépôt retourne la même référence, dans la même transaction que la création.
- Le portail candidat web existant conserve son endpoint historique ; ces nouvelles règles protègent le parcours mobile. Les dossiers web portent `telephoneVerifie: false`, les dépôts mobiles vérifiés `telephoneVerifie: true`.
- Les données OTP expirées sont purgées au fil des nouvelles demandes, après 24 heures.

## Vérifications

29 tests backend ciblés passent (SMS, API du parcours complet, formulaire et CV). Les 7 tests HTTP mobiles, le typecheck et le lint passent. Export des bundles iOS, Android et web réussi. Tests réels d’envoi SMS, réception, fonctionnement en arrière-plan du téléphone passerelle et validation visuelle sur appareils à réaliser après configuration.
