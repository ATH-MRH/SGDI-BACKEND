# Recrutement Groupe V7 — vivier central → ventilation société → transfert DRH (4 octobre 2026)

Aucun push, aucun déploiement. Aucune migration : le modèle existant suffit.

## Audit (avant modification)

| Point | Constat |
|---|---|
| Modèle | `candidates` (un dossier par candidat) ; détails métier dans le JSON `data` |
| Société | `candidates.society`, texte libre nullable ; pas de table sociétés |
| Propriété | Vivier déjà commun côté API ; société posée implicitement (entretien favorable, fenêtre « Recruter ») sans action dédiée ni historique |
| Réserve | `status = reserve` + `data.fichePositionValidee` |
| Archives | dossiers archivés **et** dossiers transmis à la DRH (`recruitmentArchivedAt`) |
| Recrutés | onglet « Candidats recrutés » : dossiers `a_contractualiser` ou `embauche` |
| Transfert DRH | `marquer-contractualisation` → `a_contractualiser` → « Contrats à établir » (DRH) |
| Employé / contrat | créés ensemble par la DRH (`POST /candidates/{id}/recruit`), avec verrou de ligne et lien `convertedEmployeeId` / `sourceCandidateId` |
| Audit | aucun sur le changement de société ni sur la transmission |
| RBAC | garde Recrutement + société autorisée ; permissions granulaires centrales non utilisées |

## Règles V7

- **Vivier Groupe** : un candidat existe indépendamment de sa société destinataire (`society`
  vide = NON VENTILÉ). Un seul dossier, jamais de copie par société.
- **Ventilation** (`POST /api/drh/candidates/{id}/ventilation`) : vers une société, réorientation,
  ou retour au vivier Groupe (`society` vide). Même `candidate_id` ; entretiens, avis, documents
  et historique conservés. Chaque changement est historisé dans `data.ventilations`
  (de, vers, date, auteur, motif, contexte) et dans l'audit central
  (`recruitment.candidate.ventilation`). Un changement de société par `PUT` suit la même règle.
- **Permission** : refusée par défaut. Administrateur global, ou permission centrale
  `recruitment / contractualization / update`. Un compte limité ne ventile que vers ses sociétés
  et ne peut pas retirer un dossier à une société hors de son périmètre. Refus audités.
- **Société choisie au recrutement** (11 octobre 2026) : `POST …/transfer-drh` accepte `society`
  pour un dossier NON ventilé. Ce n'est pas la ventilation : c'est le droit de recruter, borné au
  périmètre société du compte, avec les actions générales `create` et `update` explicites (ou la
  permission de ventilation / l'administration globale). La ventilation est enregistrée (contexte
  `recrutement`) et validée avant le transfert ; un dossier déjà ventilé n'est jamais réaffecté
  par ce chemin (`409 SOCIETE_DESTINATAIRE_DEJA_ATTRIBUEE`). `GET …/transfer-options` indique la
  sélection possible : `assigned`, `automatic` (une société), `required` (plusieurs) ou `none`.
- **Sociétés proposées** : périmètre explicite du compte ; pour un périmètre global, sociétés
  réellement connues (comptes, employés, candidats). Aucune liste codée en dur.
- **Recruter = transfert DRH** (`POST /api/drh/candidates/{id}/transfer-drh`) : préconditions
  (société destinataire requise — code `SOCIETE_DESTINATAIRE_REQUISE` ; avis Favorable ; dossier
  non archivé), puis entrée dans le circuit DRH existant « Contrats à établir » de la société
  destinataire. **Aucun employé ni contrat n'est créé au transfert** : la DRH les établit par son
  service existant, inchangé.
- **Atomicité** : une seule transaction ; en cas d'échec rien n'est validé, le dossier reste
  visible, marqué « Transfert DRH à reprendre » (`TRANSFERT_DRH_A_REPRENDRE`), avec « Réessayer ».
- **Idempotence / anti-doublon** : verrou de ligne ; un second appel renvoie le transfert existant
  (clé `candidate-{id}`) et, s'il existe, l'employé lié. `recruit` garde son propre anti-doublon.
- **Trace** : la ligne candidat est conservée (preuve, anti-doublon, lien Candidate → Employee)
  mais exclue de toutes les vues Recrutement : Candidatures, Réserve, Archives, vivier, recherche,
  compteurs. Aucune suppression physique.
- **Archives** : dossiers restés du domaine Recrutement uniquement. Un transféré ou un recruté n'y
  figure jamais.

## Interface (recrute.irongs.com)

- Le sélecteur de société devient un **filtre de portefeuille** : Tous les dossiers, Non ventilés,
  puis les sociétés. Société précise → son logo et son nom ; sinon identité texte neutre
  « RECRUTEMENT GROUPE » (aucun logo Groupe n'existe).
- Action **Ventiler** (menu de ligne et fiche candidat), visible seulement avec la permission ;
  la fenêtre montre la société actuelle, les cibles autorisées, le retour au vivier et l'historique.
- **Recruter** : dossier ventilé → confirmation du transfert à la DRH de sa société. Dossier non
  ventilé → société unique du compte affichée (« sélection automatique »), ou sélecteur
  obligatoire limité aux sociétés du compte ; aucune société → blocage expliqué. Toujours après
  confirmation explicite.
- « Candidats recrutés » disparaît (navigation et onglet). Le tableau de bord remplace l'indicateur
  « Recrutés » par **« Transférés DRH ce mois »** (statistique historique, sans lien vers une liste)
  et le pipeline devient Nouvelles · Présélection · Convoqués · Entretiens · Réserve.

## Comportements retenus (à connaître)

- **Dossier DRH** : le dossier DRH au moment du transfert est le dossier « à contractualiser » de la
  société destinataire ; l'`Employee` naît à l'établissement du contrat par la DRH. Créer un employé
  sans contrat dès le transfert aurait changé les règles DRH (matricule, effectifs, paie).
- **Entretien favorable** : la société choisie en entretien reste une proposition
  (`data.societeRecrutement`) ; elle ne devient la société destinataire que si le compte détient la
  permission de ventilation.
- **Annonces** : stockées dans le navigateur, sans lien avec les candidats ; aucune ventilation
  automatique depuis une annonce.
- **Transférés ce mois** : calculé sur la date du transfert (UTC).
- **Anciens points d'entrée** : `marquer-contractualisation` exécute le même transfert (mêmes
  préconditions) ; `recruit` exige désormais une société destinataire.

## Tests

- `tests/test_recruitment_group_pool_v7.py` (11) : vivier, réorientation Groupe → Sécurité → Groupe →
  Solution, réserve, protection de l'historique, refus par défaut et périmètre, PUT = ventilation,
  préconditions, transfert atomique / idempotent / sortie des vues, reprise après échec, archives,
  périmètre DRH de la société destinataire.
- `tests_frontend/recrute.test.js`, `recrute-favorable-action.test.js` : portefeuille, identité,
  fiche, Ventiler, Recruter, tableau de bord.
- `npm run test:recruitment-responsive-chrome` : responsive V6 conservé (6 écrans × 7 largeurs) et
  parcours V7 complet en Chrome réel.
