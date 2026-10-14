# Dérogation exceptionnelle : préparation du lot de 76 candidats

Branche : `fix/drh-contract-import-oneoff-bypass`, basée sur le lot Excel de la PR #25.

Périmètre observé en lecture seule le 14/10/2026 dans DRH → Contrats à établir : les 76 identifiants explicites 2309 à 2384, société IRON GLOBAL SOLUTION, transmission affichée le 11/10/2026. La liste est écrite littéralement dans `contract_import_oneoff.py` : aucun ciblage dynamique par compteur, société seule, date seule ou intervalle.

Le premier aperçu qui contient exactement ces 76 dossiers lie définitivement la dérogation à son `session_id` et à l’empreinte SHA-256 du classeur. Une table dédiée, avec clé de lot primaire unique et session unique, conserve cette liaison et le rapport au-delà de la purge des sessions d’import. Aucun paramètre de bypass n’est accepté dans les requêtes. Une autre session, même avec les mêmes candidats, suit la validation normale et ne reçoit pas la dérogation. Les autres candidats suivent les règles habituelles.

Seules les cellules vides sont tolérées pour cette préparation. Les valeurs manquantes restent `null` : pas de salaire à zéro, type, période d’essai, date de fin calculée, modèle, banque ou client ajoutés par défaut. Les valeurs communes explicitement renseignées restent utilisables selon la priorité choisie. Les valeurs présentes restent validées, notamment dates, Client/Site DC, modèle actif compatible, salaire et durée. Les correspondances ambiguës, doublons et candidats déjà contractualisés restent bloqués.

Dans Vérification et Résultat :

- « Dérogation exceptionnelle appliquée à ce lot uniquement. »
- « Non renseigné » pour chaque valeur vide ; « Préparé exceptionnellement » pour les lignes préparables.
- Compteurs : total, complètes selon les champs obligatoires habituels, préparées avec données obligatoires manquantes, lignes avec valeurs invalides.
- « Enregistrer le lot préparé » remplace la création. `POST /api/drh/contracts/import/{session_id}/prepare` enregistre uniquement un snapshot et efface le classeur de session.
- `POST …/confirm` refuse toute création pour une session dérogatoire ou contenant un des dossiers de cette liste, avant tout appel métier. Les futurs lots hors périmètre gardent le comportement normal.
- Rapport CSV : champs manquants par ligne, valeurs présentes et « Non renseigné ». Aucun numéro de contrat fictif.

Audit : événement d’autorisation (compte, date UTC, session, liste des 76 candidats, motif « Régularisation exceptionnelle du lot importé »), puis une entrée par candidat avec ses champs manquants pour éviter la troncature du journal. Enregistrement final audité avec compteurs de créations tous égaux à zéro.

Les modèles et formulaires manuels, les validateurs normaux, l’import candidats, la bibliothèque Client/Site DC, la sidebar et les permissions générales ne sont pas modifiés. Le corps de l’analyse normale `analyze()` reste identique ; la préparation exceptionnelle utilise un chemin séparé. La migration additive `20261014_0005` crée uniquement le journal de cette dérogation. Le test de tête Alembic est mis à jour pour cette seule migration ; les parcours SQLite upgrade/downgrade vérifient la préservation des affectations existantes. Aucun employé, contrat, document ou modification de dossier candidat n’est enregistré par le parcours exceptionnel.

Tests : lot réel de 76 références avec toutes les valeurs contractuelles vides ; maintien de null ; invariance des dossiers et des compteurs Employee/Contract/GeneratedContract/Document ; audit des 76 candidats ; nouvelle session et nouveau lot normaux toujours bloqués si données obligatoires absentes ; valeurs invalides toujours bloquées ; refus de `/confirm` avant et après préparation ; rapport CSV ; interface ; suites normales d’import et de contractualisation.

La correction est préparée dans la branche locale. Elle n’est pas activée sur la base de production par ce travail : aucun merge ni déploiement. Le nombre réel de champs manquants du fichier sera mesuré et audité au premier aperçu autorisé ; la liste DRH seule ne contient pas les cellules de ce classeur.
