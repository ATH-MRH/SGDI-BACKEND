# Présentation des surplus OPS

La fiche technique et la fenêtre « Effectifs affectés » affichent l'ensemble des employés affectés dans une seule liste. L'ordre des matricules ne permet plus de qualifier les derniers employés de « surplus ».

## Calcul et affichage

Lorsque les valeurs sont disponibles, le surplus affiché vaut `max(0, effectif_affecté - effectif_contractuel)`. Un contrat explicitement égal à zéro est une valeur disponible. Une valeur contractuelle absente, vide, négative ou non numérique donne « — » dans les compteurs concernés.

Le contrat provient de la situation backend du site, puis des champs contractuels existants du site. Le compteur d'affectés de la situation serveur est prioritaire dans la fiche, y compris lorsque le cache local des employés est partiel. À défaut, les affectations disponibles fournissent ce compteur. Les listes d'affectations et leurs filtres existants restent les sources des employés affichés. Aucun tri, rang dans la liste ou motif libre d'ordre de mouvement n'identifie un employé en surplus.

Un surplus positif affiche seulement son compteur et la mention :

> Employés en surplus non identifiés individuellement

La recherche et l'affichage progressif portent sur tous les employés affectés. Aucune affectation enregistrée, règle backend, permission ou restriction société/site n'est modifiée.

## Donnée backend nécessaire pour une identification nominative

`Assignment` et ses schémas API ne fournissent actuellement aucune qualification nominative de surplus. Les services OPS fournissent un écart numérique (`surplus_staff`), qui ne désigne pas des personnes. Le champ libre `change_reason` ne constitue pas une décision métier structurée.

Si une identification nominative devient nécessaire, le métier doit d'abord définir qui peut la décider, sa justification, sa période de validité et sa relation avec les affectations. Le backend devra alors enregistrer cette décision explicitement, la tracer et la restituer avec les mêmes contrôles société/site que les affectations. Le frontend pourra afficher les identités fournies par cette source autorisée.

Aucun champ ni règle de sélection supplémentaire n'est introduit dans cette livraison. Si le métier doit distinguer « contrat non renseigné » de « contrat à zéro » dans les données persistées, le modèle et le DTO backend devront également porter cette distinction ; le modèle actuel utilise zéro par défaut.

## Vérifications

Les tests couvrent un contrat inférieur, égal ou supérieur à l'effectif, zéro explicite, contrat absent ou invalide, la conservation des employés dans les deux affichages et l'absence de tableau nominatif de surplus. Une fixture Chrome présente trois affectés pour un contrat de un : les trois lignes restent consultables et le surplus vaut deux.
