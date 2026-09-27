# Checklist terrain — pointage facial (caméra Dahua 5 MP)

À exécuter **avant toute activation** de `BIOMETRIC_ENABLED` en production. Aucun de ces points ne
peut être déclaré « PASS » sans la vraie caméra, sur le vrai site, avec de vraies personnes.
Chaque ligne se remplit sur place (date, opérateur, résultat mesuré, décision).

## 0. Ce qui est déjà validé logiciellement (hors matériel)

| Domaine | Preuve |
|---|---|
| Chaîne complète caméra → backend → reconnaissance → Attendance Core → terminal, zéro clic | E2E Chrome (caméra Dahua **simulée** en HTTP Digest, moteur réel) : ~1 s de l'ouverture de la vue au pointage |
| Adaptateur Dahua : instantané Digest, refus mot de passe faux, aucun secret exposé | `tests/test_biometrics_engine_real.py` (serveur Digest réel local) |
| Reconnaissance même personne / personnes différentes | Moteur réel sur portraits du domaine public : 0,81 contre 0,14–0,26 |
| Image figée ré-injectée | Refusée (E2E + test moteur réel) |
| Refus métier : inconnu, plusieurs visages, ambigu, qualité, employé suspendu, consentement retiré, autre site, caméra d'enrôlement | `tests/test_biometrics.py` |
| Images client jamais utilisées pour pointer | `test_client_images_are_never_used_to_record_attendance` |
| Non-répétition (visage resté devant la caméra), idempotence, concurrence | E2E + tests + courses PostgreSQL réelles |

## 1. Constat préalable important (mesuré)

Le liveness passif (MiniFASNetV2) **n'est pas probant sur des simulations numériques** : un même
portrait inséré dans un cadre d'« écran » a été **accepté** (score 1,0) pour une photo et **refusé**
(0,04) pour une autre. Il ne voit pas les artefacts physiques (moiré, reflets, texture d'impression)
d'une vraie présentation, et une photo pleine résolution injectée dans le flux passe (0,84–0,92).
Conséquences :
- l'injection dans le flux est bloquée par l'architecture (images lues par le serveur sur une caméra
  du LAN, identifiants chiffrés, caméra jamais exposée sur Internet) — à vérifier au §3 ;
- la résistance aux **présentations physiques** doit être mesurée ci-dessous ; si elle est
  insuffisante, **ne pas activer** sans une protection complémentaire (capacité anti-fraude
  matérielle de la caméra — infrarouge/3D — **si le modèle retenu en dispose, à vérifier sur sa
  fiche technique**, ou défi actif).

## 2. Identification du matériel

| Point | Valeur relevée | OK |
|---|---|---|
| Fabricant / modèle exact (référence commerciale complète) | | ☐ |
| Version firmware | | ☐ |
| Numéro de série | | ☐ |
| Résolution flux principal / sous-flux | | ☐ |
| Capacités anti-fraude matérielles annoncées par le fabricant (IR, 3D…) | | ☐ |
| Modèle ajouté au catalogue ATLAS (Pointage → Caméras → Modèle) | | ☐ |

## 3. Réseau et sécurité

| Point | Attendu | Résultat | OK |
|---|---|---|---|
| Caméra sur le LAN du site uniquement | Aucune exposition Internet (scan externe du port) | | ☐ |
| Chemin ATLAS → caméra | Serveur sur le LAN, ou passerelle VPN/tunnel documentée | | ☐ |
| Identifiants caméra | Mot de passe fort, compte dédié en lecture | | ☐ |
| Test ATLAS « Tester la caméra » | Connexion OK, image OK (résolution), flux OK | | ☐ |
| Latence instantané (profil reconnaissance) | À mesurer, cible < 500 ms | | ☐ |
| Coupure réseau caméra | Message clair sur le terminal, reprise automatique au retour | | ☐ |
| Redémarrage caméra | Reprise sans intervention | | ☐ |

## 4. Conditions de capture

| Condition | Essais | Acceptations correctes | Refus / nouvel essai | Remarques | OK |
|---|---|---|---|---|---|
| Lumière du jour, face à la caméra | 20 | | | | ☐ |
| Faible lumière / nuit | 20 | | | | ☐ |
| Contre-jour | 20 | | | | ☐ |
| Lunettes, casquette, casque | 20 | | | | ☐ |
| Distance trop grande (visage < 80 px) | 10 | — | refus attendu | | ☐ |
| Deux personnes dans le champ | 10 | — | « Présentez-vous individuellement » | | ☐ |
| Personne de dos / de profil | 10 | — | aucun pointage | | ☐ |

## 5. Attaques par présentation (aucun pointage attendu)

| Attaque | Essais | Pointages acceptés (doit être 0) | Anomalie LIVENESS_FAILED tracée | OK |
|---|---|---|---|---|
| Photo imprimée A4 | 20 | | | ☐ |
| Photo papier photo | 20 | | | ☐ |
| Photo sur smartphone | 20 | | | ☐ |
| Photo sur tablette | 20 | | | ☐ |
| Vidéo sur écran | 20 | | | ☐ |
| Masque papier découpé | 10 | | | ☐ |

**Critère de décision** : une seule acceptation sur une attaque ⇒ NO-GO sur ce modèle/configuration.

## 6. Débit et comportement terrain

| Point | Attendu | Résultat | OK |
|---|---|---|---|
| Passages successifs (file de 20 personnes) | Chaque personne pointée une fois, ordre respecté | | ☐ |
| Même personne restée devant la caméra 1 min | Un seul pointage | | ☐ |
| Sortie réelle en fin de poste | Départ enregistré | | ☐ |
| Débit mesuré (personnes / minute) | | | ☐ |
| Déconnexion terminal après 30 s sans passage | Comportement actuel (identique borne QR) — décision kiosque à prendre | | ☐ |
| Pointage de secours (visage inconnu, caméra hors service) | QR / saisie manuelle disponibles et tracés | | ☐ |

## 7. Calibration

Après les §4–5, créer une **nouvelle version** de configuration (Pointage → seuils) avec la
provenance « calibration site X, date, N passages » ; ne jamais modifier la version 1.

## 8. Décision

| Décision | Signataire | Date |
|---|---|---|
| GO / NO-GO activation site : | | |
