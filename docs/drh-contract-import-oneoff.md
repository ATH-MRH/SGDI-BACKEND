# Préparation exceptionnelle : fichier de 96 lignes et identité D + E

Cette dérogation remplace le ciblage historique des 75 IDs. Elle concerne uniquement **IRON GLOBAL SOLUTION** et les octets du fichier `modele-contractualisation (1).xlsx` dont le SHA-256 est :

`d93cdd49848390596b405bfa39efe7335d8af5deee352286966dae5280fb63d0`.

Le fichier comporte 96 lignes. D contient le nom sous « Nom + prénom », E le prénom sans en-tête ; F contient la date de début. Le fichier original n'est ni réécrit, ni versionné. Aucune référence ou valeur métier n'est inventée.

## Identité et périmètre actuels

Pour ce fichier seulement, le serveur utilise D + espace + E et les dossiers actuellement `a_contractualiser` de la société active. Si E est vide, D n'est accepté que s'il représente à lui seul une identité complète unique ; une identité partielle reste à vérifier. La recherche normalise casse, accents, espaces, apostrophes et tirets sans modifier les cellules. Aucune permutation ou correspondance approximative automatique n'est utilisée.

Référence candidat et code en A/B, téléphone en C et date de naissance (si une colonne ainsi nommée existe) corroborent l'identité lorsqu'ils sont disponibles. Un conflit ou une homonymie non résolue produit « À VÉRIFIER ». Les références historiques 2309–2383 ne sont plus un critère. Les doublons sont signalés, jamais supprimés silencieusement.

L'étape Vérification et le CSV distinguent le statut de correspondance (« MATCH CERTAIN », « À VÉRIFIER », « CANDIDAT INTROUVABLE » / hors périmètre) de l'état de préparation. Les lignes non reconnues restent dans le rapport, sont exclues de la préparation et ne bloquent pas la sauvegarde des lignes reconnues valides. Une valeur contractuelle présente mais invalide continue à bloquer la sauvegarde ; Client/Site DC reste contrôlé par le validateur existant.

## Fichier, session et absence de création

Le premier téléversement autorisé du fichier dans cette société réserve atomiquement une seule session privée via le journal existant `drh_contract_import_oneoff_grants` et la clé distincte `regularisation-exceptionnelle-igs-20261016-96`. Il n'y a aucun bypass client et aucune réattribution automatique, même après annulation ou expiration. Aucune session de production n'est créée par cette PR. Les anciens journaux sont conservés. Aucun changement de schéma n'est nécessaire.

Le premier aperçu fige les liens ligne → candidat effectivement reconnus et les IDs correspondants dans ce journal. Avant sauvegarde, les identités et états sont relus ; un changement de correspondance exclut la ligne sans lui substituer un nouvel ID. Une autre session, une autre société ou un autre fichier ne reçoit pas cette dérogation.

Pour le fichier exact, le serveur impose les positions réelles des colonnes et le mode complet : les dates individuelles, poste, Client/Site, type, salaire et autres valeurs présentes sont conservés. Les données communes ne complètent pas ce fichier ; les blancs restent `null`, affichés « Non renseigné ». Aucune date de fin, durée, période d'essai ou autre valeur par défaut n'est ajoutée. Les valeurs présentes restent validées ; les modèles manquants ne sont pas inventés.

Seuls import, correspondance, vérification, snapshot de préparation et rapport sont autorisés. `/confirm` est refusé avant tout service métier. Aucun Candidate, Employee, Contract, GeneratedContract ou Document n'est créé ou modifié par la préparation ; les compteurs de créations restent à zéro. La décision favorable et l'absence de salarié lié sont revérifiées par les règles existantes.

Audit : compte, date UTC, société, empreinte, session, liens et champs manquants par ligne (y compris lignes exclues), motif « Régularisation exceptionnelle du lot importé », puis sauvegarde avec zéro création. Les formulaires manuels, l'import candidats, les permissions, la sidebar et les règles générales ne changent pas.

Tests : structure à 17 colonnes, E sans en-tête, 96 lignes et IDs de base actuels ; noms normalisés et E vide ; homonymes et conflits téléphone/référence/naissance ; doublons ; exclusions ; session/empreinte/société ; conservation des dates, salaires, autres valeurs et blancs ; absence de créations et de mutation des candidats ; audit/CSV ; interface et parcours normaux. Livraison par PR uniquement, sans merge ni déploiement.
