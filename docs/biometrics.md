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
  tablette : images envoyées par le terminal). Attendance Core ne connaît aucun fabricant.
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

**Non vérifiable sans matériel** — protocole à exécuter avec la caméra Dahua avant activation :
1. 50 passages réels (5 employés × 10, lumière jour/nuit) : taux d'acceptation, scores.
2. Attaques : photo imprimée (A4, papier photo), photo sur smartphone, photo sur tablette,
   vidéo sur écran, masque papier ; 20 essais chacun. Attendu : aucun pointage accepté.
3. Deux personnes dans le champ, personne de dos, casque/casquette, lunettes.
4. Latence de bout en bout (rafale + analyse) par profil ; choix du profil de reconnaissance.
5. Ajuster les seuils en créant une nouvelle version avec la provenance « calibration site X ».

## 9. Activation (checklist)

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
