# Pointeur V5 — poste de contrôle des vacations et présences (lot 5)

`pointeur.irongs.com` (`app/static/pointeur.html`) affiche en temps réel la vacation active, le
groupe au travail, les personnes attendues / présentes / absentes / en maintien et ce qui demande
une intervention. **Rien n'est codé en dur ni déduit par le navigateur** : tout vient du flux live
(`GET /api/portal/attendance-live`, clé `post`), lui-même issu du planning officiel et
d'Attendance Core. Seuls les comptes à rebours sont calculés à l'écran, sur l'horloge métier.

## Données (`live.control_post`, pour UN site sélectionné)

| Bloc | Source |
|---|---|
| `current`, `next` (vacation, horaires, groupe, relève) | `official.site_shift` — cycle officiel ancré du site |
| `status = ROTATION_NOT_CONFIGURED` | site posté sans ancrage : aucune vacation, aucun groupe, aucune relève |
| `kpi.expected` | affectations postées actives du groupe de la vacation en cours (salariés actifs) |
| `kpi.present`, `present[]` | dernier passage = entrée encore ouverte — une ligne par personne |
| `kpi.absent`, `kpi.excused` | attendus non présents ; congé / maladie / mission / repos (journée) comptés à part |
| `kpi.maintien` | présents dont l'entrée est une `EXTRA_SHIFT` |
| `kpi.anomalies`, `todo[]` | anomalies `OPEN` : `VACATION_NON_CLOTUREE`, `EXTRA_SHIFT` (maintien à qualifier), sévérité critique ; refus `MANUAL_ENTRY_REQUIRED` encore d'actualité |
| `movements[]` | 30 derniers passages et tentatives refusées (24 h) — les refus ne changent jamais les présents |
| `activity.refused_today` | tentatives refusées du jour |
| `maintien` | fenêtre TFIN+30 → TFIN+45 du site, tant qu'elle est pertinente |
| `permissions.manual_entry` | permission `attendance / manual_entry / create` de l'utilisateur |

Entrées / sorties du jour (`summary`) sont des **mouvements** ; les KPI sont des **personnes**.

## Écran

Header (logo IRON GLOBAL SÉCURITÉ, POSTE DE POINTAGE, site, date et horloge métier, en ligne,
déconnexion) · bandeau vacation et prochaine relève · bandeau de maintien quand il est pertinent ·
5 KPI · activité du jour · zone de pointage (QR, facial, saisie manuelle) à gauche (≈ 65 %),
« Présents actuellement » et « À traiter » à droite · « Derniers mouvements » avec filtres locaux.
Mobile : une colonne — vacation, KPI, pointage, à traiter, présents, mouvements.

Sans site unique sélectionné, `post` est absent : l'écran historique reste affiché.

**Pointage accepté** : heure réelle, horaire planifié et temps comptabilisé affichés distinctement
(entrée, sortie, maintien). **Refus** : motif réel d'Attendance Core, traduit par code —
`EARLY_OUTSIDE_WINDOW`, `EXTRA_BEFORE_WINDOW`, `PREVIOUS_SHIFT_NOT_CLOSED`,
`MANUAL_ENTRY_REQUIRED` — avec vacation précédente, sortie et fenêtre ; toujours « Aucun mouvement
enregistré ». Le refus d'un scan direct est lu dans l'en-tête `X-Attendance-Refusal` (le champ
`detail` reste le texte historique). Aucune erreur technique brute n'est affichée.

## Intention explicite de maintien

`GET /api/portal/attendance-manual/context?employee_id=&site_id=` (lecture seule) donne, pour
l'employé choisi en saisie manuelle : vacation précédente, sortie, fin théorique, fenêtre
automatique, vacation supplémentaire et la réponse qu'Attendance Core ferait à une entrée explicite.
Le bouton « NOUVELLE ENTRÉE DE MAINTIEN » envoie `intent = EXTRA_SHIFT_ENTRY` ; le bouton
« PRÉSENT » historique n'envoie jamais d'intention. Un scan QR ou facial n'en porte pas : tant que
la première vacation est ouverte, il en est la sortie. Motif exigé après TFIN+45 ; l'opération est
auditée. Le bouton de saisie manuelle n'apparaît que si l'utilisateur a la permission.

## Rafraîchissement et temps

Relève toutes les 2 s (inchangée). Chaque bloc n'est réécrit que si son contenu change : pas de
clignotement, scanner et caméra intacts, aucune alerte recréée. La vacation et le groupe basculent
à 06:00 / 14:00 / 22:00 selon le serveur ; à minuit la Nuit reste la même vacation et ses KPI ne
repartent pas à zéro. Horloge et date : temps métier du serveur (lot 3).

## Tests

`tests/test_pointeur_control_post.py` (relèves, minuit, KPI, à traiter, intention) ·
`tests_frontend/pointeur-v5.test.js` (jsdom) · `npm run test:pointeur-v5-chrome` (Chrome réel,
1600 → 390 px : aucun débordement, 65/35 puis une colonne, header sans collision, mise en page
stable sur 30 s de rafraîchissements avec changement d'état).

## Hors périmètre

Remplacement hors planning (salarié venant sur une vacation qui n'est pas la sienne) : cas métier
distinct du maintien, non traité. Qualification récupération / paiement du maintien : à venir.
