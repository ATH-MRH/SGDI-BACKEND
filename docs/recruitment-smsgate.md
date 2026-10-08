# Codes SMS candidats via SMS Gateway for Android (SMSGate)

Ce guide explique comment faire partir les codes de validation des candidats depuis la SIM
de l'entreprise installée dans le Samsung S21, avec l'application « SMS Gateway for Android »
(capcom6) et un serveur SMSGate privé.

La fonctionnalité est **désactivée par défaut**. Tant que les variables ci-dessous ne sont pas
toutes renseignées, ATLAS n'envoie rien et le portail candidat indique que le SMS est indisponible.

## 1. Comment ça marche

```
Candidat ──> ATLAS ──HTTPS──> serveur SMSGate privé <──HTTPS── Samsung S21 ──SMS──> candidat
                 <──────────── accusés signés (webhooks) ───── Samsung S21
```

- ATLAS ne contacte jamais le téléphone. Le téléphone se connecte lui-même au serveur SMSGate,
  en 4G comme en Wi-Fi : aucune adresse locale ni redirection de port n'est nécessaire.
- ATLAS dépose le SMS sur le serveur SMSGate ; le téléphone le récupère et l'envoie avec sa SIM.
- En mode privé, le réveil du téléphone passe par le serveur public de SMSGate
  (`api.sms-gate.app`), qui relaie une notification push. Le serveur privé doit donc pouvoir
  sortir vers Internet. Le texte des SMS, lui, ne transite que par votre serveur privé.

### Ce que signifient les états

| État dans ATLAS | Ce qui est réellement su |
|---|---|
| `pending` | Le code attend dans la file d'ATLAS. |
| `accepted` | Le serveur SMSGate a pris le message. **Rien n'est encore parti.** |
| `sent` | Le réseau mobile a accepté le SMS depuis le téléphone. |
| `delivered` | L'opérateur a confirmé la remise au téléphone du candidat. |
| `failed` | Abandon après 3 tentatives, refus de la passerelle ou échec signalé par le téléphone. |

Un message peut rester `sent` alors qu'il a bien été reçu : tous les opérateurs ne renvoient pas
d'accusé de livraison. ATLAS n'affiche jamais « livré » sans cet accusé. L'état est consultable
par le portail avec `POST /api/public/mobile/code-status`.

### Pas de SMS en double

Chaque code porte un identifiant de message fixe. Si un appel à SMSGate échoue ou reste sans
réponse, ATLAS relance avec **le même identifiant** : SMSGate refuse un identifiant déjà connu
(réponse 409), ce qu'ATLAS traite comme « déjà accepté ». Les relances sont limitées à
3 tentatives (attente de 5 s puis 15 s) et s'arrêtent dès que le code approche de son expiration.
Le SMS porte aussi une durée de vie égale au temps restant du code : un téléphone resté hors
ligne n'enverra pas un code périmé.

## 2. Installer le serveur SMSGate privé

Prérequis : un serveur Linux avec Docker, une base MariaDB ou MySQL vide, et un nom de domaine
en HTTPS avec un certificat valide (par exemple `sms.votre-domaine.com`). L'application Android
refuse les adresses sans HTTPS.

Sur Coolify, créer un service Docker Compose à partir de cet exemple. Les mots de passe se
saisissent dans les variables d'environnement de Coolify, jamais dans un fichier du dépôt.

```yaml
services:
  smsgate:
    image: ghcr.io/android-sms-gateway/server:latest
    restart: unless-stopped
    environment:
      - GATEWAY__MODE=private
      - GATEWAY__PRIVATE_TOKEN=${SMSGATE_PRIVATE_TOKEN}
      - HTTP__LISTEN=0.0.0.0:3000
      - DATABASE__HOST=db
      - DATABASE__PORT=3306
      - DATABASE__USER=sms
      - DATABASE__PASSWORD=${SMSGATE_DB_PASSWORD}
      - DATABASE__DATABASE=sms
      - DATABASE__TIMEZONE=UTC
    depends_on:
      db:
        condition: service_healthy
  smsgate-worker:
    image: ghcr.io/android-sms-gateway/server:latest
    restart: unless-stopped
    command: ["/app/app", "worker"]
    environment:
      - DATABASE__HOST=db
      - DATABASE__PORT=3306
      - DATABASE__USER=sms
      - DATABASE__PASSWORD=${SMSGATE_DB_PASSWORD}
      - DATABASE__DATABASE=sms
      - DATABASE__TIMEZONE=UTC
    depends_on:
      db:
        condition: service_healthy
  db:
    image: mariadb:lts
    restart: unless-stopped
    environment:
      - MARIADB_RANDOM_ROOT_PASSWORD=1
      - MARIADB_DATABASE=sms
      - MARIADB_USER=sms
      - MARIADB_PASSWORD=${SMSGATE_DB_PASSWORD}
    volumes:
      - smsgate-db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  smsgate-db:
```

1. Générer deux valeurs longues et aléatoires (`openssl rand -hex 32`) pour
   `SMSGATE_PRIVATE_TOKEN` et `SMSGATE_DB_PASSWORD`, et les saisir dans Coolify.
2. Associer le domaine `sms.votre-domaine.com` au service `smsgate`, port 3000, avec HTTPS.
   Ne pas exposer le port de la base.
3. Vérifier : `https://sms.votre-domaine.com/health` doit répondre avec un état correct.

Les noms de variables ci-dessus sont ceux du fichier de configuration officiel du serveur
(`configs/config.example.yml` du dépôt `android-sms-gateway/server`). Cet exemple n'a pas encore
été déployé réellement. Si le conteneur réclame un fichier, suivre la méthode officielle
(<https://docs.sms-gate.app/getting-started/private-server/>) : monter un `config.yml` sur
`/app/config.yml` avec les mêmes réglages. Ne pas modifier `GATEWAY__UPSTREAM_URL` : c'est
l'adresse par laquelle le serveur privé fait réveiller le téléphone.

Le service `smsgate-worker` nettoie les anciens messages. Le serveur SMSGate conserve le texte
des SMS dans sa base le temps de les traiter, puis le remplace par une empreinte : protéger
cette base comme celle d'ATLAS.

## 3. Régler le Samsung S21

1. Installer la version officielle de l'application depuis les « Releases » du dépôt
   `capcom6/android-sms-gateway` (version normale, pas la variante « insecure »).
2. Accepter l'autorisation **SMS**, ainsi que **Téléphone** (nécessaire pour choisir la SIM).
3. Onglet **Settings → Cloud Server** :
   - **API URL** : `https://sms.votre-domaine.com/api/mobile/v1` (le chemin est obligatoire) ;
   - **Private Token** : la valeur de `SMSGATE_PRIVATE_TOKEN`, saisie à la main sur le téléphone.
4. Onglet **Home** : activer **Cloud Server**, laisser **Local Server** désactivé, puis appuyer
   sur le bouton **Offline** jusqu'à ce qu'il affiche **Online**.
5. Un nom d'utilisateur et un mot de passe apparaissent dans la section Cloud Server. Ce sont les
   identifiants à reporter dans ATLAS (étape 4). Ils changent si l'on change de serveur.
6. **Settings → Messages** : ne pas définir de limite par minute/heure/jour ni d'horaires de
   travail pour un téléphone dédié aux codes ; la documentation les déconseille pour les codes
   d'authentification. ATLAS limite déjà les demandes (5 par numéro et 20 par adresse IP par heure).
7. **Settings → Webhooks → Signing Key** : noter la clé de signature (étape 4).
8. Garder l'application active. Dans **Settings → System**, désactiver l'optimisation de
   batterie. Dans les réglages Samsung : *Applications → SMS Gateway → Batterie → Non
   restreinte*, et retirer l'application des « applications en veille » (*Batterie → Limites
   d'utilisation en arrière-plan*). Les intitulés varient selon la version de One UI.
9. Laisser le téléphone branché, avec la 4G ou un Wi-Fi stable.

### Choisir la SIM de l'entreprise

- Une seule SIM dans le téléphone : rien à faire.
- Deux SIM (ou SIM + eSIM) : repérer le numéro de la SIM de l'entreprise avec la commande
  `status` de l'étape 5, puis fixer `RECRUITMENT_SMSGATE_SIM_NUMBER` (1, 2 ou 3) dans ATLAS.
  Chaque SMS porte alors ce numéro de SIM, quel que soit le réglage du téléphone.
- Sans cette variable, c'est le réglage **Settings → Messages** de l'application (SIM par
  défaut du système, alternance ou aléatoire) qui décide : à éviter avec deux SIM.

## 4. Variables à configurer dans ATLAS

À saisir dans les variables d'environnement du serveur ATLAS (Coolify), jamais dans Git.

| Variable | Valeur |
|---|---|
| `RECRUITMENT_SMS_ENABLED` | `true` pour activer. Défaut : `false`. |
| `RECRUITMENT_SMS_PROVIDER` | `smsgate` (défaut). |
| `RECRUITMENT_SMSGATE_API_URL` | `https://sms.votre-domaine.com/api/3rdparty/v1` |
| `RECRUITMENT_SMSGATE_USERNAME` | Nom d'utilisateur affiché par l'application. |
| `RECRUITMENT_SMSGATE_PASSWORD` | Mot de passe affiché par l'application. |
| `RECRUITMENT_SMSGATE_DEVICE_ID` | Optionnel. Identifiant du téléphone (commande `status`). Recommandé : seul ce téléphone enverra les codes. |
| `RECRUITMENT_SMSGATE_SIM_NUMBER` | Optionnel. `1`, `2` ou `3`. |
| `RECRUITMENT_SMSGATE_WEBHOOK_SIGNING_KEY` | Optionnel. Clé de signature de l'application. Sans elle, ATLAS suit les envois en interrogeant le serveur toutes les quelques secondes. |
| `RECRUITMENT_SMSGATE_PRIORITY` | Optionnel, défaut `100` : le code part sans délai d'attente côté téléphone. |
| `RECRUITMENT_SMSGATE_TIMEOUT_SECONDS` | Optionnel, défaut `10`. |

Si ATLAS et SMSGate tournent sur le même réseau Docker privé, une adresse interne en `http://`
n'est acceptée qu'avec `RECRUITMENT_SMSGATE_ALLOW_HTTP=true`. À éviter sur Internet.

Avant le déploiement, appliquer la migration : `alembic upgrade head` (révision `20261011_0001`).

## 5. Tester en conditions réelles

Dans le terminal du conteneur ATLAS (les variables y sont déjà présentes) :

```bash
# 1. Liaison, identifiants, téléphone enregistré, numéros de SIM
python -m scripts.smsgate_check status

# 2. Accusés envoyé / livré poussés par le téléphone vers ATLAS (si la clé de signature est configurée)
python -m scripts.smsgate_check register-webhooks https://adresse-publique-atlas

# 3. SMS d'essai (sans code) vers un numéro mobile algérien, avec suivi des états
python -m scripts.smsgate_check send-test 0550000000
```

Puis, depuis le portail candidat :

1. `GET /api/public/mobile/config` doit renvoyer `"sms_available": true` (dans les 30 secondes
   suivant le démarrage d'ATLAS).
2. Demander un code avec un vrai numéro : le SMS doit provenir du numéro de la SIM de l'entreprise.
3. Saisir le code, puis vérifier dans ATLAS que la candidature porte « téléphone vérifié ».
4. Essais à faire une fois : code faux 5 fois (blocage), code après 5 minutes (expiré), nouvelle
   demande avant 60 secondes (refusée), téléphone en mode avion pendant une demande (aucun SMS
   tardif après l'expiration du code).

## 6. En cas de problème

| Constat | Piste |
|---|---|
| `sms_available` reste `false` | Variable manquante, URL sans `https://`, identifiants refusés, ou téléphone non enregistré. Lancer `status`. |
| État bloqué sur `accepted` | Le téléphone n'a pas récupéré le message : application fermée par Samsung, pas de réseau, ou serveur privé sans accès sortant à `api.sms-gate.app`. |
| État `failed` | Lire le motif dans la colonne `delivery_error` : `gateway_auth` (identifiants), `gateway_http_503` (file du téléphone saturée ou téléphone absent), `RESULT_ERROR_…` (refus du réseau mobile : crédit, couverture, numéro). |
| SMS envoyé par la mauvaise SIM | Fixer `RECRUITMENT_SMSGATE_SIM_NUMBER`. |
| Pas d'état `delivered` | Normal chez certains opérateurs ; `sent` est alors le dernier état connu. |

Les journaux d'ATLAS ne contiennent ni code, ni texte de SMS, ni identifiant de passerelle.

## 7. Ancien protocole maison

Les routes `mobile/gateway/poll` et `mobile/gateway/ack` restent disponibles pour une passerelle
dédiée, uniquement avec `RECRUITMENT_SMS_PROVIDER=poll` et `RECRUITMENT_SMS_GATEWAY_KEY`.
L'application SMS Gateway for Android ne les utilise pas ; elles sont fermées en mode `smsgate`.

## 8. Ce qui reste à faire avant la mise en service

Le code est terminé et couvert par des tests automatiques, mais **aucun envoi réel n'a encore
été effectué** : ni serveur SMSGate privé, ni Samsung S21 n'étaient disponibles pendant le
développement. Restent à faire, dans l'ordre :

1. Déployer le serveur SMSGate privé (section 2) et vérifier `/health`.
2. Connecter le Samsung S21 au serveur (section 3) et relever ses identifiants.
3. Saisir les variables dans ATLAS (section 4), appliquer `alembic upgrade head`, redémarrer.
4. Lancer `status`, `register-webhooks` puis `send-test` (section 5).
5. Faire les essais du portail candidat (section 5), dont le mode avion.

Points que seuls ces essais réels confirmeront : l'exemple Docker Compose, le refus d'un
identifiant de message déjà connu (409) par votre version du serveur, la réception des accusés
signés, le choix de la SIM, et la tenue de l'application face à l'économie de batterie Samsung.
