# Chiffrage libre des devis — 13 septembre 2026

Base : 8a14b27a689ae40ca512de0f81f59177c2de74ba.

## Fonctionnement

Chaque ligne conserve une fiche interne `costSheet`. Les postes contiennent un libellé, une quantité, un coût unitaire et un coefficient. Des colonnes supplémentaires peuvent être des coûts unitaires additionnels ou des informations internes. Le calcul Agent historique reste accessible et inchangé.

- Coûts directs : somme de (coût unitaire + colonnes de coût) × quantité × coefficient.
- Frais indirects : montant fixe ou pourcentage des coûts directs.
- Imprévus : pourcentage des coûts directs augmentés des frais indirects.
- Prix : majoration du coût, marge sur vente inférieure à 100 %, ou prix unitaire libre.
- Le prix unitaire proposé est arrondi à deux décimales avant comparaison de rentabilité, comme la valeur insérée dans le devis.
- Les remises existantes du devis sont conservées ; le récapitulatif présente aussi le bénéfice après remises, avant impôts.

Les scénarios et les détails sont conservés avec la fiche ; les modèles sont sauvegardés avec le devis et réutilisables uniquement depuis les devis de la société active. Les données suivent la sauvegarde JSON et les permissions existantes, sans migration ni changement backend. Il faut appliquer la fiche puis enregistrer le devis pour une conservation serveur.

## Colonnes client

Les colonnes du tableau de devis sont des informations complémentaires sans effet sur les formules. Elles peuvent être nommées, déplacées et supprimées ; elles sont internes par défaut. Seules celles cochées « Visible client » sont reprises dans l’aperçu et l’impression/PDF navigateur. La fiche de coût interne n’est jamais incluse dans cet export.

## Vérifications

297 tests frontend réussis ; tests ciblés chiffrage et Commercial ; syntaxe JavaScript ; git diff --check. Couverture : formules et arrondis, nombres français, entrées invalides, prix déficitaire, sauvegarde/réouverture, confidentialité des colonnes et PDF, scénarios, modèles par société et formule Agent historique. Contrôle visuel Chrome du formulaire et du tableau.
