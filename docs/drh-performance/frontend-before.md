# DRH — mesures navigateur avant corrections

Référence produit : `7041c27f477b5e24d8bb5509ca8d6bbf45c8edab`. Trois navigations réelles successives dans Chromium, sur la même fixture SQLite synthétique (1 000 employés, 500 candidats, 50 sites). Le proxy de mesure remet à zéro les caches mémoire backend avant chaque première ouverture. La navigation chaude revient au dashboard depuis Employés dans le même document.

Les trois rapports bruts `browser-before-{1,2,3}.json` ont exactement le même SHA-256 d'observateur, 13 réponses HTTP 200 et aucune erreur. La synthèse reproductible est `frontend-before-summary.json`; le programme d'agrégation est `scripts/perf/frontend-summarize.py`.

| Mesure | Première ouverture DRH | Ouverture Employés | Retour chaud DRH |
|---|---:|---:|---:|
| Premier affichage observé, médiane | 1 234,2 ms | 1 885,1 ms | 156,5 ms |
| Minimum–maximum | 1 077,2–1 977,4 ms | 1 864,4–1 977,5 ms | 142,8–162,3 ms |
| Dernière activité, médiane | 1 523,6 ms | 1 999,5 ms | 272,6 ms |
| Fetch / XHR | 13 / 0 | 0 / 0 | 0 / 0 |
| Corps JSON reçus | 5 081 011 octets | 0 | 0 |
| Plus grosse réponse | Employés : 1 805 093 octets | — | — |
| JavaScript téléchargé | 1 785 040 octets | 49 578 octets | 0 |
| Parsing JSON | 15,6 ms | 0 | 0 |
| Construction `innerHTML` | 6,7 ms | 30,1 ms | 54,2 ms |
| Affectations `innerHTML` observées | 7 | 574 | 2 |
| Éléments DOM créés par ces affectations | 774 | 9 800 | 257 |
| Lignes de table affichées | 0 | 572 | 0 |
| Éléments dans la vue finale | 254 | 9 797 | 254 |
| Images / documents demandés | 0 / 0 | 0 / 0 | 0 / 0 |
| Timers démarrés, y compris délais ensuite annulés | 62 | 8 | 6 |
| Employés / candidats en mémoire | 1 000 / 500 | 1 000 / 500 | 1 000 / 500 |

Les durées de réseau ci-dessous sont les médianes de toutes les occurrences du même endpoint dans les trois premières ouvertures. Les tailles sont celles d'une réponse, pas leurs cumuls. « Bloquant » décrit la dépendance attendue par le bootstrap, établie à partir de l'appelant enregistré et de la source; cela ne se déduit pas simplement de la date de fin de la requête.

| Endpoint | Appels par ouverture | Statut | Durée | Octets/réponse | Parsing | Appelant | Bloquant |
|---|---:|---:|---:|---:|---:|---|---|
| `/api/irongs/db?light=1` | 1 | 200 | 258,7 ms | 934 436 | 4,4 ms | `sgdiPullState` → `bootApp` | oui |
| `/api/irongs/events/ticket` | 1 | 200 | 192,7 ms | 156 | <0,1 ms | `sgdiStartEventStream` | non |
| `/api/version` | 2 | 200 | 98,1 ms | 26 | <0,1 ms | `sgdiScheduleAutoRefresh` | non |
| `/api/ui/sidebar-stats` | 3 | 200 | 96,5 ms | 2 487 | 0,1 ms | sidebar ×2, statistiques DRH ×1 | non |
| `/api/auth/users` | 1 | 200 | 13,5 ms | 424 | <0,1 ms | `sgdiLoadAuthState` | oui |
| `/api/auth/access-rules` | 1 | 200 | 11,2 ms | 2 | <0,1 ms | `sgdiLoadAuthState` | oui |
| `/api/drh/employees` | 2 | 200 | 182,85 ms | 1 805 093 | 4,25 ms | synchronisation SQL, puis `sgdiEnsureEmployeesForDisplay` | premier oui, second non |
| `/api/drh/candidates` | 1 | 200 | 68,6 ms | 528 193 | 0,5 ms | `sgdiSqlSyncTasks` | oui |
| `/api/irongs/positions` | 1 | 200 | 58,3 ms | 101 | <0,1 ms | timer `refreshPositions` | non |

La première injection de module commence à 990,8 ms en médiane, après le portillon global `sgdiFullDataReady`. Les téléchargements des trois scripts DRH/dashboard/congés totalisent 35,8 ms; l'initialisation de module est presque nulle. La lenteur observée vient principalement du chargement préalable et des traitements de page, plutôt que du téléchargement du petit module DRH.

## Attribution de la navigation Employés

Les fonctions ci-dessous sont imbriquées : ne pas additionner leurs durées inclusives. « Lignes affichées » compte les `tbody tr` de la vue finale. « Éléments DOM créés » compte les descendants construits par chaque affectation `innerHTML` observée : cela inclut des reconstructions et ne représente ni des employés distincts ni tous les nœuds créés par toutes les API DOM. Le temps `innerHTML` mesure seulement le setter natif; `renderView` inclut génération du HTML, normalisation et certaines lectures/écritures déclenchant le layout. Le premier affichage et la stabilisation incluent aussi les traitements différés, la disponibilité de la boucle événementielle et les frames.

| Fonction | Appels | Durée synchrone médiane |
|---|---:|---:|
| `applyLanguagePreference` | 1 | 887,1 ms |
| `renderView` | 2 | 428,7 ms |
| `stripCryptogrammes` | 3 | 84,1 ms |
| `renderEffectif` | 1 | 54,4 ms |
| `sgdiApplyActiveEmployeeStyles` | 3 | 39,6 ms |
| `uiEnhanceView` | 1 | 25,2 ms |
| `normalizeCentralPage` | 1 | 23,4 ms |
| `effectifListHTML` | 1 | 12,2 ms |

Le premier rapport attribue également 355,5 ms de calcul forcé de style/layout au callback de chargement qui appelle `renderView`; la lecture explicite `view.offsetWidth` dans `uiEnhanceView` représente seulement 8,8 ms. Une autre longue frame dure 1 053,2 ms et comprend le parcours de traduction de 881,4 ms. Ces données distinguent la création HTML, le traitement JavaScript et le travail de rendu du navigateur.

Le relevé de ressources contient `tailwind.min.css` (22 203 octets), mais aucun JavaScript Tailwind. Aucun coût ni gain ne doit donc être attribué à un MutationObserver Tailwind dans cette campagne. Le nettoyage global `stripCryptogrammes` possède en revanche un observateur identifié dans la source.

La source confirme que la traduction relit le mode et trie le dictionnaire pour chaque texte, puis recommence les mêmes substitutions pour les textes répétés. `normalizeCentralPage` réaffecte également le HTML de chaque bouton, même lorsque son contenu nettoyé est identique. Ces deux coûts doivent être vérifiés après correction avec le même nombre de lignes et les mêmes textes visibles.

## Snapshot et sous-domaines : inventaire statique

Aucun Proxy de lecture de `db` n'a été ajouté au benchmark : les dépendances suivantes viennent de l'examen de la source, et non d'une mesure dynamique d'accès aux propriétés. L'observateur de performance reste inchangé.

| Consommateur | Collections / données consultées | Rôle |
|---|---|---|
| `renderDRHDashboard` et `drhAgentsList` | `agents`, `conges`, `sites`, `incidents` | Effectif, séries mensuelles, congés, répartition par site, alertes |
| `drhDemandesPersonnelList` | `demandesPersonnel`, `agents` | Demandes en attente, société résolue depuis l'agent |
| `employeeLatestContractEndDate` | `contrats`, `contratsPersonnel` | Échéance contractuelle, combinée aux dates de la fiche employé |
| Filtrage utilisateur et configuration | `users`, `settings`, configuration des sociétés | Périmètre existant, menus et règles de présentation |
| Shell partagé / sidebar / notifications | notamment `candidats`, `workflowTasks`, `echanges`, `demandesStructure` | Compteurs de réserve, tâches, messages non lus, demandes reçues |
| Hydratation / copie de référence / cache de démarrage | toutes les propriétés reçues | Normalisation et conservation de l'état; ces lectures ne prouvent pas qu'une collection est nécessaire au calcul du dashboard |

Dans cette fixture, les collections legacy peuplées `pointages`, `missions`, `messages`, `secretariatNotes` et `devis` sont présentes dans le snapshot léger mais n'alimentent pas directement les calculs étudiés du dashboard DRH. `workflowTasks` reste nécessaire aux notifications partagées. L'absence d'une lecture directe dans le dashboard ne démontre pas l'inutilité dans tous les écrans, alertes ou écritures globales : aucune suppression frontend de ces collections ne doit être déduite de cet inventaire seul.

Les collections SQL `agents`, `employees`, `candidats`, `sites`, `assignments`, `affectations`, `feuillePresence`, `clients`, `magasins`, `fournisseurs`, `stockArticles`, `stockMouvements`, `factures`, `paiements`, `avances`, `avoirs`, `caisse`, `opsMouvements`, `incidents`, `contrats` sont renvoyées vides par `light=1`. Le bootstrap remplit ensuite séparément tous les employés et candidats. Avant correction, la requête SQL du snapshot matérialise néanmoins les anciennes lignes de ces collections avant de les ignorer côté Python : voir les mesures backend et le probe SQL.

Le snapshot global complet n'est pas appelé lors de cette ouverture : seul `/api/irongs/db?light=1` apparaît. Il reste une dépendance attendue. Ni une page d'employés ni les statistiques serveur actuelles ne remplacent toutes les données nécessaires aux séries, aux échéances et aux actions RH.

| Sous-domaine | Chargement observé à l'ouverture DRH |
|---|---|
| Employés | Liste complète de 1 000 employés, deux fois; aucun `/employees/page` |
| Recrutement | Liste complète de 500 candidats |
| Postes | `/api/irongs/positions`, 101 octets |
| Statistiques | `/api/ui/sidebar-stats`, trois fois |
| Contrats / documents / sanctions / templates | Aucun endpoint dédié appelé; informations de fiche ou état legacy déjà en mémoire |
| Congés | Aucun endpoint dédié; script `leaves` chargé comme dépendance DRH, état legacy disponible |
| Photos / avatars / pièces jointes | Aucun téléchargement constaté dans cette fixture sans photos |

La page Employés ne fait aucun fetch supplémentaire car les 1 000 fiches sont déjà chargées. Elle construit les 572 lignes « actifs ». Les écarts de filtres/recherche/tri entre ce rendu et `/employees/page` sont documentés dans `../drh-performance-inventory.md`; remplacer simplement le référentiel global par une page modifierait le comportement actuel.

## Limites et précautions de lecture

- Mesures locales synthétiques, sans latence Internet ni débit contraint; elles ne constituent pas une garantie de temps en production. Le premier run est plus lent : les médianes et les extrêmes sont conservés.
- Le proxy sert les corps décompressés sans compression supplémentaire. Les octets ci-dessus décrivent les payloads bruts observés; les résultats gzip éventuels figurent dans le profil backend, séparément.
- Le premier affichage est une observation DOM suivie de deux `requestAnimationFrame`. La dernière activité exclut les 750 ms de silence utilisés pour constater la stabilisation.
- Les lectures de layout instrumentées exécutent uniquement la lecture native existante. Les enveloppes de mesure ajoutent un léger coût; leur code et leur protocole restent identiques avant/après.
- Les feuilles de polices externes et le flux EventSource permanent sont exclus identiquement. Le service worker est également inactif : le wrapper générique du proxy n’est pas exécutable dans son contexte sans `window`, et l’application ignore cet échec d’enregistrement. Les requêtes PWA/précache sont donc hors mesure; conserver exactement ce protocole pour les trois mesures après. La création du ticket SSE reste mesurée. Les écritures métier sont refusées par le proxy.
- Les timers incluent les délais d'expiration réseau qui sont ensuite annulés. Ce compteur n'est pas un nombre de timers encore actifs à la fin.
- Les parcours automatiques n'ouvrent aucun document et n'effectuent aucune création/modification. Les régressions métier doivent être contrôlées séparément.
