# DRH — revues des corrections

## Revue indépendante 1

Correction 1 : substitutions, ordre du dictionnaire, exclusions et modes FR/AR
conservés. Aucun cache de traduction ne survit au parcours. La garde `innerHTML`
conserve le contenu nettoyé et les descendants lorsque rien ne change.

Le protocole navigateur et les trois traces avant ont été relus : même observateur,
navigateur, politique de cache et population. La synthèse recalculée est identique.
Le comparatif final doit vérifier explicitement ces métadonnées et les populations,
car l'agrégateur ne valide automatiquement que SHA, erreurs et statuts HTTP.

Correction 2 : revue des portées, de l'invalidation et des réponses tardives.
Un cas de démarrage invalidé a été reproduit : une lecture employés renvoyant `null`
pouvait être comptée comme un succès et lever `sgdiFullDataReady` avec un référentiel
vide. Constat corrigé : les consommateurs qui attendent le référentiel (bootstrap,
recherche NIN et Contrats) attendent une lecture courante, avec trois tentatives
maximum. Une annulation répétée, un échec de reprise ou un changement de token ne
lève plus le portillon initial. Les 25 tests loading et trois reproductions
indépendantes (attente, borne de reprises, changement de connexion) passent.
Aucun autre constat bloquant dans la revue indépendante de cette correction.

## Revue 2 — responsable du lot

Correction 1 : diff produit relu, tests de contenu, langue et interactions vérifiés.

Correction 2 : un retour anticipé ajouté pour une réponse scoped sans agent de la
société supprimait des effets historiques (normalisation, affectations, rendu et
notification). Corrigé en limitant uniquement le marquage de fraîcheur ; test des
quatre effets ajouté. Une réponse vide ignorée ou un échec ne doit jamais être
marqué frais. La fusion des sociétés doit lire le référentiel courant après attente.

Correction 3 : le prédicat SQL proposé reprend exactement les ensembles déjà
écartés en Python ; ordre, gardes et construction des collections SQL conservés.
Le brouillon de tests couvre light/full, objets, ordre, limites, backfill, périmètres
et absence de matérialisation des collections ignorées. Le contrôle sur le code
initial passe les cinq tests métier et échoue seulement sur les deux assertions
de matérialisation, ce qui confirme la pertinence du test de performance.

Une seconde lecture indépendante de la correction 2 finale ne trouve aucun
défaut bloquant : reprises bornées, isolation des tokens, fusion des portées et
attente des consommateurs sont cohérentes. La revue indépendante de la correction
3 confirme également l'équivalence du prédicat (colonne collection non nullable),
des tris et de la réponse light/full. Aucun changement de droits ou de filtre
métier n'est introduit par ces trois corrections.

## Limites qui restent hors correction

- La pagination disponible ne reproduit pas les filtres, recherches, tris et
  agrégats DRH actuels ; l'inventaire documente les divergences.
- Les nombres de lignes/éléments seuls ne prouvent pas l'identité du contenu ; les
  tests fonctionnels et l'équivalence des traductions complètent les mesures.
- `settledMs` désigne la dernière activité instrumentée, pas une mesure garantie
  d'interactivité. Les temps des fonctions sont inclusifs et ne s'additionnent pas.
- Aucun runtime Tailwind JS n'est chargé dans les traces. Aucun gain ne doit lui
  être attribué. SSE, polices externes et service worker restent hors protocole.

État : deux revues terminées ; les deux constats sont corrigés et couverts par
des tests. Aucun défaut bloquant restant identifié. Les suites et les mesures
finales sont consignées dans `../drh-performance-report.md`.
