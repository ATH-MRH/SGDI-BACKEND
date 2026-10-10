# IRON Emploi — annonces, espace candidat et candidatures

Ce document décrit la partie serveur du portail emploi : ce qui est exposé, à qui, et comment
le mettre en service. L'application mobile est dans `mobile/recruitment` ; les codes SMS sont
décrits dans [recruitment-smsgate.md](recruitment-smsgate.md).

## 1. Vue d'ensemble

```
Recruteur (recrute.irongs.com) ── crée / publie / clôture ──> annonces
Candidat (application IRON Emploi) ── lit les annonces ouvertes, sans connexion
Candidat identifié par SMS ── profil, documents, candidatures ──> dossier du vivier recrutement
```

- Une **annonce** appartient à une **société**. Elle est en brouillon, publiée ou clôturée.
- Le public ne voit que les annonces **publiées et non expirées** (date limite incluse, heure d'Alger).
- Un **espace candidat** est rattaché à un numéro de téléphone vérifié par SMS.
- Une **candidature** relie le dossier du candidat à une annonce, ou à aucune (candidature spontanée).
- Un candidat a **un seul dossier** et un seul profil dans le vivier : postuler à une deuxième
  annonce complète ce dossier au lieu d'en créer un autre.
- Chaque **candidature à une annonce a son propre état**, décidé par le recruteur de l'annonce :
  reçue, présélectionnée, entretien, retenue, non retenue. Le refus d'une candidature ne change ni
  les autres candidatures du candidat, ni son dossier.
- Une candidature **spontanée ou historique** n'est rattachée à aucune annonce : son suivi reste
  celui du dossier, comme avant.

## 2. Données (migration `20261012_0001`)

Cinq tables nouvelles, aucune table existante modifiée :

| Table | Rôle |
|---|---|
| `recruitment_companies` | Société qui publie. `society` porte le périmètre des recruteurs ; `kind` (`group`) prépare l'ouverture à d'autres entreprises. |
| `recruitment_job_offers` | Annonce : poste, métier, wilaya, lieu, contrat, missions, profil, date limite, état. |
| `recruitment_candidate_accounts` | Espace candidat : téléphone vérifié, profil, CV, photo, dossier rattaché. |
| `recruitment_candidate_sessions` | Sessions de l'espace candidat (empreinte du jeton, 30 jours). |
| `recruitment_applications` | Candidature : dossier, annonce éventuelle, identifiant d'envoi, état propre (`status`, date et auteur du dernier changement). |

Les candidatures historiques et spontanées restent dans `candidates`, inchangées.

## 3. API publique — `/api/public/emploi`

Sans authentification :

| Route | Contenu |
|---|---|
| `GET /config` | Version de l'API, disponibilité du SMS, formats de CV. |
| `GET /offers` | Annonces ouvertes. Filtres `q`, `wilaya`, `profession`, `contract_type`, `company_id` ; pagination ; valeurs de filtre disponibles. |
| `GET /offers/{id}` | Détail d'une annonce ouverte. Brouillon, clôturée, expirée ou inconnue : `404`, sans distinction. |
| `GET /companies`, `GET /companies/{id}` | Sociétés ayant publié, et leurs annonces ouvertes. |

Ces routes ne renvoient aucune donnée de candidat, ni aucun champ interne (auteur, état, compteurs).

Avec la session de l'espace candidat (`Authorization: Bearer …`) :

| Route | Contenu |
|---|---|
| `POST /session` | Échange l'accès court délivré par `/api/public/mobile/verify-code` contre une session de 30 jours. |
| `DELETE /session` | Déconnexion. |
| `GET /me`, `DELETE /me` | Espace du candidat ; suppression de l'espace et de ses documents. |
| `PUT /me/profile` | Profil réutilisable (mêmes champs que le formulaire de candidature). |
| `PUT / GET / DELETE /me/cv` | CV PDF, JPG ou PNG, 5 Mo au plus. |
| `PUT / GET / DELETE /me/photo` | Photo d'identité (JPEG). |
| `POST /applications` | Candidature à une annonce (`offer_id`) ou spontanée. |
| `GET /applications`, `GET /applications/{id}` | Candidatures du candidat, chacune avec son état. La liste donne aussi l'état du dossier (`dossier`), qui porte une éventuelle convocation. |

Règles appliquées par le serveur :

- Une annonce clôturée ou expirée refuse la candidature **au moment de l'envoi** (`409`), même si
  elle était ouverte à l'affichage.
- Chaque envoi porte un `request_id`. Le rejouer (double appui, relance réseau) renvoie la même
  candidature. Postuler une seconde fois à la même annonce renvoie la première (`200`,
  `already_applied`).
- Un candidat ne lit et ne modifie que son espace ; la candidature d'un autre répond `404`.
- Un jeton de recruteur n'ouvre pas l'espace candidat, et inversement.
- Un numéro déjà rattaché à un espace n'en ouvre pas un autre sous un nom différent (`409`).
- L'état d'une candidature à une annonce est le sien (`state`). Pour une candidature spontanée ou
  historique, c'est celui du dossier, calculé par les mêmes règles que le suivi existant.

## 4. API recruteur — `/api/drh/job-offers`

Compte recrutement ou DRH requis (mêmes modules que `/api/drh/candidates`). Un recruteur ne voit
et ne modifie que les annonces des sociétés de son périmètre ; hors périmètre, la réponse est `404`.

| Route | Action |
|---|---|
| `GET /meta` | Sociétés du périmètre, types de contrat, logos disponibles. |
| `GET` · `POST` | Liste (avec nombre de candidatures) · création en brouillon. |
| `GET /{id}` · `PUT /{id}` | Lecture · modification. |
| `POST /{id}/publish` | Publication (champs obligatoires renseignés, date limite non dépassée). |
| `POST /{id}/close` | Clôture. |
| `DELETE /{id}` | Suppression d'un brouillon sans candidature (DRH). |
| `GET /{id}/applications` | Candidatures reçues pour l'annonce, avec l'état de chacune et, à part, l'état du dossier. |
| `PUT /{id}/applications/{candidature}/status` | Change l'état d'une candidature de cette annonce. |
| `GET /companies` · `PUT /companies/{id}` | Fiches des sociétés du périmètre. |

Création, modification, publication, clôture, suppression et changement d'état d'une candidature
sont inscrits au journal d'audit.

Dans recrute.irongs.com, la section « Annonces » utilise ces routes. Les annonces que l'ancienne
version gardait dans le navigateur ne sont plus affichées comme publiées : un bouton propose de
les importer en brouillon.

## 5. Compatibilité avec l'application déjà distribuée

- Les routes `/api/public/mobile/…` et `/api/public/candidates/…` sont inchangées : l'application
  actuelle continue de fonctionner après le déploiement.
- Un dossier déjà déposé avec un téléphone vérifié est rattaché à l'espace candidat ouvert ensuite
  avec ce même numéro et ce même nom.
- La nouvelle application détecte l'absence de `/api/public/emploi/config` et se limite alors à
  la candidature spontanée par le parcours existant.

## 6. Traitement des candidatures (migration `20261013_0001`)

La révision `20261013_0001` complète la précédente sans la modifier : colonnes ajoutées aux
sociétés, aux espaces candidats et aux candidatures, et onze tables (messages, entretiens, pièces
de candidature, demandes de pièces, notes internes, historique, contrat, conseils, alertes,
notifications, appareils).

### Trois informations distinctes par candidature

| Information | Valeurs | Vue par le candidat |
|---|---|---|
| Étape de traitement (`stage`) | réception, examen, présélection, convocation, entretien, décision, dossier d'embauche, préparation du contrat, signature, recrutement effectif | seulement sous la forme simplifiée « reçue / en cours d'examen / présélectionnée / entretien » |
| Résultat (`outcome`) | en attente, favorable, non retenue, retirée | uniquement après « Communiquer au candidat » |
| Contrat | préparé, remis, signé | uniquement si le recruteur choisit de le partager |

Une décision est d'abord interne. Tant qu'elle n'est pas communiquée, l'application continue
d'afficher l'étape en cours. Les notes internes, comptes rendus d'entretien et appréciations ne
sont renvoyés par aucune route publique.

### Pièces

- À l'envoi d'une candidature, le CV et la photo du profil sont **copiés** dans la candidature.
  Remplacer le CV du profil ensuite ne change pas la pièce déjà transmise.
- Les pièces ne sont jamais servies par une adresse publique : `GET
  /api/drh/job-offers/applications/{id}/documents/{doc}` exige la session du recruteur et le
  périmètre de la société, et répond sans mise en cache. La visionneuse de recrute.irongs.com lit
  le fichier avec cette session (PDF intégré, image avec zoom) ; `?download=1` le télécharge.
- Formats acceptés : PDF, JPG, PNG, contrôlés côté serveur (type réel et taille).
- Le recruteur peut demander une pièce complémentaire ; le candidat la dépose depuis l'application
  et elle apparaît avec la provenance « Pièce complémentaire ».

### Entretiens, échanges, notifications

- Un entretien est rattaché à une candidature, proposé par le recruteur (heure d'Alger), confirmé
  par le candidat, puis reporté, annulé ou clos (présent / absent, compte rendu interne). La
  présence ne s'enregistre qu'après l'heure de l'entretien.
- La convocation historique saisie sur le dossier reste affichée ; elle n'est pas dupliquée quand
  un entretien porte la même date.
- Messages : stockés par candidature, avec accusé de lecture et identifiant client qui rend un
  renvoi sans effet (pas de doublon).
- Alertes d'offres (dix au plus par candidat) : une notification est créée à la publication d'une
  annonce correspondante.
- Conseils emploi : rédigés et publiés depuis recrute.irongs.com → Traitement IRON Emploi →
  Conseils emploi ; l'application garde un contenu embarqué si aucun n'est publié.

### Contrat et passage à la DRH

- L'aperçu Word est produit par le service de contrats de la DRH à partir d'un modèle validé. Il
  ne crée ni contrat signé ni fiche employé.
- La signature est une **constatation saisie par le recruteur** (date de signature du document
  papier). Aucune signature électronique n'est proposée, et un contrat généré n'est jamais
  considéré comme signé.
- « Transmettre à la DRH » exige une décision favorable communiquée et une signature enregistrée,
  puis appelle le transfert existant du dossier. Un second appel ne crée rien. La fiche employé
  et le contrat définitif restent créés par la DRH, avec ses contrôles de doublons.

### Notifications push

Le serveur enregistre les appareils et les préférences, et sait relayer vers le service Expo,
mais l'envoi est **désactivé** tant que `RECRUITMENT_PUSH_ENABLED=true` n'est pas posé. Rien
n'a été essayé sur un téléphone. L'application embarque le module de notifications (autorisation,
enregistrement de l'appareil, ouverture de l'écran concerné, désinscription à la déconnexion), mais
l'activation demande encore un identifiant de projet EAS, les accès FCM (Android) et APNs (iOS) et
une version installable : le détail est dans `mobile/recruitment/README.md`.
Les notifications dans l'application, elles, fonctionnent sans réglage.

## 7. Mise en service

1. Fusionner la branche serveur ; le déploiement applique `alembic upgrade head`
   (révisions `20261012_0001` puis `20261013_0001`).
2. Vérifier `GET https://recrute.irongs.com/api/public/emploi/config`.
3. Dans recrute.irongs.com → Annonces : créer une annonce, la publier, la vérifier dans
   `GET /api/public/emploi/offers`.
4. Dans recrute.irongs.com → Traitement IRON Emploi : vérifier le tableau de bord.
5. Distribuer la nouvelle application.

Aucune variable d'environnement obligatoire. `RECRUITMENT_PUSH_ENABLED` est facultative et reste
à `false`. Les réglages SMSGate ne changent pas.

Retour arrière : `alembic downgrade 20261012_0001` retire le traitement des candidatures ;
`alembic downgrade 20261011_0001` retire aussi annonces, espaces candidats et candidatures. Les
dossiers du vivier ne sont pas touchés.

## 8. Limites de cette version

- Les candidatures spontanées et historiques suivent l'état du dossier, pas un état par annonce.
- Les sociétés sont celles du groupe ; l'inscription d'entreprises tierces n'est pas développée.
- Notifications push non activées (voir ci-dessus).
- L'envoi de la convocation par e-mail dépend du canal e-mail existant ; sans configuration, seule
  la notification dans l'application est émise.
- L'indication « en ligne » n'est pas affichée dans les échanges : la présence n'est pas mesurée.
