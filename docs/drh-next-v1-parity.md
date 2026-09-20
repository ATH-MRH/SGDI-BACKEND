# DRH Next V1 — Audit de parité Legacy ↔ Next

Document vivant, LOT 11 (mission de finalisation). Mis à jour au fil des LOT 11A/11B/11C.
Méthode : lecture directe du code (Legacy `app/static/sgdi-app.js`, backend `app/modules/*`),
jamais d'hypothèse — chaque ligne cite ce qui a réellement été vérifié.

Légende statut : **PARITÉ** · **NEXT SUPÉRIEUR** · **MANQUANT** (à construire, backend OK) ·
**BACKEND MANQUANT** (aucune source canonique typée) · **VOLONTAIREMENT ABANDONNÉ** ·
**À CORRIGER**. Priorité : **P0** sécurité/données · **P1** métier indispensable · **P2** utile · **P3** confort.

| # | Fonction | Legacy | Next (avant LOT 11B) | Backend canonique | Statut | Priorité |
|---|---|---|---|---|---|---|
| 1 | Dashboard | `renderGlobalDashboard`, `renderDashboard` | `dashboard.mjs` (LOT 1/9) | `GET /drh/dashboard` (agrégats serveur) | **NEXT SUPÉRIEUR** (Next affiche la répartition complète déjà reçue, jamais exploitée par Legacy sous cette forme ; charge ~200× moins de données, voir rapport LOT 1) | — |
| 2 | Employés (liste) | rendu depuis `db.agents` complet en mémoire | `employees.mjs` (LOT 2), paginé serveur | `GET /drh/employees/page` | **NEXT SUPÉRIEUR** (Legacy télécharge toute la collection ; Next jamais) | — |
| 3 | Dossier 360° | `renderDossiers` + panneaux (`renderAgentCongesPanel`, etc.) | `employee-dossier.mjs` (LOT 3), onglets paresseux | `GET /employees/{id}` + endpoints filtrés | **PARITÉ** (structure équivalente, chargement paresseux en plus) | — |
| 4 | Identité | dans `renderDossiers` | onglet Identité (LOT 3) | `EmployeeOut` | **PARITÉ** | — |
| 5 | Contrats (lecture) | `renderDossiers` | onglet Contrats (LOT 3/4) | `GET /drh/contracts?employee_id=` | **PARITÉ** | — |
| 6 | Nouveau contrat | formulaire Legacy → `db.contratsPersonnel` (JSON, non typé DRH) | absent avant LOT 11B | `POST /drh/contracts` (typé, existe déjà) | **MANQUANT** → fermé LOT 11B | P1 |
| 7 | Avenant | Legacy (`avenants`, JSON libre dans `db`) | absent | **aucun modèle typé** (`Contract`/`GeneratedContract` ne portent pas la notion d'avenant à un contrat existant) | **BACKEND MANQUANT** | P2 (déjà couvert fonctionnellement par "nouveau contrat" qui remplace/complète) |
| 8 | Fin de contrat | formulaire Legacy | absent avant LOT 11B | `PUT /drh/contracts/{id}` (déjà existant, met à jour `end_date`/`status`) | **MANQUANT** → fermé LOT 11B | P1 |
| 9 | Affectations (actuelle) | `renderDossiers` | onglet Affectation (LOT 3/5) | `current_*` dans `EmployeeOut` | **PARITÉ** | — |
| 10 | Historique affectations | `renderAffectationsHistorique` | absent, dette `DRH-NEXT-ASSIGNMENT-HISTORY` | `Assignment` (module `ops`, déjà utilisé en interne par `fiche_position()`) | **MANQUANT** (API composée nécessaire) → fermé LOT 11B | P1 |
| 11 | Pointage (consultation RH) | `renderAgentPointageSituation`, `renderPointageSaisieAuto` | absent | `DailyPresence` (module `ops`) | **MANQUANT** (lecture seule, API composée) → fermé LOT 11B | P1 |
| 12 | Congés | `renderAgentCongesPanel`, `renderCongesStandaloneShell` | onglet Congés (LOT 3/6), demande+validation | `GET/POST /drh/leaves`, approve/refuse | **NEXT SUPÉRIEUR** (RBAC de validation renforcé LOT 11A, absent côté Legacy) | — |
| 13 | Absences | `renderAgentAbsencesPanel` | *non distinct des congés côté backend* | aucun champ/`status` "absence" séparé dans `Leave` (`status` réel observé : `instance/approuve/refuse`) | **VOLONTAIREMENT ABANDONNÉ** : le backend ne distingue pas "absence" de "congé" comme deux entités — même table `Leave`. Créer une distinction fictive côté frontend serait une donnée inventée. | P3 |
| 14 | Maladies | panneau dédié Legacy, `leave_type` libre côté Next | `leave_type` texte libre (LOT 6) couvre déjà le cas ("maladie" saisi comme type) | `Leave.leave_type` (texte libre) | **PARITÉ** (le champ libre couvre le besoin ; pas de sous-workflow distinct côté backend) | — |
| 15 | Discipline (lecture) | `renderSanctions` | onglet Discipline (LOT 3/7) | `GET /drh/sanctions?employee_id=` | **PARITÉ** | — |
| 16 | Sanctionner | Legacy | onglet Discipline, création (LOT 7) | `POST /drh/sanctions` | **PARITÉ** | — |
| 17 | Convoquer (disciplinaire) | Legacy (`Convocation`, JSON libre) | absent | **aucun modèle typé** distinct (la seule "convocation" backend réelle est `POST /candidates/{id}/convocation-email`, RECRUTEMENT, pas discipline) | **BACKEND MANQUANT** | P2 |
| 18 | Suspendre | Legacy (état `db.agents`) | `Sanction.suspension_days` (déjà un champ réel du modèle typé, LOT 7) | `Sanction` | **PARITÉ** (la suspension est un attribut de sanction, pas une entité séparée côté backend — cohérent) | — |
| 19 | Mise en demeure | Legacy (JSON libre) | absent | **aucun modèle typé** | **BACKEND MANQUANT** | P2 |
| 20 | Période E-N-C | Legacy (workflow `gestionEvents`, JSON libre) | absent | **aucun modèle typé** | **BACKEND MANQUANT** | P2 |
| 21 | Blacklist | Legacy (`db.agents[].blacklist`, booléen + JSON libre) | absent | **aucun champ backend** (ni sur `Employee`, ni ailleurs) | **BACKEND MANQUANT** | P1 (impact métier réel : bloque une recontractualisation) mais **nécessite une décision de schéma** (voir §Décisions requises) |
| 22 | Recrutement (liste/recherche) | `db.candidats` en mémoire | absent avant LOT 11B | `GET /drh/candidates/page` (**paginé serveur, q, mode, society, desired_position, recruiter_opinion, sort**) | **MANQUANT** → fermé LOT 11B | P1 |
| 23 | Recrutement (détail/validation) | Legacy | absent avant LOT 11B | `POST /candidates/validate-section`, `/candidates/{id}/validate-final` | **MANQUANT** → fermé LOT 11B | P1 |
| 24 | Recrutement (convocation) | Legacy | absent | `POST /candidates/{id}/convocation-email` (réel, envoi email) | **MANQUANT** → fermé LOT 11B (action déclenchée depuis la fiche candidat) | P1 |
| 25 | Candidat → employé | Legacy (`marquer-contractualisation`) | absent avant LOT 11B | `POST /candidates/{id}/marquer-contractualisation`, `POST /candidates/{id}/recruit` | **MANQUANT** → fermé LOT 11B | P1 |
| 26 | Période d'essai | Legacy | dashboard (LOT 9, libellé corrigé), `EmployeeOut.trial_end_date` | `trial_end_date` | **PARITÉ** | — |
| 27 | Documents (métadonnées + aperçu) | Legacy (`renderDocumentsArchives`, autre module transverse) | onglet Documents (LOT 3/8) | `GET /drh/documents` | **PARITÉ** (métadonnées) | — |
| 28 | Documents (dépôt) | Legacy | absent, dette `DRH-NEXT-DOC-UPLOAD` | aucune route d'upload pour le modèle `Document` générique | **BACKEND MANQUANT** — **lié à un P0 sécurité** (voir §Documents ci-dessous) | P0 (bloquant, non fermé) |
| 29 | Habilitations | Legacy (`habilitations`, JSON libre : diplômes/enquêtes) | absent | **aucun champ/modèle backend**, même pas booléen | **BACKEND MANQUANT** | P2 |
| 30 | Matériel (consultation) | `renderAgentMateriel` | absent | `EmployeeEquipment` (module `materiel`, déjà utilisé en interne par `fiche_position()`) | **MANQUANT** (API composée read-only) → fermé LOT 11B | P1 |
| 31 | Portail RH | module `app/modules/portal/` : auto-inscription, reset mot de passe, pointage QR, statistiques présence — **application autonome mature et volumineuse** | absent, non prévu | `portal` (module séparé, permission dédiée) | **VOLONTAIREMENT ABANDONNÉ (V1)** — voir §Portail RH ci-dessous, décision A retenue | — |
| 32 | Alertes | nav item "Alertes" (Legacy + Next stub) | stub LOT 1 ("non planifié") | aucun agrégat backend dédié | **BACKEND MANQUANT** | P3 |
| 33 | Timeline / Observations / Actions RH | panneaux Legacy composites (assemblage de plusieurs entités JSON) | non répliqué en tant que tel — chaque entité réelle (contrats/congés/sanctions/documents) déjà consultable séparément dans le Dossier 360° | — | **VOLONTAIREMENT ABANDONNÉ** : une "timeline" unifiée mélangerait des entités typées (réelles) et des entités JSON libres (fictives) ; construire une frise à partir de données hétérogènes fabriquerait une donnée. Chaque onglet réel reste la source de vérité. | P3 |
| 34 | Exports | Legacy (export CSV/Excel côté client, depuis `db.agents` en mémoire) | absent | aucune route d'export DRH dédiée | **VOLONTAIREMENT ABANDONNÉ (V1)** : un export nécessiterait soit de télécharger la collection complète (interdit depuis le LOT 2), soit une route d'export serveur dédiée (absente) | P3 |
| 35 | Impressions | Legacy (mise en page HTML imprimable, contrats notamment) | absent | `GET /generated-contracts/{id}/download`, `GET /contract-templates/{id}/download` (existent, non branchés à Next) | **MANQUANT** mais non fermé ce lot (faible usage estimé hors génération de contrat, qui elle-même n'est pas encore dans Next) | P3 |

## Décisions résolues automatiquement (§3 de la mission)

- **Absences vs Congés (#13)** : source canonique unique (`Leave`), aucune ambiguïté — résolu (pas de distinction fabriquée).
- **Avenant (#7), Convocation disciplinaire (#17), Mise en demeure (#19), Période E-N-C (#20), Habilitations (#29)** : tous **BACKEND MANQUANT** sans modèle typé existant. Concevoir un schéma pour chacun est une décision de conception de données (champs, relations, cycle de vie) — non une ambiguïté entre deux comportements également plausibles. Résolu : **reportés**, documentés comme dette P2, non bloquants pour la bascule V1 (aucun n'est une question de sécurité ni de perte de données).
- **Portail RH (#31)** : décision A (reste autonome) retenue automatiquement — le module `portal` est un ensemble de flux libre-service (auto-inscription, réinitialisation de mot de passe, pointage QR) fonctionnellement disjoint d'un cockpit d'administration RH ; l'auditer a confirmé qu'aucune de ses routes n'est un besoin d'administration DRH manquant (les comptes/DRH gèrent déjà les utilisateurs via `/auth/users`, existant, hors périmètre Next). Non une ambiguïté nécessitant une décision de direction.
- **Timeline/Observations/Actions RH (#33), Exports (#34)** : résolus automatiquement (voir justifications dans le tableau) — construire l'un ou l'autre fabriquerait une donnée ou violerait l'interdiction "aucun full download".

## Décision NON résolue automatiquement — nécessite un arbitrage produit

- **Blacklist (#21)** : impact métier réel (bloque une recontractualisation), mais **deux implémentations sont également plausibles et incompatibles** sans schéma canonique : (a) un simple booléen sur `Employee` (mirroring `EmployeeBase.locked`, déjà un entier 0/1 similaire), suffisant si le besoin est "empêcher toute réembauche" ; (b) un enregistrement horodaté avec motif/auteur/date (mirroring `Sanction`), nécessaire si le besoin inclut un historique/audit de la décision. Le choix engage une règle métier durable (à quoi ressemble une liste noire dans ce contexte RH) — **décision de direction requise avant implémentation**, non tranchée ici.

## §Documents — P0 non fermé (bloquant bascule)

`DRH-NEXT-DOC-URL-AUTH` **confirmé démontrable en direct** (LOT 11, reconstruction Docker) :
```
$ curl http://<host>/uploads/photos/docs/secret.txt   # AUCUN header Authorization
→ 200, contenu servi intégralement
```
`app.mount("/uploads", StaticFiles(...), name="uploads")` (`app/main.py`) ne porte aucune
dépendance d'authentification — un montage ASGI (`app.mount`) ne passe pas par le système de
`Depends()` des routes classiques. Ce mount est **partagé par tout l'ERP** (photos employés,
documents DRH, et potentiellement d'autres modules), pas spécifique à DRH Next — confirmé par
`app/main.py:835` (`photo.startswith(("data:image/", "/uploads/"))`, utilisé hors DRH).

**Non corrigé dans cette mission** : remplacer ce mount par une route authentifiée (proxy avec
vérification de session, ou URLs signées à expiration) est un changement d'architecture
transverse à tout l'ERP, avec un rayon d'impact dépassant largement DRH Next — photos,
templates de contrats, et tout autre usage existant de `/uploads/*`. Le concevoir et le
déployer sans casser ces usages existants exige une revue backend dédiée, hors périmètre
sûr d'un lot frontend. **`DRH-NEXT-DOC-UPLOAD` reste donc également non fermé** : construire
un dépôt de documents au-dessus d'un chemin de lecture non authentifié aggraverait
l'exposition (plus de documents sensibles rendus accessibles par URL nue).

**Conséquence directe (§25 de la mission)** : "documents sûrs" est une condition de GO pour la
bascule finale — cette condition **n'est pas remplie**. Voir verdict final.

## Prochaine mise à jour
Ce document est mis à jour après LOT 11B (fermeture des P1 sûrs) et LOT 11C (revue finale,
matrice sans P0 ni P1 non tranché autre que Blacklist, explicitement transférée à une
décision produit).
