# Chiffrage simple — maquette utilisateur

Remplace la présentation initiale par la maquette approuvée : titre « Calculer mon coût », quatre colonnes, ajout de coût, options repliées, trois cartes et bouton turquoise « Appliquer au devis ».

Le prix de vente HT affiché et modifiable est le prix total de la ligne. Il est converti en prix unitaire selon la quantité vendue, en conservant les arrondis du moteur. Le bénéfice et sa marge tiennent compte des remises actuelles du devis. Les quantités peuvent porter une unité libre (jours, litres…). Les coefficients existants apparaissent comme une multiplication dans la quantité ; les options restent disponibles pour les modifier.

Les fiches, modèles, scénarios, colonnes et règles de calcul existants sont conservés. Le contrôle visuel utilise le même exemple que la maquette (120 000 DA de coût, 150 000 DA de vente, 30 000 DA de bénéfice, 20 % de marge).

Vérifications : suite frontend complète, tests ciblés de disposition et d’édition du prix, montants invalides refusés, conservation des anciennes fiches avec coefficients et colonnes de coût ; node --check et git diff --check. Capture Chrome locale après animations.
