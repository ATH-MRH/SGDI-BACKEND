# Rotation de la clé de chiffrement biométrique

Cette page ne concerne que `BIOMETRIC_TEMPLATE_KEY`. Les sauvegardes ont leur propre clé,
distincte (`docs/backups.md`).

Une rotation n'est **pas** un simple changement de variable : remplacer la clé sans rechiffrer
rend tous les gabarits illisibles. La procédure ci-dessous garde chaque contenu lisible à
chaque étape et se déroule en cinq temps, chacun avec son critère d'arrêt.

## 1. Ce que la clé protège

Une seule clé (Fernet) sert à quatre usages, dans `app/modules/biometrics/crypto.py` :

| Contenu | Emplacement | Durée de vie | Effet d'une clé perdue |
|---|---|---|---|
| Gabarits faciaux | `biometric_templates.embedding_encrypted` | durable | réenrôlement de chaque employé |
| Identifiants de caméra | `cameras.credentials_encrypted` | durable | ressaisie des identifiants |
| Photo candidate d'une prise distante | `biometric_remote_capture_sessions.photo_encrypted` | minutes, effacée à la clôture | prise à refaire |
| Aperçu d'enrôlement scellé | jeton tenu par le navigateur | 5 minutes | analyse à relancer |

Conséquence de cette clé unique : sa rotation touche les quatre usages en même temps. Les deux
derniers sont temporaires et n'exigent rien de plus que la période de transition.

Les sauvegardes de la base contiennent les trois premières colonnes, chiffrées avec la clé en
vigueur au moment de la sauvegarde. **Une ancienne clé doit donc être conservée en lieu sûr aussi
longtemps que des sauvegardes de cette époque sont gardées**, sinon leurs gabarits ne sont
plus récupérables après restauration.

## 2. Mécanisme à deux clés

| Variable | Rôle |
|---|---|
| `BIOMETRIC_TEMPLATE_KEY` | clé active : la seule qui chiffre |
| `BIOMETRIC_TEMPLATE_KEY_PREVIOUS` | ancienne clé, acceptée en lecture seulement ; vide en temps normal |

- Une seule clé configurée : comportement identique à avant.
- Deux clés : on déchiffre avec la clé active puis, à défaut, avec l'ancienne ; tout ce qui est
  écrit l'est avec la clé active.
- Une clé invalide, ou une ancienne clé sans clé active, donne une erreur 503 explicite. Il n'y a
  jamais de repli vers un stockage en clair.
- Aucune clé n'apparaît dans un journal, une réponse ou un message d'erreur. Pour comparer deux
  configurations, l'outil affiche un identifiant court non réversible (`id 1a2b3c4d`).

## 3. Outil de rechiffrement

```bash
python3 -m scripts.rotate_biometric_key                       # simulation, lecture seule
python3 -m scripts.rotate_biometric_key --apply --confirm-database <base>
python3 -m scripts.rotate_biometric_key --report rapport.json  # vérification + rapport
```

| Code de retour | Signification |
|---|---|
| 0 | tout est lisible avec la clé active seule |
| 1 | des lignes dépendent encore de l'ancienne clé |
| 2 | des lignes ne sont lisibles par aucune clé configurée (identifiants listés) |
| 3 | configuration refusée (clé absente ou invalide, base non confirmée) |

Propriétés : simulation par défaut ; écriture seulement avec `--apply` et le nom exact de la
base ; lots transactionnels avec verrou de ligne ; une ligne déjà à jour n'est jamais retouchée
(relance sans risque) ; une interruption annule le lot en cours et laisse tout lisible ; une
ligne illisible n'est pas modifiée ; un événement d'audit `biometrics.key_rotation` enregistre
les compteurs. L'outil n'affiche que des identifiants de ligne et des compteurs.

## 4. Procédure

À exécuter par une personne habilitée, dans une fenêtre calme (aucun enrôlement en cours).
Chaque étape a un critère : s'il n'est pas rempli, **STOP**, ne pas passer à la suivante.

### Étape 0 — Préalables

1. Sauvegarde du jour présente, et restauration d'essai réussie (`docs/backups.md`).
2. Version de l'application à deux clés déployée, **avec la configuration inchangée** (une seule
   clé). Critère : `python3 -m scripts.rotate_biometric_key` retourne 0.
3. Générer la nouvelle clé hors du serveur applicatif et la déposer dans le coffre de secrets :
   `python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`.
   Ne jamais la coller dans un ticket, un message ou un terminal partagé ou enregistré.
4. Noter l'identifiant de l'image actuellement déployée (retour arrière).

### Étape 1 — Passer à deux clés

Dans la configuration de l'application :

- `BIOMETRIC_TEMPLATE_KEY_PREVIOUS` = valeur actuelle de `BIOMETRIC_TEMPLATE_KEY` ;
- `BIOMETRIC_TEMPLATE_KEY` = nouvelle clé.

Redéployer, puis s'assurer que **plus aucune instance de l'ancienne configuration ne tourne**
(un seul conteneur applicatif, démarré après le changement).

Critères : l'état biométrique indique une clé configurée ; un pointage facial d'essai sur le
terminal en service est reconnu ; la simulation retourne 1 avec `illisibles=0`.
**STOP** si `illisibles` est non nul : restaurer l'ancienne configuration (§ 5).

### Étape 2 — Rechiffrer

```bash
python3 -m scripts.rotate_biometric_key                       # relever les compteurs
python3 -m scripts.rotate_biometric_key --apply --confirm-database <base>
python3 -m scripts.rotate_biometric_key --report rotation-<date>.json
```

Critère : la troisième commande retourne 0 et affiche « VÉRIFIÉ ». Si elle retourne 1, une
instance a encore écrit avec l'ancienne clé : vérifier qu'il n'en reste aucune, relancer
`--apply`, revérifier. **STOP** sur un code 2.

### Étape 3 — Observer

Laisser les deux clés en place au moins un cycle complet d'exploitation (une journée et une
nuit de pointage). Relancer la vérification : elle doit toujours retourner 0.

### Étape 4 — Retirer l'ancienne clé

Conditions, toutes réunies : sauvegarde restaurable faite **après** le rechiffrement ;
vérification à 0 ; aucune ancienne instance ; autorisation explicite du responsable.

Vider `BIOMETRIC_TEMPLATE_KEY_PREVIOUS`, redéployer, puis :

```bash
python3 -m scripts.rotate_biometric_key        # doit retourner 0 avec la nouvelle clé seule
```

et refaire un pointage facial d'essai. Archiver l'ancienne clé dans le coffre, avec la date
jusqu'à laquelle des sauvegardes en dépendent ; la détruire après cette date.

### Surveillance pendant la rotation

- Erreurs « Gabarit biométrique illisible », « Secret caméra illisible », « Contenu chiffré
  illisible » dans les journaux applicatifs : aucune ne doit apparaître.
- Taux de reconnaissance du terminal en service, comparé aux jours précédents.
- Événement d'audit `biometrics.key_rotation`.

## 5. Retour arrière

| Moment | Action |
|---|---|
| Après l'étape 1 ou 2 | inverser les deux clés (ancienne active, nouvelle en `…_PREVIOUS`) et redéployer : tout reste lisible, y compris ce qui a été écrit entre-temps. Relancer `--apply` ramène ensuite toutes les lignes à l'ancienne clé. Ne pas simplement retirer la nouvelle clé : ce qu'elle a chiffré deviendrait illisible. |
| Après l'étape 4 | remettre l'ancienne clé en `…_PREVIOUS` depuis le coffre. Rien n'est perdu tant que l'ancienne clé est conservée. |
| Version applicative | revenir à l'image précédente n'est possible **que si une seule clé est configurée** et que les données sont chiffrées avec elle : l'ancienne version ignore `…_PREVIOUS`. |

Ne jamais restaurer une sauvegarde de base pour annuler une rotation : la restauration
écraserait les pointages enregistrés depuis.

## 6. Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié par les tests (`tests/test_biometrics_crypto_keys.py`,
`tests/test_biometrics_key_rotation.py`, `tests/test_biometrics_key_rotation_pg.py`), avec des
clés et des gabarits fictifs : compatibilité à une clé, lecture des anciennes données à deux
clés, écriture avec la nouvelle clé, rechiffrement d'un lot, lecture avec la nouvelle clé seule,
idempotence, reprise après interruption, écriture tardive avec l'ancienne clé, ligne illisible,
clé invalide, absence de secret dans les sorties, verrou concurrent sur PostgreSQL.

Non vérifié : la rotation n'a été exécutée sur aucune donnée réelle, et le comportement du
terminal physique pendant un redéploiement n'a pas été observé.
