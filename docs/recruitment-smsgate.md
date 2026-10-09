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

## 2. Installer le serveur SMSGate privé dans Coolify

Adresse proposée : **`sms.irongs.com`**. Suivre les étapes dans l'ordre, une à la fois.

Ce qui est installé : trois conteneurs, décrits dans
[`deploy/smsgate/docker-compose.yml`](../deploy/smsgate/docker-compose.yml).

| Service | Rôle | Image |
|---|---|---|
| `smsgate` | Le serveur, port interne 3000. Seul service relié au domaine. | `ghcr.io/android-sms-gateway/server:v1.49.0` |
| `smsgate-worker` | Ménage périodique (anciens messages, anciens jetons). | la même |
| `db` | Base MariaDB du serveur, données dans le volume `smsgate-db`. | `mariadb:12.3` |

### Étape 1 — Le nom de domaine

`sms.irongs.com` doit pointer vers l'adresse IP du VPS (la même que `drh.irongs.com`).
**Ce DNS reste à configurer** : chez le gestionnaire du domaine `irongs.com`, créer un
enregistrement `A` pour `sms` vers l'IP du VPS, puis vérifier depuis un ordinateur :

```bash
dig +short sms.irongs.com drh.irongs.com
```

Les deux lignes affichées doivent être identiques. Le 9 octobre 2026, c'était déjà le cas,
apparemment grâce à une règle générale (`*.irongs.com`) : créer quand même l'enregistrement
dédié, pour ne pas dépendre de cette règle. Ne pas passer à la suite tant que les deux lignes
diffèrent : Coolify ne peut obtenir le certificat HTTPS que si le nom pointe vers le serveur.

### Étape 2 — Générer les trois secrets

Sur le Mac, dans le Terminal :

```bash
openssl rand -hex 16   # SMSGATE_PRIVATE_TOKEN (32 caractères, à retaper sur le téléphone)
openssl rand -hex 32   # SMSGATE_DB_PASSWORD
openssl rand -hex 32   # SMSGATE_DB_ROOT_PASSWORD
```

Garder ces trois valeurs dans le gestionnaire de mots de passe de l'entreprise. Elles ne vont
ni dans Git, ni dans un e-mail, ni dans une capture d'écran. N'utiliser que des valeurs de ce
type (chiffres et lettres) : pas d'espace ni de caractère spécial.

### Étape 3 — Créer le service dans Coolify

1. Dans Coolify, ouvrir le projet, puis **+ New** (nouvelle ressource).
2. Choisir **Docker Compose Empty**.
3. Coller le contenu complet de `deploy/smsgate/docker-compose.yml`, puis **Save**.
4. Nommer la ressource `smsgate`. **Ne pas déployer tout de suite.**

Ne pas ajouter de section `ports:` : aucun port ne doit être ouvert sur le serveur, ni pour
SMSGate ni pour la base.

### Étape 4 — Saisir les secrets

Dans l'onglet **Environment Variables** de la ressource, Coolify affiche les trois variables
attendues. Coller les valeurs de l'étape 2 :

| Variable | Valeur |
|---|---|
| `SMSGATE_PRIVATE_TOKEN` | le jeton de 32 caractères |
| `SMSGATE_DB_PASSWORD` | le deuxième secret |
| `SMSGATE_DB_ROOT_PASSWORD` | le troisième secret |

Les trois sont obligatoires : le déploiement est refusé s'il en manque une.

### Étape 5 — Associer le domaine

Dans les réglages du service **`smsgate`** (pas `smsgate-worker`, pas `db`), champ **Domains** :

```
https://sms.irongs.com:3000
```

Le `:3000` indique seulement à Coolify le port interne du conteneur. L'adresse publique reste
`https://sms.irongs.com`, et Coolify se charge du certificat HTTPS. Ne donner aucun domaine aux
deux autres services.

### Étape 6 — Déployer et vérifier

1. Cliquer sur **Deploy**.
2. Attendre que les trois services soient à l'état **healthy** (une à deux minutes la première fois).
3. Ouvrir dans un navigateur : `https://sms.irongs.com/health`

La réponse attendue commence par `{"status":"pass","version":"1.49.0"` et le cadenas du
navigateur doit être valide. Si ce n'est pas le cas, voir la section 6 avant de continuer.

### Étape 7 — Sauvegarde et mises à jour

- Les données (téléphone enregistré, identifiants, messages) sont dans le volume `smsgate-db`.
  Il survit aux redéploiements. Le supprimer oblige à reconnecter le téléphone et à ressaisir
  de nouveaux identifiants dans ATLAS.
- Ajouter ce volume, ou un export de la base, aux sauvegardes du VPS.
- Les versions sont volontairement figées. Pour mettre à jour : lire les notes de version du
  dépôt `android-sms-gateway/server`, changer le numéro dans le fichier, redéployer, puis
  revérifier `/health`. Ne pas utiliser l'étiquette `latest`.
- La base, les journaux du service et l'accès à cette ressource Coolify sont à traiter comme
  des données confidentielles, au même titre que ceux d'ATLAS : accès réservé aux administrateurs.

### Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié le 9 octobre 2026, contre le code source du serveur v1.49.0 et par un démarrage réel
de ce fichier sur un poste de développement (Docker, hors production, sans téléphone ni SMS) :

- Le serveur se configure entièrement par variables d'environnement. Le fichier `config.yml`
  de la documentation officielle est facultatif : il n'est pas utilisé ici, ce qui évite de
  monter un fichier dans Coolify.
- Les trois conteneurs démarrent et passent à l'état `healthy` ; le schéma de la base est créé
  automatiquement au premier démarrage, sur MariaDB 12.3 (série LTS actuelle) comme sur 11.8.
- `/health` répond `pass`. Aucun port n'est publié par le fichier.
- L'enregistrement d'un téléphone est refusé sans le bon jeton privé et accepté avec lui ;
  il fournit alors le nom d'utilisateur et le mot de passe.
- L'API utilisée par ATLAS répond : liste des téléphones (commande `status` d'ATLAS), dépôt
  d'un message, refus `409` du même identifiant rejoué, enregistrement d'un webhook.
- Le téléphone enregistré et les messages sont toujours là après suppression puis recréation
  des conteneurs (volume conservé).
- Aucun des trois secrets n'apparaît dans les journaux des conteneurs.

Non vérifié, faute d'accès ou de matériel — à confirmer lors de l'installation :

- le déploiement dans Coolify lui-même (écrans, proxy, certificat HTTPS) : les étapes 3 à 6
  suivent la documentation de Coolify mais n'ont pas été exécutées ;
- le fonctionnement sur le processeur du VPS : l'essai a eu lieu sur un Mac (arm64) ; l'image
  est aussi publiée pour amd64 ;
- la sortie du VPS vers `api.sms-gate.app`, nécessaire pour réveiller le téléphone ;
- tout ce qui demande le Samsung S21 : connexion, envoi réel, accusés, choix de la SIM.

Ne pas modifier `GATEWAY__UPSTREAM_URL` : c'est l'adresse par laquelle le serveur privé fait
réveiller le téléphone.

## 3. Connecter le Samsung S21

À faire seulement quand `https://sms.irongs.com/health` répond (section 2, étape 6).
Une étape à la fois.

1. Installer la version officielle de l'application depuis les « Releases » du dépôt
   `capcom6/android-sms-gateway` : fichier `app-release.apk` (pas la variante « insecure »).
2. Accepter l'autorisation **SMS**, ainsi que **Téléphone** (nécessaire pour choisir la SIM).
3. Onglet **Settings → Cloud Server** :
   - **API URL** : `https://sms.irongs.com/api/mobile/v1` (le chemin est obligatoire) ;
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
| `RECRUITMENT_SMSGATE_API_URL` | `https://sms.irongs.com/api/3rdparty/v1` |
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
| `https://sms.irongs.com/health` ne répond pas | DNS pas encore actif (étape 1), domaine associé au mauvais service ou sans `:3000` (étape 5), ou service `smsgate` pas encore `healthy`. |
| Avertissement de certificat | Le certificat n'a pas encore été obtenu : vérifier le DNS, puis redéployer. Le téléphone refuse une adresse sans HTTPS valide. |
| Le service `smsgate` redémarre en boucle | Lire ses journaux dans Coolify. Cause habituelle : `SMSGATE_DB_PASSWORD` modifié après le premier démarrage, alors que la base garde l'ancien. |
| Le téléphone reste **Offline** | Adresse sans `/api/mobile/v1`, ou jeton privé différent de `SMSGATE_PRIVATE_TOKEN` (majuscules, caractère oublié). |
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

Le code est terminé et couvert par des tests automatiques, et la configuration du serveur a été
démarrée et contrôlée hors production (section 2). Mais **aucun envoi réel n'a encore été
effectué** : le serveur n'est pas installé sur le VPS et le Samsung S21 n'a pas été connecté.
`RECRUITMENT_SMS_ENABLED` reste à `false` en production tant que les étapes 1 à 4 ci-dessous
ne sont pas réussies. Dans l'ordre :

1. Installer le serveur SMSGate dans Coolify (section 2) et vérifier `/health`.
2. Connecter le Samsung S21 (section 3) et relever ses identifiants.
3. Saisir les variables `RECRUITMENT_SMSGATE_*` dans ATLAS (section 4), en laissant
   `RECRUITMENT_SMS_ENABLED=false`, appliquer `alembic upgrade head`, redémarrer.
4. Lancer `status`, `register-webhooks` puis `send-test` (section 5).
5. Passer `RECRUITMENT_SMS_ENABLED` à `true`, redémarrer, puis faire les essais du portail
   candidat (section 5), dont le mode avion.

Points que seuls ces essais réels confirmeront : le déploiement dans Coolify et son certificat,
le réveil du téléphone par `api.sms-gate.app`, la réception des accusés signés, le choix de la
SIM, et la tenue de l'application face à l'économie de batterie Samsung.

Des constats de sécurité ont été identifiés lors de cette vérification et sont suivis
séparément dans un rapport de sécurité privé.
