# Pointeur — pointage facial automatique en un clic

## Principe

Sur `pointeur.irongs.com`, un clic sur la carte **Reconnaissance faciale** (ou sur « Facial » dans
le header) active le pointage facial automatique **dans la zone de pointage du poste**. Le reste
du poste — vacation, KPI, présents, à traiter, derniers mouvements — reste affiché. Aucune
redirection, aucun second clic.

Il reste **un seul moteur facial** et **un seul Attendance Core** : l'écran n'est qu'un point
d'entrée vers l'existant.

| Élément | Où |
|---|---|
| Interface | `app/static/pointeur-facial.js` + `#faceView` dans la zone de pointage de `pointeur.html` |
| Moteur | `app/modules/biometrics/service.py` (`recognize_and_record` → `match_and_record`) |
| API | `GET /api/biometrics/status`, `GET /cameras?site_id=`, `GET /cameras/{id}/preview.jpg`, `POST /cameras/{id}/recognize` |
| Caméra | caméra de pointage du site, **lue par le serveur** ; l'aperçu est relayé par le backend |
| Site | le site sélectionné dans le Pointeur (`selectedSiteId`) — jamais resélectionné |
| Écriture | `attendance_core.record_scan(source = FACIAL)` — le même que QR et saisie manuelle |
| Permissions | périmètre sites de l'utilisateur ; caméra active, d'usage pointage, `facial_attendance_enabled` ; `BIOMETRIC_ENABLED` |

**Caméra du poste ≠ caméra de pointage.** La caméra locale du PC, de la tablette ou du smartphone
n'est jamais utilisée pour pointer (une image fournie par un navigateur pourrait être injectée) ;
les caméras « terminal » ne servent qu'à l'enrôlement supervisé. Le bouton « LIRE LE QR AVEC LA
CAMÉRA » (ex-« UTILISER LA CAMÉRA ») est le lecteur **QR** par la caméra locale : ce n'est pas un
doublon du facial, il est masqué en mode facial.

## Comportement

| Situation | Affichage |
|---|---|
| Site sélectionné, caméra active | aperçu relayé, détection automatique, « PRÊT — placez-vous face à la caméra » |
| « Tous les sites » | SÉLECTIONNEZ UN SITE — aucune caméra choisie arbitrairement ; le facial démarre dès qu'un site est choisi |
| Aucune caméra de pointage | AUCUNE CAMÉRA DE POINTAGE, état compact sans cadre vidéo, aucune action de configuration |
| Facial désactivé (serveur, site ou caméra) | RECONNAISSANCE FACIALE DÉSACTIVÉE — la protection n'est jamais contournée |
| Visage inconnu | VISAGE INCONNU, aucun mouvement, aucun rattachement ; secours par la saisie manuelle existante |

Le facial ne transmet que l'identité reconnue. Entrée / sortie, vacation, T-30, temps
comptabilisé, maintien, TFIN+30 / TFIN+45 et refus sont décidés par Attendance Core ; la fiche du
poste (heure réelle, horaire planifié, temps comptabilisé, motif précis du refus) est la même que
pour le QR et la saisie manuelle (photo, nom, matricule, poste, groupe). La réponse du moteur relaie désormais `counted` (pointage accepté)
et `code` + `refusal` (refus d'Attendance Core), sans rien décider.

Après un résultat, retour automatique à l'attente d'un visage ; la caméra reste active.

## Anti-double pointage

- serveur : fenêtre de non-répétition du moteur (`cooldown_seconds`, par caméra) puis anti-rebond
  d'Attendance Core (`attendance_min_event_gap_seconds`) ;
- écran : une seule reconnaissance à la fois, aucune pendant l'affichage du résultat.

Dix détections du même visage ⇒ un seul mouvement ; deux personnes successives pointent chacune.

## Nettoyage

Passer au QR, à la saisie manuelle, au planning, changer de site ou se déconnecter arrête la
détection, l'aperçu et les minuteurs. Une réponse encore en vol est ignorée (contexte périmé).
Au changement de site, le mode facial reste actif et cherche la caméra du nouveau site ; plus
aucun appel ne part vers la caméra du site précédent.

## État du système

En mode facial : « Caméra » (Active / Recherche… / Non disponible) et « Reconnaissance faciale »
(Active / Initialisation / Erreur / Désactivée), à partir des états réellement connus du moteur.

## Tests

`tests/test_pointeur_facial_direct.py` (anti-rebond, refus, même résultat QR / facial / manuel) ·
`tests_frontend/pointeur-facial-direct.test.js` et `pointeur-facial.test.js` (jsdom) ·
`npm run test:pointeur-v5-chrome` (Chrome réel, 1600 → 390 px, avec et sans caméra).
Aucune caméra physique n'est utilisée par les tests : capture et aperçu sont simulés.
