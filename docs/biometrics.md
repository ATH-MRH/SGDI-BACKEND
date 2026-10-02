# Biométrie faciale et caméras — ATLAS Attendance V1

État : **implémentée, désactivée par défaut**. Aucune activation n'a lieu sans décision explicite
(voir « Activation »). Code : `app/modules/biometrics/` ; tests : `tests/test_biometrics*.py`.

## 1. Principes

- **Une seule présence** : un pointage facial accepté passe par Attendance Core
  (`record_scan`, source `FACIAL`, terminal = caméra) comme toute autre source. La biométrie
  ne possède ni présence propre ni lien direct avec la paie.
- **Aucun pointage sauf si tout est vérifié** : visage exploitable, un seul sujet, qualité,
  présence réelle (liveness), score au-dessus du seuil, résultat non ambigu, employé actif,
  gabarit actif, consentement admissible, bon site (le 1:N ne porte que sur les employés
  affectés au site de la caméra), caméra autorisée au pointage, règle Attendance valide,
  idempotence. Sinon : **aucun pointage**, message clair, anomalie tracée si pertinent.
- **Jamais de rattachement au « meilleur candidat »** sous le seuil : `UNKNOWN_FACE`,
  `REVIEW_REQUIRED` (score dans la bande de revue), `AMBIGUOUS` (deux candidats proches).
- **Jamais de création automatique d'employé**, jamais de double identité : un visage proche
  d'un autre employé met l'enrôlement en `PENDING_REVIEW` (anomalie
  `POSSIBLE_DUPLICATE_FACE`, décision humaine obligatoire).
- **Photo ≠ gabarit** : la photo reste celle de la fiche employé (lue, jamais copiée). Le
  gabarit (vecteur 128 dimensions) est chiffré (Fernet, clé dédiée), jamais renvoyé par l'API,
  jamais journalisé, jamais dans `Employee.extra`.
- **Fallback** : QR, saisie opérateur, correction avec motif — chacun tracé avec sa source.
  Aucune garantie anti-fraude absolue n'est revendiquée.

## 2. Moteur et modèles (usage commercial compatible)

| Rôle | Fichier | Licence | Provenance | SHA-256 |
|---|---|---|---|---|
| Détection | `face_detection_yunet_2023mar.onnx` | MIT | OpenCV Zoo `models/face_detection_yunet` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| Gabarit | `face_recognition_sface_2021dec.onnx` | Apache-2.0 | OpenCV Zoo `models/face_recognition_sface` | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |
| Liveness | `2.7_80x80_MiniFASNetV2.onnx` | Apache-2.0 | Minivision *Silent-Face-Anti-Spoofing*, export ONNX `QingHeYang/Silent-Face-Anti-Spoofing-onnx` | `0cbe5caec95c31de9d2ef845cb85407d76aecd1b6a2c0e343f7d35306bfbccb8` |

Les modèles InsightFace pré-entraînés ont été **écartés** (licence recherche non commerciale).
Chaque fichier est vérifié par SHA-256 au chargement : un fichier différent est refusé
(`EngineUnavailable`). Dépendances optionnelles : `requirements-biometric.txt`
(opencv-python-headless, numpy). Le calcul se fait **côté serveur** : un terminal ne peut pas
fabriquer un gabarit.

Prétraitement liveness conforme au projet d'origine : recadrage ×2,7 centré sur le visage,
80×80, BGR, valeurs brutes, softmax ; classe 1 = visage réel.

## 3. Seuils (configuration versionnée, jamais écrasée)

Version 1 (`app/modules/biometrics/service.py::DEFAULT_CONFIG`) :

| Paramètre | Valeur v1 | Provenance |
|---|---|---|
| `recognition_threshold` | 0,363 | Seuil cosinus de l'exemple officiel OpenCV pour SFace. Mesure locale : même personne 0,81 ; personnes différentes 0,14–0,26. |
| `review_margin` | 0,07 | Bande prudente [0,363 ; 0,433) → nouvel essai / revue ; sert aussi d'écart minimal entre deux candidats (sinon `AMBIGUOUS`). |
| `duplicate_threshold` | 0,363 | Même base que la reconnaissance. |
| `liveness_threshold` | 0,80 | Probabilité « réel » MiniFASNetV2 (le projet d'origine utilise l'argmax). |
| `quality_min_detection_score` | 0,90 | Valeur de l'exemple OpenCV YuNet. |
| `quality_min_face_px` | 80 | Taille minimale du visage (entrée SFace alignée 112 px). |
| `quality_min_sharpness` | 60 | Variance du laplacien sur 112 px. Mesure locale : net 845–1418, flou 5–7. |
| `cooldown_seconds` | 60 | Non-répétition par caméra (l'anti-rebond d'Attendance Core, 300 s, reste actif). |

**Ces valeurs sont un point de départ documenté, pas une calibration.** Toute modification crée
une nouvelle version avec une provenance obligatoire (`POST /api/biometrics/config`), et chaque
gabarit/pointage référence la version utilisée.

## 4. Consentement et information

- États : `contract_confirmed`, `explicit_confirmed` (admissibles), `pending`, `refused`,
  `withdrawn`. Sources : `EMPLOYMENT_CONTRACT`, `HR_DOCUMENT`, `DIGITAL_ENROLLMENT`,
  `OTHER_AUTHORIZED_PROCESS`. Historique append-only (`biometric_consents`) : source, date,
  référence du document (obligatoire pour un état admissible), version du texte, auteur.
- Texte d'information versionné (`NOTICE_VERSION = 2026-09-v1`, `GET /api/biometrics/notice`).
  Un accord ne vaut que pour la version en vigueur ; changer le texte impose une revalidation.
  Aucune durée légale de conservation n'est inventée : le texte renvoie à la politique d'IRON Global.
- Refus, retrait ou retour à `pending` ⇒ désactivation immédiate des gabarits.
- L'autorisation ANPDP est déclarée acquise par l'organisation ; elle n'est pas vérifiée par le logiciel.

## 5. Cycle de vie des gabarits

`ACTIVE` · `PENDING_REVIEW` (doublon possible) · `INACTIVE` (désactivé, remplacé, consentement
retiré, photo de la fiche remplacée) · `REJECTED` (revue négative). Un nouvel enrôlement
désactive l'ancien gabarit. Une photo de fiche modifiée invalide le gabarit qui en était issu
(empreinte SHA-256 de la photo). Un employé non actif (sortant, suspendu, mise à pied) n'est
jamais pointé.

## 6. Permissions (explicites, jamais implicites)

Permissions fines `attendance × fonctionnalité × action` (écran Administration → Permissions),
ou administrateur global :

| Fonctionnalité | Actions | Couvre |
|---|---|---|
| `biometric_status` | read | Voir consentement et état d'enrôlement |
| `biometric_enrollment` | create, update | Consentement, enrôlement, ré-enrôlement, désactivation |
| `biometric_admin` | validate, admin | Revue des doublons, seuils, caméras |

La reconnaissance au terminal suit la règle du scan QR (module pointeur/pointage + site de la
caméra dans le périmètre du compte). Un employé ou une caméra hors périmètre répond 404.
La migration `20260927_0002` étend les contraintes CHECK de `user_feature_permissions` aux
trois fonctionnalités (sans cela, PostgreSQL les refuserait).

## 7. Caméras (Dahua 5 MP et suivantes)

- Abstraction `CameraAdapter` : `DahuaCameraAdapter` (instantané `/cgi-bin/snapshot.cgi`,
  authentification Digest ; flux RTSP `/cam/realmonitor?channel=N&subtype=0|1`),
  `GenericRtspCameraAdapter` (chemin par profil), `TerminalCameraAdapter` (caméra de la
  tablette). Attendance Core ne connaît aucun fabricant.
- **Pointage : images TOUJOURS lues par le serveur** sur une caméra Dahua/RTSP. Une image fournie
  par un navigateur pourrait être une photo injectée — le liveness passif accepte une photo
  pleine résolution (mesuré 0,84–0,92) —, elle n'est donc jamais utilisée pour pointer. La caméra
  « terminal » est limitée à l'**enrôlement supervisé** (usage `ENROLLMENT` uniquement, permission
  explicite, audit). Risque résiduel : un opérateur habilité pourrait enrôler un visage substitué ;
  limité par la détection de doublons, le consentement référencé et l'audit.
- **Catalogue administrable** (`camera_models`) : aucun modèle Dahua n'est codé ; l'administrateur
  ajoute la référence exacte (fabricant, modèle, adaptateur, résolution, capacités).
- Une caméra appartient à une **société ET un site** ; rôle (entrée, sortie, enrôlement,
  secondaire), caméra par défaut par rôle, usage (pointage, enrôlement, les deux).
- **Secrets** chiffrés en base, jamais dans une réponse, un journal, une URL ou l'audit
  (`credentials_set: true` seulement). Aperçu relayé par le backend
  (`GET /cameras/{id}/preview.jpg`, profil basse résolution) : le navigateur ne voit jamais la caméra.
- **Test** (`POST /cameras/{id}/test`) : connexion (latence), instantané (résolution détectée,
  latence), flux RTSP (poignée de main OPTIONS, sans identifiant), date de vérification.
- **Profils** : `CAPTURE_HIGH_QUALITY` (enrôlement, pleine résolution), `RECOGNITION_REALTIME`
  (réduit côté serveur à 1280 px), `PREVIEW_LOW_BANDWIDTH` (640 px). Le choix définitif du
  profil de reconnaissance doit être confirmé par un benchmark avec la caméra réelle.

### Chemin réseau

La caméra reste sur le **LAN du site**, jamais exposée sur Internet. ATLAS l'atteint soit
directement (serveur sur le même réseau), soit via une **passerelle de site** (VPN site-à-site ou
tunnel sortant) dont l'adresse est saisie dans `host`. En cas de perte réseau, l'adaptateur
échoue proprement (message sans secret), le terminal affiche l'erreur et le pointage de secours
reste disponible. **Ce chemin n'est pas encore en place** : il dépend de l'infrastructure du site.

## 8. Ce qui a été vérifié ici — et ce qui ne peut l'être que sur site

Vérifié (tests automatiques) :
- moteur réel sur portraits du domaine public : même personne 0,81 ; autres 0,14–0,26 ;
  flou et image figée rejetés ; modèle altéré refusé ;
- adaptateur Dahua contre un serveur HTTP Digest réel (5 MP, aperçu 640 px, mot de passe
  faux refusé, aucun secret divulgué) ;
- tous les refus métier (inconnu, plusieurs visages, liveness, qualité, ambigu, autre site,
  consentement retiré, employé suspendu, caméra d'enrôlement), non-répétition, idempotence,
  doublon bloqué, permissions, périmètre, secrets.

**Mesure importante** : une simulation numérique d'écran/photo n'est PAS probante — un même
portrait cadré comme sur un écran a été accepté (1,0) pour une photo et refusé (0,04) pour une
autre. Le liveness passif seul n'est pas une garantie ; la résistance aux présentations physiques
se mesure sur la vraie caméra (`docs/attendance-hardware-checklist.md`, critère : zéro acceptation).

**Non vérifiable sans matériel** — protocole à exécuter avec la caméra Dahua avant activation
(détaillé dans `docs/attendance-hardware-checklist.md`) :
1. 50 passages réels (5 employés × 10, lumière jour/nuit) : taux d'acceptation, scores.
2. Attaques : photo imprimée (A4, papier photo), photo sur smartphone, photo sur tablette,
   vidéo sur écran, masque papier ; 20 essais chacun. Attendu : aucun pointage accepté.
3. Deux personnes dans le champ, personne de dos, casque/casquette, lunettes.
4. Latence de bout en bout (rafale + analyse) par profil ; choix du profil de reconnaissance.
5. Ajuster les seuils en créant une nouvelle version avec la provenance « calibration site X ».

## 9. Activation (checklist)

**Prérequis bloquants** (aucune activation sans eux) : migration des photos exécutée (§10) ;
checklist terrain `docs/attendance-hardware-checklist.md` signée GO (liveness **À VALIDER SUR
VRAIE CAMÉRA DAHUA**) ; décision sur le mode kiosque (§11).

1. Dépendances : `requirements-biometric.txt` (versions figées) est installé par le
   `Dockerfile`.
2. Modèles : téléchargés au build par `scripts/fetch_biometric_models.py` depuis des commits
   figés de leurs dépôts d'origine, SHA-256 vérifiés (build en échec sinon), copiés dans
   `/app/models/biometrics` (= `BIOMETRIC_MODELS_DIR` par défaut) ; le build charge ensuite le
   moteur pour le vérifier. Aucun binaire dans Git. (Nixpacks : dépendances seulement.)
3. Générer une clé : `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`,
   la placer dans `BIOMETRIC_TEMPLATE_KEY` (coffre de secrets, jamais dans Git).
4. `BIOMETRIC_ENABLED=true`.
5. Déclarer le catalogue caméra, les caméras, tester chacune.
6. Accorder les permissions biométriques explicites aux seules personnes habilitées.
7. Dérouler le protocole du §8, calibrer, puis enrôler.

**Rotation de clé** : un gabarit chiffré avec une ancienne clé devient illisible ; le système le
signale explicitement (erreur, jamais d'ignorance silencieuse qui laisserait passer un doublon).
Procédure : désactiver les gabarits, changer la clé, ré-enrôler.

## 10. Migration des photos à nom prévisible — procédure de production

Les photos de fiche sont la source de l'enrôlement ; un nom prévisible
(`/uploads/photos/<MATRICULE>.jpg`) permet de les récupérer anonymement. Le script
`scripts/rename_public_photos.py` (non exécuté à ce jour) les renomme en URL-capacités.

| Étape | Action | Contrôle |
|---|---|---|
| 1 | Fenêtre de maintenance ; arrêter les écritures DRH (upload photo) | — |
| 2 | Sauvegarde **base** (pg_dump) **et** dossier `uploads/photos` (archive) | restauration testée sur une copie |
| 3 | `python scripts/rename_public_photos.py` (simulation, aucune écriture) | `photos`, `references_rows`, `missing_files` relus ; les noms affichés sont indicatifs (régénérés à l'application) |
| 4 | `python scripts/rename_public_photos.py --apply` depuis un répertoire **hors** `uploads` | le journal `photo_migration_journal_<horodatage>.json` est écrit **avant** tout renommage |
| 5 | Vérifier quelques fiches (photo affichée), relancer la simulation : `photos` = 0 | idempotence |
| 6 | `PHOTOS_REQUIRE_UNGUESSABLE_NAMES=true`, redéploiement | ancien nom → 404 |
| 7 | Conserver le journal hors serveur web (il contient les URL-capacités) | — |

Garanties du code : simulation par défaut ; `--apply` refusé sans journal ou avec un journal
dans `uploads` (servi publiquement) ; aucun fichier existant écrasé (collision ⇒ nouveau nom) ;
en cas d'erreur (base indisponible…), les fichiers déjà renommés reprennent leur nom et rien
n'est écrit en base. Références manquantes : listées dans `missing_files`, jamais inventées.

**Retour arrière** après succès : restaurer la sauvegarde base + archive `photos` (étape 2), ou
renommer chaque `nouveau → ancien` du journal puis restaurer la base ; remettre
`PHOTOS_REQUIRE_UNGUESSABLE_NAMES=false`.

## 11. Identité de borne (« KIOSK DEVICE IDENTITY ») — livrée, voir § 14

Le cahier des charges initial (terminal enregistré, rattachement société + site, credential
propre à l'équipement, permissions minimales, rotation, révocation immédiate, audit par
équipement) est implémenté par les **terminaux faciaux autorisés** (§ 14). Une borne ne dépend
plus d'une session humaine : la déconnexion après 30 s d'inactivité des utilisateurs du pointeur
est inchangée et ne concerne pas la borne.

## 12. BIOMETRIC TEST MODE — FRONTEND CONTRACT

**Mode Test ≠ pointage de production.** Le Mode Test permet d'essayer capture, détection,
qualité, liveness et reconnaissance avec la caméra d'un **navigateur** (Mac, PC, tablette,
smartphone) avant les essais sur caméra Dahua. Il **n'enregistre jamais de pointage** : aucune
présence (`DailyPresence`), aucun `attendance_events`, aucune anomalie, aucun gabarit
modifié, aucune configuration créée, aucun impact planning/paie.

| | Pointage de production | Mode Test |
|---|---|---|
| Route | `POST /api/biometrics/cameras/{id}/recognize` | `POST /api/biometrics/test-mode/recognize` |
| Source d'image | caméra lue **par le serveur** ; toute image du client est ignorée | image envoyée **par le navigateur** |
| Activation | `BIOMETRIC_ENABLED` | `BIOMETRIC_TEST_MODE_ENABLED` (indépendant) |
| Écriture | Attendance Core (`record_scan`, source FACIAL) | **aucune** (hors trace d'audit) |
| Code | `service.recognize_and_record` | `test_mode.recognize` (module en lecture seule) |

### 12.1 Activation (feature flag)

- `BIOMETRIC_TEST_MODE_ENABLED=false` par défaut. Indépendant de `BIOMETRIC_ENABLED` : le
  Mode Test fonctionne avec le pointage facial **désactivé**, et activer la production ne
  l'active pas.
- Prérequis moteur identiques : `requirements-biometric.txt`, modèles dans
  `BIOMETRIC_MODELS_DIR` (empreintes du §2), `BIOMETRIC_TEMPLATE_KEY` (lecture des gabarits).
- `BIOMETRIC_TEST_MODE_MAX_PER_MINUTE` (défaut **30**) : limite par compte.
- **Limite actuelle** : l'enrôlement (`POST /employees/{id}/enroll`) exige
  `BIOMETRIC_ENABLED=true`. Tant que le pointage facial reste désactivé, aucun gabarit ne peut
  être créé : le Mode Test évalue détection, qualité et liveness, et répond `UNKNOWN_FACE` pour
  tout visage bien capté — jamais `RECOGNIZED`. Tester la reconnaissance suppose une décision
  séparée (enrôlement de test sans activer le pointage facial).

### 12.2 État — `GET /api/biometrics/test-mode/status`

Authentification ATLAS requise (Bearer). Aucune permission biométrique requise pour lire
l'état ; le champ `permitted` indique si le compte peut lancer un test.

```json
{
  "test_mode_enabled": true, "production_enabled": false, "records_attendance": false,
  "engine_available": true, "engine": "opencv-yunet2023mar-sface2021dec-minifasnetv2",
  "key_configured": true, "permitted": true,
  "max_frames": 6, "max_frame_bytes": 3000000, "max_side_px": 4096,
  "formats": ["jpeg", "png", "webp"], "max_per_minute": 30,
  "states": ["RECOGNIZED", "UNKNOWN_FACE", "AMBIGUOUS", "REVIEW_REQUIRED", "REFUSED",
             "NO_FACE", "MULTIPLE_FACES", "QUALITY_FAILED", "LIVENESS_FAILED"],
  "refusal_reasons": ["CONSENT_REQUIRED", "EMPLOYEE_INACTIVE"],
  "error_codes": ["TEST_MODE_DISABLED", "ENGINE_UNAVAILABLE", "INVALID_IMAGE", "IMAGE_TOO_LARGE", "RATE_LIMITED"]
}
```

`engine_available` n'est évalué que si le Mode Test est activé.

### 12.3 Reconnaissance — `POST /api/biometrics/test-mode/recognize`

- **Auth** : utilisateur ATLAS authentifié (`Authorization: Bearer <token>`), non public.
- **Module** : comme toute route `/api/biometrics`, un des modules `pointage`, `pointeur`,
  `ops`, `drh` (sinon 403).
- **Permission explicite** : `attendance × biometric_admin × validate` **ou** `admin`
  (écran Administration → Permissions), ou administrateur global. `biometric_status` et
  `biometric_enrollment` ne suffisent pas. Refus audité (`authorization.biometric`).
- **Content-Type** : `application/json`. Corps total ≤ 24 Mo environ (6 images) ; au-delà : 413.
- **Payload** :

```json
{ "site_id": 12, "frames": ["data:image/jpeg;base64,/9j/4AAQ…"] }
```

| Champ | Règle |
|---|---|
| `site_id` | obligatoire ; site dans le périmètre du compte (société/sites autorisés), sinon **404** |
| `frames` | 1 à **6** images ; base64 brut ou data URL `data:image/jpeg|png|webp;base64,…` |
| format | **JPEG, PNG ou WebP**, reconnu par la signature du fichier (le type déclaré doit correspondre) |
| taille | **3 Mo** maximum par image décodée ; **4096 px** maximum de côté, 12,6 Mpx maximum |

Recommandation frontend : capturer le flux `getUserMedia`, dessiner la trame sur un
`<canvas>` réduit à **1280 px** maximum, exporter en `image/jpeg` qualité 0,85–0,9
(≈ 100–300 ko). Envoyer **2 à 3 trames espacées de 200–300 ms** : cela permet la détection
d'image figée et la médiane du liveness. Aucun bouton « Capturer » n'est nécessaire : le
serveur choisit la meilleure trame.

- **Rate limit** : `BIOMETRIC_TEST_MODE_MAX_PER_MINUTE` requêtes par compte et par minute
  glissante (défaut 30, soit un essai toutes les 2 s en continu) ; au-delà **429
  `RATE_LIMITED`**. Compteur en mémoire, par worker (voir `app/core/rate_limit.py`).
  Le frontend ne doit pas analyser en boucle serrée : un essai à la fois, pas plus d'un
  toutes les 2 s. La réponse 429 ne porte pas d'en-tête `Retry-After` : l'interface
  (`app/static/pointage/test-mode.js`) suspend alors l'analyse 60 s. Cadence de l'interface
  livrée : 3 trames espacées de 250 ms, un essai au plus toutes les 2,5 s (≤ 24/min).

#### Réponse 200 (toujours `recorded: false`)

```json
{
  "mode": "TEST", "recorded": false,
  "state": "RECOGNIZED", "reason_code": null,
  "message": "Employé reconnu (test — aucun pointage)", "reasons": [],
  "employee": { "employee_id": 42, "matricule": "A0042", "nom": "BENALI", "prenom": "Karim",
                "fonction": "Magasinier", "site": "ENTREPOT PRINCIPAL" },
  "match": { "candidates": 14, "confidence": 0.8276, "threshold": 0.363, "review_margin": 0.07 },
  "liveness": { "result": "PASS", "score": 0.872, "threshold": 0.8 },
  "quality": { "detection_score": 0.93, "face_px": 312, "sharpness": 845.2, "brightness": 121.4, "liveness_real": 0.872 },
  "site_id": 12, "config_version": 1, "engine": "opencv-…", "frames": 3,
  "timings_ms": { "upload": 0.2, "validation": 0.2, "analysis": 23.4, "decode": 1.9, "detection": 15.2,
                  "quality": 0.2, "embedding": 4.9, "liveness": 1.2, "matching": 1.8, "total": 26.9 },
  "disclaimer": "Mode Test : aucun pointage n'est enregistré. …"
}
```

Jamais renvoyé : gabarit, vecteur (embedding), image, secret caméra. `employee` n'est
présent que pour `RECOGNIZED` et pour `REFUSED/EMPLOYEE_INACTIVE` ; `match` vaut `null`
tant que le visage n'a pas atteint l'étape de comparaison. La photo de l'employé n'est pas
renvoyée : l'interface peut l'afficher via la route photo DRH existante **si** le compte y a
accès.

#### Codes métier (`state`) — vocabulaire du pointage facial existant

| `state` | Signification | Affichage conseillé |
|---|---|---|
| `RECOGNIZED` | Un seul employé, au-dessus du seuil + marge, consentement admissible, employé actif | identité + « Test uniquement — aucun pointage » |
| `UNKNOWN_FACE` | Aucun candidat au-dessus du seuil (jamais de « meilleur candidat ») | « Visage inconnu » |
| `REVIEW_REQUIRED` | Score dans la bande [seuil ; seuil + marge) : incertain, aucune identité | « Reconnaissance incertaine — réessayez » |
| `AMBIGUOUS` | Deux candidats trop proches, aucune identité | « Ambigu » ; `match.second_confidence` fourni |
| `REFUSED` + `reason_code: CONSENT_REQUIRED` | Visage reconnu mais consentement non admissible ; identité non révélée | « Consentement requis » |
| `REFUSED` + `reason_code: EMPLOYEE_INACTIVE` | Employé suspendu, sortant, inactif… | identité + motif |
| `NO_FACE` | Aucun visage exploitable | « Aucun visage détecté » |
| `MULTIPLE_FACES` | Plusieurs visages : aucune attribution au plus grand | « Une seule personne devant la caméra » |
| `QUALITY_FAILED` | Visage trop petit, flou ou mal détecté (`reasons` détaille) | conseil de cadrage |
| `LIVENESS_FAILED` | Présence réelle non confirmée | voir `liveness.result` |

`liveness.result` : `PASS`, `FAIL` (score sous le seuil ou image figée), `INCONCLUSIVE`
(contrôle impossible), `NOT_EVALUATED` (arrêt avant l'étape liveness).

Les correspondances avec les noms indicatifs de la demande : `UNKNOWN` = `UNKNOWN_FACE`,
`LOW_QUALITY` = `QUALITY_FAILED`, `CONSENT_REQUIRED` / `EMPLOYEE_INACTIVE` = `reason_code`
de `REFUSED`, `TEST_MODE_DISABLED` / `ENGINE_DISABLED` = erreurs 503 ci-dessous.

#### Erreurs HTTP

| HTTP | `detail.code` | Cas |
|---|---|---|
| 401 | — | non authentifié |
| 403 | — | module absent, ou permission `biometric_admin` absente |
| 404 | — | site inexistant ou hors périmètre (société / sites du compte) |
| 413 | `IMAGE_TOO_LARGE` | corps, image (> 3 Mo) ou dimensions (> 4096 px) excessifs |
| 422 | `INVALID_IMAGE` | pas une image JPEG/PNG/WebP, base64 invalide, image vide, type déclaré menteur, fichier illisible, 0 ou > 6 images |
| 422 | — | `site_id` absent ou invalide |
| 429 | `RATE_LIMITED` | limite par minute atteinte |
| 503 | `TEST_MODE_DISABLED` | `BIOMETRIC_TEST_MODE_ENABLED=false` |
| 503 | `ENGINE_UNAVAILABLE` | modèles, dépendances ou clé de gabarits absents |

Pour 413/422/429/503, `detail` est un objet `{ "code": "…", "message": "…" }`.

### 12.4 Garanties

- **Zéro pointage** : le module `app/modules/biometrics/test_mode.py` n'importe aucune
  fonction d'écriture (garde structurelle testée sur le code source). Toute fonction
  d'écriture remplacée par une exception n'est jamais atteinte (garde d'exécution testée).
  La route annule la transaction (`rollback`) avant d'écrire la seule trace d'audit. Un test
  compte **toutes les tables** avant et après 100 reconnaissances de test (reconnu, refusé,
  inconnu, liveness, plusieurs visages, aucun visage) : aucune ligne ajoutée.
- **Lecture seule** : un gabarit issu d'une photo depuis remplacée est **ignoré**, pas
  désactivé ; la configuration v1 n'est pas créée si elle n'existe pas (valeurs par défaut
  en mémoire) ; un consentement non admissible ne désactive rien.
- **Périmètre** : 1:N limité aux gabarits ACTIFS des employés affectés au site demandé ; un
  site hors périmètre répond 404 ; un visage d'un autre site ou d'une autre société n'est
  jamais candidat.
- **Images** : traitées en mémoire, jamais écrites (ni uploads, ni documents, ni journaux).
- **Audit** (`biometrics.test_mode.recognize`) : utilisateur, date, société, site, nombre
  d'images, résultat, `reason_code`, résultat liveness, confiance, employé reconnu, durée,
  version de configuration. Jamais d'image, de gabarit ni de vecteur.
- **Protection du pointage réel inchangée** : `/cameras/{id}/recognize` ignore toute image
  fournie par le client (test permanent), refuse une caméra `TERMINAL` et reste fermé tant
  que `BIOMETRIC_ENABLED=false`, même Mode Test activé.

### 12.5 Limites — ce que le Mode Test ne prouve pas

Une caméra de navigateur n'est pas la caméra de site : optique, exposition, compression et
angle diffèrent. **Le liveness n'est pas validé par le Mode Test** : mesuré ici, le moteur
réel a accepté des portraits photographiques (0,87 et 0,999). Le Mode Test sert à préparer
les essais (§8 : photo imprimée, photo sur smartphone/tablette, vidéo, plusieurs personnes)
et à en relever les résultats et durées — il ne remplace pas la checklist terrain
`docs/attendance-hardware-checklist.md` sur caméra Dahua.

Le résultat du liveness sur une photo dépend fortement de la chaîne de capture : le même
portrait envoyé directement a été accepté (0,87), mais refusé le plus souvent une fois diffusé
par la caméra virtuelle de Chrome puis ré-encodé par le navigateur (0,11–0,63 ; une fois
0,81). Aucune de ces mesures ne constitue une certification anti-spoof.

Mesure locale (moteur réel, MacBook, JPEG 1280 px, 1 trame) : analyse ≈ 23 ms (décodage 2,
détection 15, gabarit 5, liveness 1), comparaison 1:N ≈ 2 ms, total ≈ 25–27 ms côté serveur,
hors réseau. Parcours navigateur réel (3 trames 1280×960) : ≈ 95–110 ms côté serveur pour
l'ensemble de la rafale. Seuils inchangés.

### 12.6 Tests

- Backend : `tests/test_biometrics_test_mode.py` (moteur simulé ; plus un test sur le vrai
  moteur si `BIOMETRIC_MODELS_DIR` / `BIOMETRIC_TEST_FACES` sont fournis).
- Interface (jsdom + Chrome, API simulée) : `npm run test:biometric-test-mode`.
- E2E hostile de bout en bout (vrai serveur, vrai moteur, caméra virtuelle Chrome) :
  `ATLAS_E2E_PYTHON=… BIOMETRIC_MODELS_DIR=… BIOMETRIC_TEST_FACES=… npm run test:biometric-test-mode-real-e2e`.
  Il couvre : décision réelle sans pointage, écrans 1440/1024/768/390, navigation pendant la
  capture, caméra interrompue, arrêt pendant `getUserMedia`, injection sur la route de
  production, `recorded` forgé, hors périmètre, image trop grande ou invalide, rafale (429),
  et le comptage de toutes les tables, fichiers, journaux et audit. Les appareils physiques
  (iPhone, Android, tablettes) restent à tester manuellement.

## 13. Pointage facial réel — pilote contrôlé

### 13.1 Trois interrupteurs indépendants (défaut : tout fermé)

| Réglage | Portée | Effet |
|---|---|---|
| `BIOMETRIC_ENROLLMENT_ENABLED` (env) | global | autorise l'**enrôlement supervisé** sans ouvrir le pointage facial |
| `BIOMETRIC_ENABLED` (env) | global | ouvre le circuit de pointage facial (et l'enrôlement) |
| `cameras.facial_attendance_enabled` (base, défaut **faux**) | **par caméra** | une caméra ne pointe QUE si elle est explicitement activée (Gestion du pointage → Caméras) |
| `biometric_terminals.facial_attendance_enabled` (base, défaut **faux**) | **par terminal** | une tablette/un smartphone associé ne pointe QUE s'il est explicitement activé (Gestion du pointage → Terminaux) ; le QR de la borne n'en dépend pas |

`BIOMETRIC_ENABLED=true` seul ne fait donc pointer **aucune** caméra : chaque caméra du pilote est
activée à la main, audité (`biometrics.camera.update`). Seule une caméra **lue par le serveur**
et d'usage pointage peut être activée (jamais une caméra « terminal » ni d'enrôlement seul).

**Coupures (kill switch)** — toutes sans effet sur le QR ni la saisie manuelle :
- **caméra** : décocher « Pointage facial RÉEL actif » (ou désactiver la caméra) — effet immédiat ;
- **terminal** : « Couper le facial » / « Désactiver » / « Révoquer » (Gestion du pointage → Terminaux) — effet
  sur la requête suivante (défis en cours invalidés) ;
- **site** : « Couper le pointage facial du site » → `POST /api/biometrics/sites/{site_id}/facial-disable`
  (toutes les caméras **et tous les terminaux** du site, audité `biometrics.site.facial_disable`) — effet immédiat ;
- **global** : retirer `BIOMETRIC_ENABLED` (redémarrage de l'application).

### 13.2 Enrôlement supervisé (deux étapes, confirmation humaine)

`POST /api/biometrics/employees/{id}/enroll` (ancien enrôlement en un clic) répond **410** : un
gabarit n'est plus jamais activé sans comparaison ni confirmation.

1. **Recherche** : `GET /api/biometrics/employees?q=<matricule|nom|prénom>&site_id=` — permission
   `biometric_status × read`, limitée aux sites/société du compte (hors périmètre ⇒ 404).
2. **Aperçu** : `POST /api/biometrics/employees/{id}/enrollment/preview`, permission
   `biometric_enrollment × create`, corps `{}` (source = photo DRH) ou `{ "camera_id": … }`
   (capture ; `frames` seulement pour une caméra « terminal » d'enrôlement). **Aucune écriture de
   gabarit.** Contrôles : consentement admissible (`409 CONSENT_REQUIRED`), employé actif
   (`409 EMPLOYEE_INACTIVE`), photo DRH analysée (visage unique, qualité) :
   - source photo : photo inexploitable ⇒ `422 PHOTO_UNUSABLE` (capture supervisée nécessaire) ;
   - source caméra : capture analysée **avec liveness** ; comparaison **1:1 capture ↔ photo DRH** :
     `MATCH` (score ≥ seuil + marge), `REVIEW_REQUIRED` (bande [seuil ; seuil + marge)),
     `NO_MATCH` (< seuil), `NO_REFERENCE` (pas de photo DRH exploitable). Score cosinus **brut**,
     jamais converti en pourcentage.
   - recherche de doublon sur tous les gabarits actifs/en revue des autres employés.
   Réponse : états photo/capture, vignette de la capture (affichage seulement, jamais stockée),
   comparaison, doublon, `can_confirm`, `requires_justification`, `token` (chiffré avec la clé des
   gabarits, **lié à l'employé et à l'opérateur**, valable 5 min) — `NO_MATCH` ⇒ aucun jeton.
3. **Confirmation** : `POST /api/biometrics/employees/{id}/enrollment/confirm`
   `{ token, confirm: true, justification }` par **le même opérateur**. Tout est recontrôlé
   (consentement, statut, photo inchangée ⇒ sinon `409 PHOTO_CHANGED`) ; `NO_MATCH` refusé ;
   `REVIEW_REQUIRED` / `NO_REFERENCE` ⇒ justification écrite obligatoire (≥ 10 caractères).
   Doublon suspecté ⇒ gabarit `PENDING_REVIEW` (revue humaine), sinon `ACTIVE` et l'ancien gabarit
   passe `INACTIVE`. Le gabarit porte : employé, société, site, moteur, version de configuration,
   consentement, résultat et score de la comparaison — jamais d'image.

Ré-enrôlement : nouvel aperçu + confirmation (l'ancien gabarit est désactivé). Photo DRH changée
⇒ gabarit issu de l'ancienne photo invalidé (§5). Retrait du consentement ⇒ désactivation immédiate.
Écran : Gestion du pointage → **Enrôlement** (recherche) → fiche biométrique → « Analyser la photo DRH » ou
« Capturer et comparer à la photo DRH » → vérification côte à côte → « Confirmer l'enrôlement ».
DRH Next affiche l'état et renvoie vers ce parcours.

### 13.3 Reconnaissance, entrée/sortie, anti-doublon

`POST /api/biometrics/cameras/{camera_id}/recognize` : caméra dans le périmètre (sinon 404), lue
par le serveur (terminal ⇒ 409), active, d'usage pointage, **activée pour le pilote** (sinon 409),
`BIOMETRIC_ENABLED` + clé + moteur (sinon 503). Toute image envoyée par le client est ignorée. 1:N
limité aux employés affectés au site de la caméra. Refus sans pointage : inconnu, plusieurs
visages, qualité, liveness, ambigu, incertain, consentement, employé inactif.

**Entrée / sortie** : décidée par `attendance_core.record_scan`, la même règle que le QR, jamais par
la biométrie — sous verrou par employé : idempotence (`cam{id}-{burst_id}`), anti-rebond
`ATTENDANCE_MIN_EVENT_GAP_SECONDS` (300 s), **SORTIE** si la dernière arrivée est encore ouverte
(≤ 16 h, 30 h sur un site en rotation 24 h), sinon **ENTRÉE** ; nouvelle arrivée refusée moins de
8 h après la précédente. Anti-doublon facial supplémentaire : fenêtre de non-répétition par caméra
(`cooldown_seconds`, 60 s) ⇒ `ALREADY_RECORDED`.

**Audit** (`biometrics.recognize`, une ligne par tentative) : caméra, site, matricule reconnu,
état, confiance, liveness, version de configuration, pointage créé ou non, motif — aucune image,
aucun gabarit. Aperçus et confirmations d'enrôlement : `biometrics.enrollment.preview`,
`biometrics.enroll` (opérateur, comparaison, justification).

**HENEX HC-666** : lecteur QR uniquement (douchette), jamais caméra faciale. QR et facial coexistent.

### 13.4 Procédure du pilote — DHL FORWARDING / HAMOUL 01 (40K)

Terminal principal : **une tablette Samsung** (§ 14). La caméra Dahua est une source
supplémentaire facultative : son absence ne bloque pas le pilote.

1. Essais en Mode Test (pointeur.irongs.com) : observer détection, qualité, liveness.
2. `BIOMETRIC_ENROLLMENT_ENABLED=true` (secret/env Coolify), **`BIOMETRIC_ENABLED` absent**.
   Migrations `20260930_0001` et `20260930_0002` appliquées au démarrage (additives).
3. Permissions : `biometric_status × read` + `biometric_enrollment × create/update` aux seuls
   opérateurs d'enrôlement ; `biometric_admin × admin` à l'administrateur des terminaux/caméras.
   Un pointeur ordinaire n'a aucune de ces permissions.
4. Consentements, puis enrôlement supervisé de **quelques employés explicitement choisis** ;
   revue des doublons.
5. Terminal : Gestion du pointage → Terminaux → « + Ajouter un terminal » (TAB-HAMOUL-01, Tablette Android,
   site HAMOUL 01) → code d'association → installation de la tablette
   (`docs/biometric-terminals.md`). Facial **désactivé**.
6. Essais physiques sur la tablette (`docs/attendance-hardware-checklist.md` § 10) — le terminal
   reste coupé pour le pointage réel tant que `BIOMETRIC_ENABLED` est absent.
7. **Seulement après GO signé** : `BIOMETRIC_ENABLED=true`, puis « Activer le facial » sur **ce
   seul terminal**. Aucun autre site, aucun autre terminal. Surveiller l'audit du terminal et les
   anomalies ; coupure immédiate par terminal ou par site.
8. (Facultatif) Caméra Dahua : catalogue, création, test, checklist § 1-9, activation séparée.

## 14. Terminaux faciaux mobiles (tablette Samsung, smartphone) — circuit B

### 14.1 Trois circuits séparés

Applications métier : **Gestion du pointage** = pointage.irongs.com (clé de module `pointage` :
présences, contrôle, enrôlement, terminaux, caméras, seuils) ; **Pointage** = pointeur.irongs.com
(clé `pointeur` : QR, pointeur, tablette, smartphone, pointage facial, `/borne`). Permissions
biométriques fines (`attendance × biometric_*`) : fonctions de gestion, présentées sous Gestion du
pointage ; l'exécution du pointage facial n'exige aucune permission utilisateur (identité de
terminal). `biometric_admin × validate` ouvre aussi le Mode Test dans Pointage.
Administration → Permissions granulaires : deux modules distincts dans la colonne de gauche,
« Gestion du pointage » (pointage.irongs.com : feuilles, génération/clôture, effectifs,
statistiques, biométrie — état / enrôlement / administration) et « Pointage »
(pointeur.irongs.com : pointage QR, saisie manuelle). Présentation seulement : toutes ces
permissions restent stockées sous `attendance` (aucune migration, droits existants conservés).


| Circuit | Chemin | Présence |
|---|---|---|
| A. Mode Test | navigateur → `/api/biometrics/test-mode/*` → moteur | **jamais** (`recorded: false`) |
| B. Terminal mobile | terminal associé → défi → rafale signée → `/api/biometrics/terminal/recognize` → moteur → Attendance Core | oui, après toutes les gardes |
| C. Caméra RTSP/Dahua | serveur → caméra → `/api/biometrics/cameras/{id}/recognize` → moteur → Attendance Core | oui, après toutes les gardes |

Mêmes moteur, gabarits, consentements, seuils versionnés, Attendance Core et audit. Le Mode
Test n'importe ni `terminals` ni `match_and_record` (test permanent) ; les routes du terminal
n'acceptent aucune session utilisateur ; les routes d'administration n'acceptent aucune identité
de terminal (tests dans les deux sens). Une image fournie par un navigateur **non associé** ne
crée jamais de présence.

### 14.2 Modèle de données (migration `20260930_0002`, additive)

- `biometric_terminals` : `public_id` immuable (`trm_…`, aléatoire), nom, type
  (`TABLET_ANDROID`, `SMARTPHONE_ANDROID`, `IPHONE`, `IPAD` ; `CAMERA_RTSP` renvoyé vers
  Caméras), société (celle du site), site, emplacement, `enabled`, `facial_attendance_enabled`
  (**faux**), clé **publique** P-256 (JWK) + empreinte, empreinte SHA-256 du code d'association +
  expiration (jamais le code), `paired_at`, `last_seen_at`, `revoked_at` + motif, `config_version`
  (incrémentée à chaque changement ⇒ défis antérieurs caducs), métadonnées non sensibles.
- `biometric_terminal_challenges` : défis (empreinte du nonce, terminal, site, versions,
  émission, expiration, consommation).
- `biometric_frame_digests` : empreintes SHA-256 des images reçues (jamais l'image).

### 14.3 Association et credential

1. L'administrateur crée le terminal (`POST /api/biometrics/terminals`, `biometric_admin × admin`).
2. `POST /api/biometrics/terminals/{id}/pairing-code` : code de 10 caractères (alphabet sans
   0/O/1/I/L, ≈ 49 bits, `secrets`), **10 min**, usage unique, stocké haché, audité ; affiché une
   fois avec un QR vers `https://pointeur.irongs.com/borne#pair=CODE` (le fragment `#` n'est jamais
   envoyé au serveur ni journalisé ; la page l'efface de l'URL).
3. La tablette ouvre `/borne`, génère une paire **ECDSA P-256** WebCrypto **non extractible**
   (`extractable: false`), conservée dans IndexedDB (clé de l'origine pointeur.irongs.com), et
   envoie la **clé publique** avec le code : `POST /api/biometrics/terminal/pair`. Le code est
   invalidé à la première utilisation (succès) ; code invalide ou expiré ⇒ 401 `PAIRING_CODE_INVALID` ;
   10 échecs / IP / 10 min ⇒ 429.
4. Rotation : nouveau code sur un terminal associé ; l'ancienne clé reste valable jusqu'à
   l'association du nouvel appareil, puis est remplacée (identifiant inchangé).
5. Révocation : `POST /api/biometrics/terminals/{id}/revoke` (motif) — clé effacée, définitif ;
   la borne affiche « TERMINAL NON AUTORISÉ » et efface son identité locale.

**Aucun secret n'est stocké côté serveur** (clé publique seulement) : une fuite de la base ne
permet pas d'usurper un terminal. Ni compte admin, ni mot de passe, ni identifiant d'appareil,
ni User-Agent ne servent d'authentification.

### 14.4 Signature des requêtes

En-têtes `X-Atlas-Terminal` (identifiant public), `X-Atlas-Timestamp` (ms), `X-Atlas-Signature`
(ECDSA P-256 / SHA-256, format brut r‖s 64 octets, base64url) sur le message canonique :

```
ATLAS-TERMINAL-1 \n terminal_id \n MÉTHODE \n chemin?requête \n horodatage \n SHA-256(corps exact)
```

Le corps contient le défi (id + nonce) et les images : aucune partie de la requête ne peut être
substituée (autre terminal, autre route, autre corps, autre défi) sans invalider la signature.
Horodatage : ± 300 s (horloge de tablette ; la borne corrige son décalage avec `server_time`).
Le site n'est pas signé par le client : il est **imposé par le serveur** (celui du terminal) et
lié au défi.

### 14.5 Défi, anti-rejeu, limitation de débit

- `POST /api/biometrics/terminal/challenge` (signé) : fail closed (`BIOMETRIC_ENABLED`, clé,
  moteur, type, activation du terminal), nonce 256 bits, **10 s**, lié au terminal, au site, à la
  version de configuration biométrique et à celle du terminal.
- `POST /api/biometrics/terminal/recognize` (signé) `{challenge_id, nonce, frames[2..5]}` : défi
  consommé **atomiquement** avant toute analyse (`UPDATE … WHERE consumed_at IS NULL`) ;
  refus `CHALLENGE_INVALID` (absent, faux, autre terminal), `CHALLENGE_REUSED`,
  `CHALLENGE_EXPIRED`, `CHALLENGE_STALE` (site ou configuration modifiés depuis le défi).
- Images : JPEG/PNG/WebP validés avant décodage (mêmes contrôles que le Mode Test) ; empreinte
  SHA-256 de chaque trame : trame déjà reçue ou trames identiques dans la rafale ⇒
  `REPLAY_DETECTED`. Index unique ; **rétention 7 jours** (purge à chaque défi) ; une empreinte ne
  permet pas de reconstituer l'image (collision SHA-256 : non praticable).
- Limitation : 120 requêtes / min / terminal (défis + reconnaissances + QR — la borne en émet au
  plus ~2 par seconde pendant une relève), 30 échecs d'authentification / IP / 5 min. Compteurs en
  mémoire, par worker.

**Limite assumée** : un navigateur ne fournit pas de preuve cryptographique que chaque pixel vient
du capteur (pas d'attestation matérielle de la caméra sur le web). Un attaquant qui contrôle
physiquement la tablette associée (ou y injecte une caméra virtuelle, ce qui exige un appareil
rooté / débogage activé) peut soumettre des images. La sécurité repose sur l'empilement :
terminal enregistré + clé non extractible + défi 10 s à usage unique + rafale multi-trames +
liveness + empreintes anti-rejeu + limitation + audit + coupures. Le liveness passif n'est **pas
validé** contre photo/écran/vidéo : essais physiques obligatoires (checklist § 10).

### 14.6 Rafale (mesurée)

3 trames, 200 ms d'intervalle, 800 px de grand côté, JPEG 0,85 (chaque trame attend une nouvelle
image du capteur, `requestVideoFrameCallback`). Mesures (moteur réel, Apple M4) : analyse
9 ms/trame à 480 px (visage 87 px, trop près du minimum de 80 px), 11 ms à 640 px, **14 ms à
800 px (visage 151 px)**, 23 ms à 1280 px ; ≈ 50–70 KB/trame, ≈ 200 KB/rafale (< 0,5 s en 4G). E2E
réel (Chrome, caméra virtuelle) : 50–68 ms serveur par reconnaissance complète. À re-mesurer sur le
serveur de production et la tablette réelle (latence réseau, éclairage).

### 14.7 Borne (`/borne`, PWA « Borne de pointage ATLAS »)

Plein écran, aucune navigation, aucune administration, aucun lien, bandeau « PRODUCTION »
(le Mode Test, lui, affiche « MODE TEST — AUCUN POINTAGE »). Caméra frontale (`facingMode: user`)
ou capteur choisi par l'administrateur à l'association (non modifiable ensuite par l'utilisateur).

Boucle sans clic : échantillon de luminance 32×24 toutes les 300 ms (aucun moteur ML dans le
navigateur ; `FaceDetector` utilisé seulement s'il existe) → analyse seulement si la scène bouge ou
diffère de la dernière scène analysée → défi → rafale → résultat. États : PRÊT, VISAGE DÉTECTÉ,
ANALYSE EN COURS, NOM PRÉNOM + matricule + ENTRÉE/SORTIE ENREGISTRÉE HH:MM (affichés **seulement**
après la réponse d'Attendance Core), POINTAGE DÉJÀ ENREGISTRÉ, VISAGE NON RECONNU (« Veuillez
utiliser votre QR ou contacter un responsable », aucun candidat, aucune proposition
d'enrôlement), PLUSIEURS VISAGES, QUALITÉ INSUFFISANTE, LIVENESS REFUSÉ, RÉSULTAT AMBIGU, TERMINAL
NON AUTORISÉ, TERMINAL DÉSACTIVÉ, POINTAGE FACIAL INDISPONIBLE, SERVICE TEMPORAIREMENT INDISPONIBLE,
CAMÉRA REFUSÉE / INTERROMPUE.

Réarmement : après un pointage, confirmation 3 s puis **attente d'un changement de scène** (la
personne s'en va) avant toute nouvelle analyse (réarmement forcé à 20 s ; le serveur répond de
toute façon `ALREADY_RECORDED`). Anti-doublon serveur : défi à usage unique + fenêtre de
non-répétition faciale de l'employé (`cooldown_seconds`, toutes sources faciales) + anti-rebond
Attendance Core (300 s) + idempotence `term{id}-ch{challenge}`.

QR : si le navigateur fournit `BarcodeDetector` (Chrome Android), la borne lit le QR employé du
Portail RH : `POST /api/biometrics/terminal/qr` (signé) → même contrôle que le scan superviseur
(QR signé, usage unique, employé affecté au site de la borne) → `attendance_core.record_scan`
(source QR). **Indépendant de `BIOMETRIC_ENABLED`** et du facial du terminal. HENEX HC-666 :
lecteur QR uniquement, inchangé.

### 14.8 Hors ligne — FAIL CLOSED

Serveur injoignable (réseau, 5xx) : la borne affiche « SERVICE TEMPORAIREMENT INDISPONIBLE —
UTILISEZ LE QR OU LA MÉTHODE DE SECOURS ». **Rien n'est enregistré localement, rien n'est mis en
file d'attente, aucune rafale n'est rejouée** (le défi serveur rend d'ailleurs tout rejeu
impossible). Nouvel essai automatique toutes les 5 s. Le QR de la borne utilise le même serveur :
hors ligne, il est aussi indisponible ; le HENEX et la saisie manuelle du pointeur restent la
méthode de secours selon les règles existantes.

### 14.9 Audit et confidentialité

`biometrics.terminal.{create,update,pairing_code,pair,auth,recognize,qr,revoke}` : terminal
(identifiant public), site, société, horodatage, état, matricule reconnu, confiance, liveness,
identifiant du défi, nombre de trames, version de configuration, pointage créé ou non, motif,
durée. **Jamais** : image, base64, gabarit, embedding, clé, code d'association. La réponse de
reconnaissance ne contient que nom, prénom, matricule, action, heure, site, confiance, liveness.
Consultable : Gestion du pointage → Terminaux → « Audit ».

### 14.10 Tests

`tests/test_biometrics_terminals.py` (20), `tests_frontend/pointeur-borne.test.js` (10, WebCrypto
réel), `tests_frontend/pointage-control-center.test.js` (administration des terminaux),
`npm run test:biometric-terminal-real-e2e` (vrai serveur, vrai moteur, vrai Chrome : enrôlement
supervisé → association → activation → ENTRÉE → SORTIE en base ; E2E hostile : JPEG sans
terminal, session humaine, signature, rejeux, ancienne configuration, révocation ⇒ aucun
pointage).

## 15. Référence faciale depuis la photo DRH (Fiche de position)

Parcours cible : **DRH → Fiche de position → Photo employé → référence faciale**. L'opérateur RH
ne voit ni gabarit ni score : seulement un état (« Prête », « Photo à actualiser », « Revue
requise », « Aucune référence disponible », « Traitement temporairement indisponible »…).

### 15.1 LOT A — état et analyse (lecture seule)

`GET /api/drh/employees/{id}/facial-reference` (état) et
`POST /api/drh/employees/{id}/facial-reference/analyze` (analyse en mémoire d'une photo
candidate). Aucun gabarit créé, remplacé ou désactivé (`app/modules/biometrics/photo_reference.py`).

### 15.2 LOT B — synchronisation automatique (`app/modules/biometrics/photo_sync.py`)

| Réglage serveur | Défaut | Effet |
|---|---|---|
| `DRH_FACIAL_REFERENCE_AUTO_SYNC_ENABLED` | `false` | `true` : une photo ajoutée/actualisée depuis la Fiche de position prépare automatiquement la référence faciale. Exige aussi `BIOMETRIC_ENROLLMENT_ENABLED` (ou `BIOMETRIC_ENABLED`) et `BIOMETRIC_TEMPLATE_KEY`. |
| `FACIAL_REFERENCE_CONSENT_MODE` | `explicit` | `explicit` : accord admissible exigé (règle historique). `no_objection` : aucun accord manuel exigé ; un **refus** ou un **retrait** enregistré bloque toujours. Aucun consentement n'est créé ni supprimé. |

`BIOMETRIC_ENABLED` n'est **pas** utilisé par ce lot : préparer une référence n'active pas le
pointage facial. Retour arrière : remettre `DRH_FACIAL_REFERENCE_AUTO_SYNC_ENABLED=false`
(comportement antérieur, y compris l'invalidation d'une référence dont la photo a changé).

**Déclenchement.** Uniquement par l'enregistrement de la fiche (`PUT`/`POST /api/drh/employees`)
portant `?photo_source=DRH_CAMERA` ou `DRH_UPLOAD` **et** si l'empreinte SHA-256 de la photo a
réellement changé. Sources exclues : import, synchronisation historique (`upsert_employee`),
appel sans provenance. Aucun traitement au démarrage, aucune tâche planifiée, aucune migration
de données : les photos déjà présentes ne sont pas traitées (LOT F).

**Fiche prioritaire.** La demande est enregistrée après la validation de la fiche, dans une
transaction distincte, puis traitée en arrière-plan (`BackgroundTasks`). Un échec du moteur ne
modifie jamais la fiche ni la photo.

**Pipeline** (`sync_facial_reference_from_employee_photo`) : statut RH → consentement → clé →
moteur → un seul visage → qualité → comparaison avec la référence active → doublons (moteur
existant) → chiffrement → activation → audit.

| Situation | État (`biometric_photo_syncs.status`) | Référence précédente |
|---|---|---|
| Photo exploitable, aucune référence | `READY` | — |
| Même personne | `READY` (nouvelle activée, puis ancienne désactivée, même transaction) | remplacée |
| Visage différent / ambigu | `REVIEW_REQUIRED` (`FACE_MISMATCH` / `FACE_AMBIGUOUS`), anomalie `FACE_REFERENCE_MISMATCH` | **conservée active** |
| Proche d'un autre salarié | `REVIEW_REQUIRED` (`POSSIBLE_DUPLICATE`), anomalie existante | conservée |
| Aucun visage / plusieurs / qualité | `PHOTO_INVALID` | conservée |
| Moteur, clé ou erreur technique | `ENGINE_UNAVAILABLE` (reprise à la consultation de la fiche, 3 au plus) | conservée |
| Refus, retrait, accord requis, statut RH | `BLOCKED` | — |

Une référence en revue se décide dans Gestion du pointage → « Doublons à revoir ».

**Idempotence et concurrence.** Une ligne d'état par employé, liée à l'empreinte : la même
photo n'est traitée qu'une fois ; une tâche portant une ancienne empreinte n'écrit rien ; la
ligne est verrouillée pendant le traitement (`SELECT … FOR UPDATE`).

**Données.** Table `biometric_photo_syncs` (migration additive `20261002_0001`) : empreinte,
état, code de raison, source, dates. Ni image, ni gabarit, ni score. Audit
`drh.facial_reference.{requested,ready,photo_invalid,review_required,blocked,unavailable}`.

**Limite connue.** La reconnaissance au pointage exige toujours un accord admissible
(`consent_admissible`) : une référence préparée en mode `no_objection` n'est pas encore
utilisable par la borne. Ce point relève des lots suivants.

Tests : `tests/test_drh_facial_reference_sync.py`,
`tests_frontend/employee-facial-reference-sync.test.js`,
`npm run test:drh-facial-reference-sync-e2e`.

## 16. Prise de photo distante supervisée (LOT C1)

**DRH → Fiche de position → « Prendre la photo »** peut utiliser, à la place de la caméra de
l'ordinateur, un terminal de pointage autorisé (tablette ou smartphone) comme caméra distante.
Code : `app/modules/biometrics/remote_capture.py`, routes DRH `…/remote-photo/…`, borne `/borne`.

| Réglage serveur | Défaut | Effet |
|---|---|---|
| `DRH_REMOTE_PHOTO_CAPTURE_ENABLED` | `false` | `true` : la fiche propose les terminaux en ligne et les bornes relèvent les commandes. Exige `BIOMETRIC_TEMPLATE_KEY` (photo candidate chiffrée). Indépendant de `BIOMETRIC_ENABLED`. |

Retour arrière : `false` — seule la caméra de l'ordinateur est proposée, la borne ne relève plus
aucune commande. Une borne déjà ouverte prend le réglage en compte à sa prochaine relecture
d'état (redémarrage du serveur, rechargement, ou relecture périodique quand le facial est coupé).

### 16.1 Canal

Aucun canal poussé n'existe (terminal authentifié par signature à chaque requête, plusieurs
workers sans mémoire partagée). La borne **interroge** donc le serveur : `GET
/api/biometrics/terminal/command` (requête signée) toutes les 2 s au repos, chaque seconde
pendant une prise. Cet appel sert de battement de cœur : un terminal est « En ligne » s'il a été
vu depuis moins de 20 s. Le PC ne parle jamais au terminal.

### 16.2 Session

Table `biometric_remote_capture_sessions` (migration additive `20261003_0001`) : identifiant
aléatoire, employé, terminal, opérateur, société, site, état, échéance. Une seule session active
par terminal et par employé (colonnes `active_*` uniques).

```
REQUESTED ──(terminal : prise en compte)──► WAITING_FOR_FACE ──(photo exploitable)──► PREVIEW_READY
                                                  ▲                                      │
                                                  └──(terminal)── RETAKE_REQUESTED ◄──(opérateur : Reprendre)
PREVIEW_READY ──(opérateur : Utiliser cette photo)──► ACCEPTED
toute session active ──► CANCELLED (opérateur, PC disparu) | EXPIRED (échéance) | FAILED (terminal muet, désactivé, révoqué)
```

Toutes les transitions sont validées par le serveur. Échéances : 120 s par prise, 90 s pour
décider après la photo, 15 s sans prise en compte par le terminal (`TERMINAL_UNREACHABLE`),
20 s sans signe de vie du PC (`OPERATOR_GONE`), 5 reprises au plus. La borne revient au pointage
dès que la session n'est plus active, quelle qu'en soit la cause.

### 16.3 Terminal

- Requêtes signées comme les autres (`authenticated_terminal`) : aucun mot de passe, aucun jeton
  permanent propre à C1. La photo n'est acceptée que pour la session en attente de CE terminal,
  avec le **jeton de capture à usage unique** remis à la prise en compte (renouvelé à chaque essai).
- Pendant la prise, le terminal est réservé : bandeau « PRISE DE PHOTO EN COURS », ni
  reconnaissance, ni QR, ni pointage (le serveur refuse aussi : `CAPTURE_IN_PROGRESS`). Un
  pointage déjà engagé se termine avant la prise.
- La vidéo reste sur le terminal. Scène stable ⇒ une photo fixe est proposée (1 par 1,5 s au
  plus) ; le serveur l'analyse (un visage, qualité) et renvoie une consigne simple (« Regardez
  la caméra », « Approchez-vous », « Restez immobile », « Une seule personne… ») ; une photo
  refusée n'est pas conservée. Le terminal ne reçoit que le nom et le prénom du salarié.
- Après la prise, aucun pointage n'est tenté tant que la personne n'a pas quitté le champ.

### 16.4 Opérateur RH

`GET /api/drh/employees/{id}/remote-photo/terminals`, `PUT …/remote-photo/session`,
`GET /api/drh/remote-photo/sessions/{sid}`, `GET …/preview`, `PATCH …` (`retake` / `accept` /
`cancel`). Droits : module DRH, périmètre société de l'employé, et méthodes PUT / PATCH — donc
l'action « update », la même que pour modifier la fiche. La session n'est visible que de
l'opérateur qui l'a créée. **Périmètre terminal** : même société que l'employé (le périmètre DRH
est par société, sans filtre de site ; le site d'affectation n'ordonne que la liste). Le poste
de sécurité (`pointeur.irongs.com`) n'a aucun accès à ces routes.

« Utiliser cette photo » place la photo dans le formulaire ; **« Enregistrer »** la conserve et
déclenche le LOT B avec la provenance `DRH_REMOTE_TERMINAL` (vérifiée : l'empreinte doit
correspondre à une prise acceptée pour cet employé, sinon `DRH_UPLOAD`).

### 16.5 Photo candidate et audit

La photo candidate vit **chiffrée** dans la session (jamais dans `/uploads`, jamais dans les
journaux) et est effacée à l'acceptation, la reprise, l'annulation ou l'expiration ; il ne reste
que son empreinte. Audit `drh.remote_photo.{requested,acknowledged,captured,retake,accepted,
cancelled,expired,failed}` : opérateur, employé, terminal, site, session (tronquée), état, raison.

Tests : `tests/test_drh_remote_photo_capture.py`, `tests_frontend/employee-remote-photo.test.js`,
`tests_frontend/pointeur-borne-remote-capture.test.js`, `npm run test:drh-remote-photo-e2e`.
