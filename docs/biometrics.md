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

1. Installer `requirements-biometric.txt` dans l'image.
2. Copier les trois modèles dans `BIOMETRIC_MODELS_DIR` (empreintes du §2).
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

## 11. Chantier séparé « KIOSK DEVICE IDENTITY » (non implémenté)

Aujourd'hui une borne faciale fonctionne avec une session utilisateur ordinaire (pointeur),
déconnectée après 30 s sans passage. Une borne sans surveillance exige une **identité
d'équipement**, distincte d'un compte humain. Cahier des charges, à traiter comme un chantier
à part (conception + revue sécurité) :

| Exigence | Contenu |
|---|---|
| Terminal enregistré | enrôlement explicite par un administrateur, identifiant unique, état actif/révoqué |
| Rattachement | une société, un site, une (ou des) caméra(s) déclarée(s) ; aucun autre périmètre |
| Credential technique | secret propre à l'équipement, révocable, jamais un mot de passe humain ; stocké haché/chiffré |
| Permissions minimales | reconnaissance sur ses caméras + flux de passages de son site ; **aucun accès aux autres API** (DRH, paie, OPS, administration) |
| Rotation | durée de vie limitée, renouvellement sans intervention sur la borne |
| Révocation | immédiate, effective sur la requête suivante |
| Audit | chaque appel rattaché à l'équipement (et non à un humain) ; enregistrement, rotation, révocation audités |

Tant que ce chantier n'est pas livré : pas de borne faciale sans surveillance.

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
  toutes les 2 s.

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

Mesure locale (moteur réel, MacBook, JPEG 1280 px, 1 trame) : analyse ≈ 23 ms (décodage 2,
détection 15, gabarit 5, liveness 1), comparaison 1:N ≈ 2 ms, total ≈ 25–27 ms côté serveur,
hors réseau. Seuils inchangés.
