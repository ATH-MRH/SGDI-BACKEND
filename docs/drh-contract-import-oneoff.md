# Dérogation exceptionnelle : préparation de 75 candidats confirmés

Périmètre : société **IRON GLOBAL SOLUTION**, 75 identités et dates de naissance rapprochées le 15/10/2026. `CANDIDATE_IDS` est une liste littérale immuable de 75 IDs (2309 à 2383 inclus, sans calcul d’intervalle). `CANDIDATE_ROWS` est une correspondance immuable entre les lignes originales du fichier filtré et ces IDs. Aucun code ni matricule n’est généré dans le classeur ou en préparation.

Exclusions : dossier **2384 / BELARBI BABOUA KARIM** (ligne 95, non confirmé), **DJOUHRI MOHAMED MILOUD** (ligne 7, identité insuffisante), les 25 lignes hors périmètre et tout autre candidat.

Fichier autorisé : `liste_A_matchs_certains_75_sur_76.xlsx`, SHA-256 :
`e5c2847053c66c8fab3af154abde6aff259d1ce9b0c9609292e0bcc97fd41d62`.
Le classeur personnel n’est pas versionné. Toute modification de ses octets, y compris une réécriture par Excel, produit un autre fichier qui ne reçoit pas la dérogation. Les numéros de lignes originaux ont été préservés dans le fichier filtré.

## Liaison de session

Aucune session de production n’est créée par cette PR. Lors du premier téléversement de ces octets dans cette société par un compte déjà autorisé, une ligne unique de `drh_contract_import_oneoff_grants` lie le lot `regularisation-exceptionnelle-igs-20261015-75` au `session_id` privé généré par l’import. La liaison est atomique, persistante, auditée et non réattribuable, même après expiration ou annulation. Aucun paramètre client ne permet d’activer la dérogation. Une autre session ou un autre fichier conserve les validations normales et ne peut enregistrer cette préparation exceptionnelle. Aucun renouvellement automatique n’est prévu.

Sur ce seul fichier et cette seule session, la correspondance des lignes déjà vérifiées utilise le manifeste figé ; les colonnes Nom et Prénom restent séparées et inchangées. Sélectionner la première feuille et mapper les données réellement souhaitées, notamment Date début vers la colonne I. Aucun besoin de créer ou renseigner des références dans la colonne MATRICULE vide. Toutes les 75 correspondances doivent être présentes et uniques. Les états actuels des candidats, décisions favorables, doublons et éventuels employés liés sont revérifiés avant sauvegarde.

## Préparation sans création

Seules les cellules vides sont tolérées : `null` dans la préparation, « Non renseigné » dans l’interface. Aucune valeur fictive, date de fin, salaire, modèle ou autre défaut n’est ajouté. Les données communes explicitement renseignées restent possibles. Toutes les valeurs présentes restent validées, en particulier les dates, Client/Site DC et modèles. Les erreurs de formules préexistantes ne sont pas des cellules vides et ne sont pas corrigées par ce lot.

L’interface affiche « Dérogation exceptionnelle appliquée à ce lot uniquement. », « Préparé exceptionnellement », et les compteurs du lot. L’action « Enregistrer le lot préparé » conserve uniquement le snapshot et le rapport. `/confirm` refuse la création pour le fichier autorisé et la session dérogatoire, avant tout appel métier. Aucun Candidate, Contract, Employee, GeneratedContract ou Document n’est créé ou modifié par la préparation.

Audit : utilisateur, date/heure UTC, société, session, empreinte, liste exacte des IDs, motif « Régularisation exceptionnelle du lot importé », puis champs manquants et statut par candidat ; sauvegarde avec compteurs de créations à zéro. Le rapport CSV conserve les valeurs présentes et affiche les valeurs manquantes sans les inventer.

Les formulaires manuels, validateurs normaux, import candidats, Client/Site DC, sidebar et permissions générales restent inchangés. La migration additive `20261014_0005` crée uniquement le journal de dérogation, sans données métier ni activation de session ; upgrade/downgrade testés. Le changement est livré par PR uniquement : aucun merge ni déploiement.
