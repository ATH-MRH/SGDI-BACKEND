# Poste de sécurité — pointeur.irongs.com (Pointage réel V2)

## Règle d'or

**Attendance Core décide** (`app/modules/attendance/core.py::record_scan`) : acceptation, ENTRÉE,
SORTIE, doublon, présence. La biométrie répond seulement « qui est-ce ? ». Aucun frontend
(tablette, smartphone, PC) ne décide d'une entrée ou d'une sortie.

## Règle ENTRÉE / SORTIE (déterministe, inchangée, désormais testée)

Pour un employé, à l'instant `t`, sous verrou de ligne PostgreSQL (`SELECT … FOR UPDATE`) :

1. **Idempotence** : même `(source, clé)` (double POST, retry réseau, défi du terminal, nonce QR)
   ⇒ même réponse, aucun nouvel événement.
2. **Anti-rebond** : un passage moins de `ATTENDANCE_MIN_EVENT_GAP_SECONDS` (= 300 s) après le
   DERNIER passage, **quelle que soit la source ou le terminal**, ⇒ « Déjà enregistré », aucun
   mouvement. Côté facial, en plus : non-répétition de 60 s par terminal ; côté borne :
   aucune nouvelle tentative tant que la personne n'a pas quitté le champ (20 s au plus).
3. **Cycle ouvert** : si le dernier passage est une ENTRÉE de moins de 16 h (30 h sur un site en
   rotation 24 h) ⇒ **SORTIE**, rattachée à la journée de l'entrée (aucune sortie à minuit).
4. Sinon ⇒ **ENTRÉE**, refusée (409) moins de 8 h après la dernière ENTRÉE.
5. Statut RH bloquant (suspendu, sortant, inactif, archivé, démission, licenciement, mise à
   pied, blacklist) ⇒ refus 403, aucun mouvement, même si le visage est reconnu.

Conséquences vérifiées (`tests/test_attendance_production_v2.py`) :

| Scénario | Résultat |
|---|---|
| Visage resté devant la tablette (t = 0, 1, 2, 3 s, puis jusqu'à 4 min 59 s) | 1 ENTRÉE, le reste « Déjà enregistré » |
| Entrée tablette puis smartphone / QR 1 à 2 min plus tard | doublon, jamais une sortie |
| Personne restée plus de 300 s, cycle ouvert | SORTIE (règle actuelle) |
| Re-reconnaissances après la sortie, moins de 8 h après l'entrée | doublon puis 409 — la boucle ENTRÉE/SORTIE/ENTRÉE/SORTIE est impossible |
| Poste de nuit 22:00 → 06:00 | sortie rattachée à la veille, durée 480 min, présent après minuit |
| Employé suspendu / sortant / inactif reconnu | 403, aucun mouvement, refus affiché au PC |

Concurrence : prouvée sur PostgreSQL réel (`tests/test_attendance_core_pg_race.py`, base jetable) —
même nonce, 12 scans simultanés, QR + facial + manuel au même instant : un seul événement.

**Décision métier ouverte** : 300 s est aussi le délai minimal avant qu'une reconnaissance
devienne une SORTIE. Une personne qui reste plus de 5 min près de la tablette serait sortie.
Allonger ce délai pour la seule SORTIE automatique (ex. 15–30 min) est possible mais change le
métier (sorties rapides légitimes) : à décider.

## Écran principal

- **Dernier pointage** (gauche) : le passage ACCEPTÉ par Attendance Core (facial, QR, saisie)
  s'affiche seul — portrait DRH (repli : photo de la fiche, puis initiales), nom, code, fonction,
  site, société, terminal, IDENTIFIÉ / QR VALIDÉ / SAISIE MANUELLE, ENTRÉE ENREGISTRÉE (vert) ou
  SORTIE ENREGISTRÉE (bleu), heure, ÉTAT ACTUEL : PRÉSENT / SORTI. Affiché 12 s puis
  « EN ATTENTE DU PROCHAIN POINTAGE » ; un nouveau passage remplace immédiatement le précédent.
- **Refus** : employé reconnu mais non autorisé (suspendu, non actif…) ⇒ carte rouge POINTAGE
  REFUSÉ + motif, « AUCUN MOUVEMENT ENREGISTRÉ » (jamais affiché sur la tablette publique).
- **Pointage en direct** (droite) : inchangé, rafraîchi à chaque nouveau passage.
- **Mode Test** : retiré de cet écran ; il reste dans Gestion du pointage.

## Temps réel

`GET /api/portal/attendance-live?site_id&after_id&after_refusal_id` (lecture seule, périmètre
du compte), interrogée toutes les **2 s** : nouveaux passages acceptés, refus récents (audit des
terminaux, sans image), compteurs. Le flux SSE existant n'a pas été retenu : il est global
(24 tables, toute l'application) et non limité au site. Portrait :
`GET /api/portal/attendance-employee/{id}/portrait` (employé du périmètre seulement).

## Compteurs (serveur, `app/modules/attendance/live.py`)

Journée civile Africa/Algiers. Entrées aujourd'hui : ENTRÉES dont la journée est aujourd'hui ;
Sorties aujourd'hui : SORTIES survenues aujourd'hui ; Présents sur site : dernier passage =
ENTRÉE encore dans la fenêtre de cycle ouvert (présents de la nuit inclus) ; Absents aujourd'hui :
journées du jour saisies « absent ». Plus aucun calcul contradictoire dans le navigateur.

## Planning, horaires, effectif contractuel

- FAIT : Attendance Core enregistre toujours un passage valide. INTERPRÉTATION : anomalies
  RETARD (tolérance 15 min) et JOUR NON TRAVAILLÉ issues des modèles de rotation — jamais un
  refus.
- « Planning intelligent » (écran) : comparaison avec le même jour de la semaine précédente.
  Pendant l'apprentissage, une présence sans référence pour ce jour est affichée « Présence
  constatée — planning en apprentissage », plus « non prévue ».
- Effectif contractuel (DC.IRONGS.COM) : affichage seul ; son absence n'invalide aucun pointage.
- Pauses : notion inexistante (non introduite).

## Point à décider : déconnexion après 30 s d'inactivité

`pointeur.html` déconnecte la session après 30 s sans geste (règle « LOT SÉCURITÉ »). Un écran
permanent sans contact sur un poste de sécurité est incompatible avec cette règle. Non modifiée
sans décision : par exemple, compte « poste de sécurité » en lecture seule exempté, ou délai long
pour ce seul compte.
