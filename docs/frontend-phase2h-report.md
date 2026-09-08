PHASE 2H — rapport final, 8 septembre 2026

Objectif atteint : **19 993 lignes** dans `sgdi-app.js`. Arrêt des extractions dès le passage sous 20 000 lignes, conformément à la consigne. Aucune recherche supplémentaire du seuil souhaité de 17 500 lignes.

Branche : `refactor/frontend-phase2b-2g`. Worktree isolé : `/private/tmp/ATLAS-phase2b-2g`.
HEAD de départ vérifié : `c5d7dc8f16049d57a8222aefd6d48d97525699b3` ; worktree propre, 27 192 lignes.
HEAD final du code audité : `f8767cbd0313df5e701a6fe091808dfa2a8666e7`. Le commit documentaire qui contient ce rapport ne change pas le code ; son hash de livraison est fourni dans le compte rendu final.

**Mesures**

| Mesure | Départ | Code final | Réduction |
|---|---:|---:|---:|
| Lignes du monolithe | 27 192 | 19 993 | 7 199 (26.47 %) |
| Octets du monolithe | 2 179 859 | 1 546 552 | 633 307 (29.05 %) |
| Octets gzip du monolithe | 592 992 | 449 190 | 143 802 (24.25 %) |
| Octets JS externes du bootstrap principal | 2 253 667 | 1 628 603 | 625 064 (27.74 %) |

Mesure gzip déterministe au niveau 9. Bootstrap : somme des fichiers JS locaux référencés par `script[src]` dans `index.html`, sans compression, sans compter les scripts inline ni les modules chargés à la demande. Ce sont des tailles de sources, pas des mesures réseau ou de latence.
Le nombre de scripts lazy passe de 26 à 36. `core/files.js` ajoute une requête statique commune et environ 8 Ko déplacés depuis le monolithe ; aucun appel API, polling ou timer global n’est ajouté au bootstrap. Le gain global de chargement initial est favorable.

**Commits atomiques de code**

| Commit | Changement | Lignes après | Frontend complet |
|---|---|---:|---:|
| `977f1a4` | Sites | 24 877 | 198/198 |
| `14d0ddd` | Incidents | 24 729 | 199/199 |
| `f920385` | Facturation | 23 166 | 200/200 |
| `dcba513` | Commercial | 21 675 | 201/201 |
| `b272df1` | Agenda | 21 472 | 202/202 |
| `8378310` | Portail/Demandes | 20 830 | 203/203 |
| `f289c34` | Positions/Badges | 20 076 | 204/204 |
| `f8767cb` | Documents partagés et entrées autonomes | 19 993 | 208/208 |

Les messages exacts et hashes complets, ainsi que les octets/gzip après chaque commit de code, figurent dans [frontend-phase2h-measures.json](frontend-phase2h-measures.json). Le commit documentaire final conserve les mesures du dernier commit de code.

**Modules et dépendances**

| Groupe validé | Fonctions déplacées | Fichiers | Collections db directement référencées |
|---|---:|---|---|
| sites | 150 | `sites.js`, `sites-1.js` | `agents`, `clients`, `demandesPersonnel`, `demandesStructure`, `incidents`, `magasins`, `sites`, `stockArticles`, `stockMouvements` |
| incidents | 9 | `incidents.js` | `agents`, `incidents`, `sites` |
| facturation | 85 | `facturation.js`, `facturation-1.js` | `avances`, `avoirs`, `caisse`, `categoriesPrest`, `clients`, `devis`, `factures`, `missionBillables`, `paiements`, `parametres`, `stockArticles`, `stockMouvements`, `structures`, `themes` |
| commercial | 71 | `commercial.js`, `commercial-1.js` | `calTaches`, `catalogue`, `clients`, `devis`, `opportunites`, `prospects`, `visites` |
| agenda | 17 | `agenda.js` | `agendaEvents`, `users` |
| portal | 47 | `portal.js` | `agents`, `assignments`, `demandesPersonnel` |
| positions | 55 | `positions.js` | `agents`, `documentTemplates` |
| Documents partagés | 8 | `core/files.js` | Aucune |

434 fonctions de domaines et 8 fonctions partagées déplacées. Les accès indirects via les helpers communs restent ceux du socle historique. Aucun `db` global supprimé.

- Agenda est une dépendance explicite de Secrétariat : chargée une fois, sans initialisation concurrente de route inutile.
- Positions est une dépendance explicite de Matériel et Administration ; ces parents nettoient les interactions de badge à leur sortie et lors de leurs changements de sous-vue.
- `core/files.js` contient uniquement les huit fonctions partagées de compression, téléversement, aperçu et impression, déplacées verbatim. Aucun nouveau fichier géant de helpers.
- `index.html`, `facturation.html`, `paie.html` et `conges.html` chargent le registre, les documents partagés puis le monolithe avec la version `20260908-phase2h-files`. Les modules utilisent la même version au chargement lazy. Aucun module de domaine n’est inclus au bootstrap HTML.

**Parties conservées ou reportées**

La gestion métier des photos candidat/employé (`handlePhotoUpload`), les styles de dotation, les helpers de périmètre/société/site, les notifications et compteurs partagés restent synchrones. Le traitement partagé des demandes structure reste dans le socle. Les routes accounting/achats/ventes/reporting restent dans leur fichier ERP historique. Les fonctions communes de clients/commercial ne sont pas déplacées arbitrairement dans un domaine. La vérification publique des badges et ses dépendances restent disponibles sans charger Positions.
L’analyse initiale et le classement final sont dans [frontend-phase2h-analysis.json](frontend-phase2h-analysis.json). Les fonctions retenues, collections, API et ressources de chaque extraction figurent dans [frontend-phase2h-inventory.json](frontend-phase2h-inventory.json). Le fichier [frontend-phase2h-shared-files.json](frontend-phase2h-shared-files.json) documente le socle documentaire.
Les déclarations globales et bridges `window` nécessaires aux appels synchrones et `onclick` inline sont conservés. Aucune suppression spéculative de global. Les références window/onclick et dépendances sont cartographiées dans l’analyse.

**Validation finale**

- Frontend complet : **208/208**, `NODE_PATH="/Users/ath/Downloads/ATLAS 1/node_modules" npm test`.
- Backend complet : **550 réussis, 14 ignorés**, pytest exécuté dans un répertoire temporaire avec SQLite et configuration de test imposée par `tests/conftest.py` ; aucune base de production.
- Tests ciblés par extraction verts : Sites, Incidents, Facturation, Commercial, Agenda, Portail/Demandes, Positions/Badges ; 21 tests Facturation/calculs et 20 tests registre/routeur exécutés lors des extractions concernées.
- Documents partagés : **2/2** ; entrées autonomes et parcours demandé : **2/2** lors de la dernière exécution ciblée.
- Parcours Dashboard → Sites → Incidents → Dashboard → Facturation → Commercial → Agenda → Portail → Fiches → Badge → Administration → Pointage → OPS → Matériel → DRH → Dashboard répété **trois fois**, avec transitions directes.
- Campagne complémentaire de toutes les routes répétée trois fois, deep links isolés, précédent/suivant, registre absent, cache/déduplication et navigation rapide verts. Aucun téléchargement de module en double ni erreur non contrôlée dans ces tests.
- Vérification des formulaires et ressources : nettoyage cartes/listeners, délai de recherche, brouillon Facturation sauvegardé avant remplacement du DOM, ancien statut de sauvegarde isolé du nouveau formulaire, recadrage badge conservé à la sortie. Les réponses tardives contrôlées ne remplacent pas l’écran courant.
- Syntaxe : **72 fichiers JS conformes** (`app/static` et `tests_frontend`).
- Comparaison AST avec la base : **3 074 fonctions historiques**, aucune disparition/duplication ni modification inattendue. Les formules financières sont conservées ; les adaptations de corps sont limitées au routage et au cycle de vie UI listés dans [frontend-phase2h-lifecycle-changes.json](frontend-phase2h-lifecycle-changes.json).
- `git diff c5d7dc8 --check` et contrôle du diff indexé conformes. Diff limité au frontend, tests, commande de test package et documentation. Aucune dépendance npm ajoutée.
- Aucun backend, migration, droit, règle de sécurité, lot 0.6, secret ou artefact local ajouté/modifié dans cette branche. Aucun push, merge, rebase, squash, déploiement ou accès production.

**Deux revues indépendantes**

Revue A : registre, dépendances, navigation, Sites/Incidents/Agenda/Portail et bootstrap. Revue B : Facturation/Commercial, brouillons, Positions/Badges, dépendances intermodules et documents partagés. Les deux ont identifié le même défaut des entrées autonomes HTML : absence du registre et du nouveau socle documentaire. Les trois HTML concernés ont été corrigés ; les tests lisent désormais leurs scripts réellement déclarés, sans injecter implicitement les dépendances manquantes. Les deux contre-revues indépendantes ont confirmé la correction et donné un avis favorable, sans autre blocage identifié.
Les revues sont restées en lecture seule. La suite globale a ensuite terminé à 208/208 ; le code livré correspond à cet état revu et testé.

**Limites et risques restants**

La navigation est validée avec de vrais scripts classiques séparés dans jsdom et des réponses réseau simulées. Les impressions sont contrôlées au niveau du document généré et de l’appel d’impression ; aucun périphérique réel, caméra, navigateur graphique ou environnement de production n’a été testé. Le premier accès à un module lazy nécessite son téléchargement ; la disponibilité hors ligne dépend du cache existant. Les globals, handlers inline et helpers métier transverses conservés restent une dette connue, cartographiée, sans nouveau blocage établi.
Le worktree local `main` est resté à `cdcdf73f16d84e767fe698b1753406d08d58d9f3`, avec ses 13 changements préexistants. Aucun checkout, stash, reset, clean ou écriture n’y a été effectué. Le contrôle final compare statut et empreinte du diff au relevé de préservation.

**OBJECTIF <20K ATTEINT — PRÊT POUR REVUE HUMAINE**
