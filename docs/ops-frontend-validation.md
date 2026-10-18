# Validation du frontend OPS

Validation du 19 octobre 2026 sur `feat/ops-frontend`. Le commit de départ est `4fada549`, l'état reçu après arrêt de l'autre session est `df2175d0`, et la finalisation fonctionnelle est enregistrée dans `b61a0111`.

Les modifications demandées sont réalisées localement. Aucune nouvelle régression n'a été détectée dans la comparaison complète. La suite conserve deux erreurs de nettoyage asynchrone présentes sur la référence et reste donc en code de sortie 1. Le défaut de navigation initiale du Command Center Sites, également reproduit avant les modifications, reste documenté ci-dessous.

## Modifications réalisées

### Boutons et isolation des styles

Le composant commun `ops-btn` couvre les actions historiques OPS, leurs fenêtres, les liens d'ouverture des employés, les actions du tableau de bord et celles du Command Center Sites. L'adaptation conserve les éléments DOM, handlers, liens, états désactivés et contrôles de formulaire. Les icônes SVG sont décoratives et n'altèrent pas les libellés accessibles.

Les badges des signalements, des filtres avancés et de l'historique des mouvements utilisent leurs données existantes. Un compteur nul ne produit pas de badge, et aucun compteur artificiel n'est ajouté.

La présentation dépend de `body[data-ops-ui]`, activé uniquement pour les modules OPS ou superviseur dans un portail compatible. Les règles du composant et des filtres sont limitées au contenu `#view` et aux fenêtres `#modal-host`. La sortie du module retire l'adaptation automatique. Le rôle superviseur et un ancien `ficheContext=ops` ne suffisent pas à activer les styles en DRH, POINTEUR, BRQ ou RECRUTEMENT. La matrice de tests couvre 48 combinaisons de portail et module, dont les profils superviseurs.

### Tableau des employés

La liste conserve la pagination SQL, les requêtes, la recherche, les tris, les statuts, les actions et les filtres société/site existants. Les colonnes s'adaptent à leur contenu, les dates et matricules restent lisibles, et le défilement horizontal reste contenu dans le tableau. Les actions restent accessibles ; les petits écrans utilisent les cartes existantes.

Les filtres ont une grille responsive, des libellés associés aux champs, un état ouvert/fermé accessible et un badge des filtres avancés actifs. Le nombre de résultats est annoncé dans une zone de statut. Sur les fixtures Chrome, les lignes mesurent environ 50 px en grand écran et 60 px en tablette. Les contrôles à 390, 720, 767, 768, 1024, 1440 et 1920 px ne détectent aucun débordement horizontal du document ou de la vue.

### Surplus

La fiche et la fenêtre des affectés ne répartissent plus les employés selon leur rang ou leur matricule. Tous restent dans la liste des affectés. Un surplus positif affiche son compteur et « Employés en surplus non identifiés individuellement ».

Le calcul reste `max(0, effectif_affecté - effectif_contractuel)`. Zéro explicite est une valeur connue ; une valeur contractuelle absente ou invalide donne « — ». Le compteur serveur reste prioritaire dans la fiche lorsque le cache local des employés est partiel. Les filtres existants de la fenêtre de consultation restent appliqués.

Aucun fichier backend, droit ou enregistrement d'affectation n'est modifié. La donnée métier nécessaire à une future identification nominative est décrite dans [Présentation des surplus OPS](ops-surplus-presentation.md). Le modèle backend actuel utilisant zéro par défaut, une distinction persistante entre « non renseigné » et « zéro » nécessiterait une évolution explicite du modèle et du DTO.

## Résultats des tests

Les comparaisons initiales utilisent deux copies figées, exécutées séquentiellement. Aucun fichier source n'a été édité pendant cette comparaison ni pendant les passes complètes finales. Le jeu de fichiers correspond au script `npm test`, précédé de `pretest`, avec les mêmes options pour les deux références et la version finale : `--test-force-exit --test-concurrency=2 --test-timeout=360000`.

`--test-force-exit` permet au runner de sortir après les tests malgré les minuteurs de fond non libérés ; les erreurs et assertions échouées restent comptabilisées. Les tests Chrome utilisent un serveur local, une base SQLite temporaire et des données synthétiques.

| Vérification | Réussites | Échecs | Résultat |
| --- | ---: | ---: | --- |
| Prétest BRQ, départ, reçu et final | 12 à chaque passe | 0 | Réussi |
| Suite complète du départ `4fada549` | 1210 | 2 | Erreurs de nettoyage préexistantes |
| Suite complète reçue `df2175d0` | 1224 | 2 | Mêmes erreurs |
| Suite complète finale `b61a0111` | 1229 | 2 | Mêmes erreurs, aucun nouvel échec |
| Tests ciblés OPS et filtres site | 51 | 0 | Réussi |
| Chrome fiche, employés, filtres, surplus, isolation et rendu Sites | 25 | 0 | Réussi, avec réserve sur l'entrée Sites ci-dessous |
| DRH Next | 115 | 0 | Réussi |
| Core v3 | 45 | 0 | Réussi |
| Backend OPS, permissions, filtres et effectifs | 90 | 0 | Passe antérieure sur `02b6fa58`, sources backend inchangées depuis |

La dernière suite complète dure environ 219 secondes. Les 1231 résultats comprennent 1229 tests réussis et deux échecs supplémentaires au niveau fichier. Les tests ciblés couvrent notamment zéro, absence de contrat, valeurs invalides, cache partiel, conservation des affectés, badges recalculés, handlers conservés, droits de lecture seule et changements de société/site.

## Échecs préexistants et limites

Les deux fichiers suivants reproduisent des activités asynchrones après fermeture de leur DOM sur le départ, l'état reçu et la version finale :

- `tests_frontend/drh.test.js` : callbacks tardifs des tests de navigation GRH et fiche de position, avec accès à `querySelectorAll` après la fin du test.
- `tests_frontend/facturation.test.js` : callbacks tardifs du test des cinq onglets client en lecture seule, avec accès à `querySelector` après la fin du test.

Le test historique `ops-sites-command-center-chrome.test.js` échoue également au démarrage sur `4fada549`, `df2175d0` et la version finale : après les réponses API, l'entrée initiale `#/sites` peut rester sur « Chargement des chiffres depuis le serveur… ». Le diagnostic final ne relève aucune erreur JavaScript et conserve la route `#/sites`. Ce défaut de navigation/bootstrap n'est pas corrigé dans ce chantier de présentation.

Le nouveau banc vérifie séparément le composant Sites en appelant son vrai renderer une fois le chargement stabilisé, avec les vrais appels API, puis contrôle l'isolation société, les liens et les captures à 1440 et 390 px. Ce succès ne valide pas la navigation initiale défaillante. La barre globale de chargement peut également rester affichée dans cette capture ; elle n'est pas modifiée.

Une passe antérieure sans arrêt automatique était restée bloquée plus de cinq heures dans `pointeur-borne.test.js`. Son processus a été arrêté pour récupérer le bilan ; cette passe interrompue n'est pas utilisée comme comparaison finale.

Les premiers essais sous sandbox avaient aussi échoué au lancement de Chrome et des serveurs locaux. Les résultats comparatifs ci-dessus proviennent des relances avec les permissions locales adaptées. L'écart ponctuel d'enrôlement observé sous charge dans la première comparaison n'est pas reproduit dans les comparaisons séquentielles finales.

## Journaux et captures locaux

Les artefacts restent hors du dépôt ; ils peuvent être supprimés par le nettoyage des dossiers temporaires.

- Comparaison : `/tmp/ops-comparison-baseline-test.log`, `/tmp/ops-comparison-received-test.log`, `/tmp/ops-comparison-results.json`.
- Dernière passe complète : `/tmp/ops-final-verified-pretest.log`, `/tmp/ops-final-verified-test.log`, `/tmp/ops-final-verified-results.json`.
- Tests ciblés : `/tmp/ops-targeted.log` ; Chrome : `/tmp/ops-final-passing-chrome.log`.
- Références du défaut Sites : `/tmp/ops-baseline-sites-chrome.log`, `/tmp/ops-received-sites-chrome.log` ; diagnostic final : `/tmp/ops-final-sites/startup-diagnostic.json`.
- Captures contrôlées : `/tmp/ops-final-presentation/` contient les sept tailles du tableau, les filtres ouverts, le surplus, l'isolation DRH et le rendu Sites. `/tmp/ops-final-fiche/` contient les sept tailles de la fiche. Les mesures du tableau sont dans `/tmp/ops-final-presentation/measurements.json`.

## Commits et publication

Les commits reçus `02b6fa58` et `df2175d0` sont conservés. `b61a0111` finalise les composants, les filtres, le confinement CSS et les surplus, avec leurs tests et la note métier. Un commit documentaire distinct conserve ce rapport.

Aucun push, aucune fusion dans `main` et aucun déploiement n'a été effectué.
