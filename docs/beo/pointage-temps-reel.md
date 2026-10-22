# Pointage temps réel

Lot séparé de la refonte BEO fusionnée dans main (#73). Lecture seule : aucune mutation de paie, de planning, de présence officielle, de clôture ou de correction. Ne pas merger ni déployer avant GO DG.

## Source et API

`GET /api/site-workforce/attendance/live` lit Attendance Core (`AttendanceEvent`, `AttendanceAnomaly`, `DailyPresence`) et les affectations datées. Aucun stockage parallèle, iframe, scraping ou copie locale. Les compteurs entrées/sorties utilisent `attendance.live.summary`, également utilisé par Pointeur, avec des restrictions SQL supplémentaires pour BEO. L’état présent utilise sa règle de dernier passage et de cycle ouvert, y compris les postes traversant minuit. Le GET ne déclenche pas `detect_unclosed` et n’écrit rien.

`resolve_scope` impose les sociétés et sites autorisés. Une jointure corrélée impose aussi une affectation active de l’agent sur le site de chaque événement, anomalie et journée. Société/site forgés sont refusés ; un agent ou curseur hors périmètre ne donne accès à aucune donnée. Les photos sont soumises au champ `identity.photo` existant et chargées via la route authentifiée des fiches de position. Aucun blob biométrique, contenu photo, IP ou identifiant interne de terminal n’est envoyé dans le flux.

Le retour contient `generated_at`, `summary`, `events`, `agents` pour les populations KPI, `next_before_id`, les choix de filtres et `permissions.write=false`. Pagination initiale de 50, maximum serveur de 100. Les événements sont ordonnés par heure décroissante et ID, avec curseur composé pour les heures identiques et pointages antidatés. Les populations sans passage sont paginées par ID agent. Historique du jour limité aux 50 derniers passages et signalé lorsque tronqué.

## Affichage et actualisation

Le bloc live suit le titre « Pointage du personnel », avant les KPI administratifs et les sept onglets existants. Il affiche heure locale `Africa/Algiers`, identité, matricule, poste, structure, site, groupe, mouvement, source réelle et anomalies ouvertes. Le détail peut afficher le libellé de terminal déjà enregistré, limité aux caractères de libellé (aucune IP, URL ou donnée brute). Seuls ARRIVAL et DEPARTURE sont affichés, sous ENTRÉE et SORTIE. Les méthodes proviennent de `AttendanceEvent.source` / `SOURCES` : aucune méthode n’est déduite du terminal. « Enregistré » signifie événement accepté en base, sans prétendre à une validation administrative. « Anomalie » signifie anomalie ouverte liée à l’événement.

Polling toutes les 5 secondes après la fin de la requête précédente ; 10 secondes après échec. Une seule requête de flux à la fois, expiration après 15 secondes, interruption en arrière-plan ou hors ligne. La destruction de la vue annule requête, timers et historique, retire les listeners et déconnecte l’observation des photos. Les réponses d’un ancien périmètre ou filtre sont ignorées. Aucun son ou demande de notification.

Le vert « EN DIRECT » exige une synchronisation fraîche et un événement de moins de 60 secondes. Sans passage récent : « Synchronisé · aucun passage récent », sans vert. Synchronisation de plus de 15 secondes : orange ; plus de 30 secondes, erreur API ou hors ligne : rouge. L’horodatage de synchronisation vient du serveur. L’erreur reste locale au live ; le workspace administratif reste accessible.

Filtres combinables : structure, site, groupe, mouvement, état d’anomalie, source et recherche nom/prénom/code/poste. Raccourcis groupe et KPI de population : présents, absents, retards et non pointés. Les KPI entrées/sorties/anomalies filtrent les événements. Les compteurs décrivent le périmètre + recherche + groupe, avant les filtres événementiels ; cliquer un KPI remplace le filtre de population/mouvement/état et conserve les filtres de contexte.

Les absents sont les agents avec journée « absent ». Les retards sont les agents avec anomalie LATE ouverte du jour. Les non pointés suivent le workspace existant : affectation du jour sans journée renseignée, hors repos connu. Ils ne constituent pas un nouveau calcul d’absence ou de paie. Les populations BEO excluent les agents sans affectation autorisée ; un compteur Pointeur historique incluant ces agents ne représente donc pas le même périmètre.

## Performances et vérification

Les écritures sont inchangées. Lectures groupées, pas de requête SQL par ligne. La recherche d’état courant est bornée à la fenêtre canonique de cycle ouvert. Les champs photo/extra ne sont pas chargés avec toute la population ; seules les photos des résultats sont recherchées, en lot, et chargées au viewport. Le navigateur conserve au maximum 200 événements après « Afficher plus ». Les éléments DOM sont réutilisés ; la feuille mensuelle n’est pas rerendue par le polling. Cache client `no-store` et réponses `Cache-Control: no-store, private` / `Pragma: no-cache`.

Tests dédiés : isolation société/site/agent, multi-sites, lecture sans écriture, recherche et filtres, pagination, curseur étranger, validation des paramètres, photos autorisées/interdites, historique, cohérence des compteurs avec Pointeur et cohérence DailyPresence après véritable entrée/sortie Core. Tests DOM : arrivée/sortie, KPI, déduplication, détails, erreurs locales, hors ligne, onglet caché, nettoyage et 180 cycles simulés (15 minutes à 5 secondes). Test Chrome : entrée et sortie Core visibles sans refresh, zéro débordement de 390 à 1600 px, sept onglets, lecture/écriture administratives préexistantes et refus d’accès intersites.

Les tests utilisent uniquement une base synthétique jetable. Les captures sont conservées comme artefacts locaux, pas comme données de production dans Git. La cohérence a été vérifiée sur ces fixtures ; aucun audit ni rapprochement de données de production n’a été effectué.

## Résultats de validation du 22 octobre 2026

- Backend ciblé final : **34 réussis**, dont 9 tests spécifiques au live, contrôle de lecture sans écriture, non-divergence Core/Pointeur et budget SQL sur 151 agents.
- Frontend complet : **1 352 réussis**, avec Node 22, `--test-force-exit --test-timeout=120000` et autorisation des serveurs HTTP locaux Chrome. Le lancement standard dans le bac à sable rencontrait des refus de ports et deux processus jsdom préexistants restant ouverts ; aucun correctif hors périmètre n’a été introduit pour ces conditions.
- Chrome BEO : **1 scénario réussi**, entrée/sortie automatiques, sept onglets, cohérence administrative, navigation qui arrête le polling puis le relance, captures de 390 à 1600 px. Les identités et photos sont synthétiques.
- Backend complet initial : 2 761 réussis, 201 ignorés, 20 échecs de rendu de badges et 2 erreurs de serveurs HTTP locaux. Les 20 mêmes échecs ont été reproduits sur main sans le lot. Après installation dans `/tmp` des dépendances déjà déclarées (`arabic-reshaper`, `python-bidi`, PDF/QR) et autorisation des serveurs de test locaux, **89 réussis, 3 ignorés** pour tous les groupes concernés. La suite complète n’a pas été relancée une troisième fois ; les tests ciblés ont été relancés sur le code final.
- Contrôles de syntaxe JavaScript/Python et `git diff --check` : OK.

Publication : le contrôle automatique a refusé l’envoi du contenu des 13 fichiers au dépôt GitHub public, faute d’autorisation d’export reconnue. Aucun objet distant, branche distante ou PR n’a été créé. La CI distante reste non exécutée ; aucune fusion et aucun déploiement. Le patch local est prêt pour revue et publication après autorisation explicite.
