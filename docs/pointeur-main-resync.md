# Candidat Pointeur synchronisé avec IRON Emploi

Cette fiche décrit le commit `8197c333` contre main `1df19832`. La validation plus récente
avec Studio Badges et la jonction `20261019_0001` est dans
[pointeur-main-resync-badges.md](pointeur-main-resync-badges.md) ; elle prévaut pour le candidat actuel.

Branche locale : `integration/pointeur-main-resync`, créée depuis
`fix/pointeur-final-stabilization` (`aa5ca535`). Main intégré : `1df19832`.
L'intégration historique (`2abf0537`) et les branches existantes ne sont pas modifiées.
Aucun push, déploiement, accès production ou activation faciale.

## Résolutions techniques

- `package.json` : union des listes de tests, 96 fichiers dans `npm test` ; les scripts
  Pointeur et les deux suites IRON Emploi sont conservés.
- `tests/test_attendance_official_shift_migration.py` : attente de la nouvelle tête de jonction.
- `app/modules/auth/dependencies.py` a fusionné automatiquement : les préfixes des annonces et
  de la conservation IRON Emploi sont ajoutés, les règles d'écriture Pointeur/DRH demeurent.
- Aucune résolution métier et aucune modification des migrations existantes.

## Graphe Alembic

```text
20261014_0001
├── 20261014_0002 → 20261014_0003 → 20261014_0004 → 20261016_0001 ─┐
└── 20261017_0001 ─────────────────────────────────────────────────┤
                                                                └→ 20261018_0001
```

`20261018_0001` est une jonction explicite avec deux parents ; upgrade et downgrade ne
contiennent aucune opération SQL. Aucune révision existante n'est renommée ou reparentée.
Alembic complète seulement la branche manquante, puis enregistre la tête commune.

Les essais PostgreSQL partent de deux exports Git figés (`1df19832` et `aa5ca535`), avec données
fictives : annonces, salaire, espace candidat, candidature, compte Pointeur et autorisation
faciale. Chaque table existante est comparée par empreinte de toutes ses lignes avant/après.
Le cas où les deux branches sont déjà appliquées est également vérifié.

## Rollback : distinguer code, jonction et schéma

Le démarrage standard (`start.sh`) exécute `alembic upgrade head`. L'image historique de main
ne connaît pas `20261017_0001` ni `20261018_0001` : la redéployer directement sur le nouveau
marqueur échoue. Ce refus est reproduit avec l'export Git historique, sur une base jetable.

- **Rollback applicatif avec données faciales conservées** : préparer une image de revert
  applicatif conservant le graphe de migrations du candidat. Répéter cette image en recette
  avant un GO de déploiement ; ne pas restaurer une ancienne base pour annuler le code.
- **Annuler seulement la jonction** : avec le runner de migrations du candidat,
  `alembic downgrade 20261016_0001` rend les deux marqueurs parents, sans retirer de table.
  Ce n'est PAS un retour au seul schéma de main. `downgrade -1` est ambigu à la jonction.
- **Retour au seul schéma de main, uniquement si la table faciale est vide** : la cible
  qualifiée `20261017_0001@20261014_0001` retire seulement la branche faciale et laisse main
  à `20261016_0001`. Les empreintes IRON Emploi restent identiques dans le test PostgreSQL.
  Si une autorisation existe, le downgrade refuse ; la transaction conserve les données et
  le marqueur de jonction. Ne pas supprimer des autorisations pour contourner ce garde-fou.
- Ne pas utiliser un `stamp` forcé, un downgrade non qualifié vers l'ancêtre commun ou une
  restauration de sauvegarde pour masquer une incompatibilité de révision.

Ces procédures sont testées uniquement en recette jetable ; elles ne constituent pas une
autorisation d'action sur la production. La rotation biométrique conserve son prérequis propre :
une ancienne application à clé unique ne doit pas revenir tant que des contenus exigent deux clés.

## Python et sauvegardes

Les helpers du correctif requièrent Python ≥ 3.11 (`hashlib.file_digest`, `fcntl` sur Linux/macOS),
sans dépendance à l'application. Le runtime local, Docker et la CI sont en Python 3.13.
La syntaxe des helpers est également vérifiée avec la grammaire Python 3.11 ; aucune exécution
sur un interpréteur 3.11 exact n'est revendiquée.

Conserver les helpers avec les scripts lors de leur future installation. Le fichier de verrou
permanent ne doit pas être supprimé pendant une sauvegarde ; un ancien dossier `.lock` demande
une intervention explicite après vérification de l'arrêt des anciens processus.
L'automatisation des sauvegardes reste reportée au futur serveur physique.

## Validation de cette session

Les résultats sont consignés après exécution sur ce candidat, sans reprendre les résultats
historiques comme preuve nouvelle.

| Validation exécutée | Résultat |
|---|---|
| PostgreSQL/Alembic, sauvegardes, RBAC, Pointeur, DRH lecture seule, IRON Emploi | 629 réussis |
| Backend complet | 2497 réussis, 17 ignorés, 1 échec attendu |
| Frontend complet | 1083 réussis + 12 prétests |
| DRH-next / Core-v3 | 115 / 45 réussis |
| Chrome (Pointeur, multi-terminaux, terminaux, DRH lecture seule, bi-écran, abandon, Recrutement) | 42 réussis, 0 ignoré |

Les 17 tests backend ignorés : 16 exigent OpenCV, des modèles ou des portraits réels absents ;
1 contrôle `health/db` dépend de PostgreSQL dans le contexte SQLite de la suite. L'échec attendu
concerne la migration de permissions figée, couverte par le contrôle indépendant des contraintes.
Chrome utilise des profils, serveurs et données jetables ; le moteur facial est simulé.

Les 68 worktrees préexistants (les 67 initiaux et le correctif de stabilisation) sont laissés
intacts. Une activité parallèle a committé le chantier `ATLAS-mobile` pendant la mission ;
aucun changement de ce chantier n'a été annulé ou repris. Les deux commits Candidatures DRH
sur le main local restent préservés.

**GO pour revue du candidat local.** Aucun push autorisé dans cette mission.
L'image de rollback applicatif conservant le nouveau graphe reste à préparer et à répéter avant
un GO de déploiement. **NO-GO pour toute nouvelle activation faciale réelle.**
