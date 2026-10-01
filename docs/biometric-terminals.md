# Terminal de pointage facial — guide d'exploitation (tablette Samsung / smartphone)

Référence technique : `docs/biometrics.md` § 14. Ce guide décrit les gestes d'exploitation.

Terminologie : la tablette (ou le smartphone) de production appartient à l'application
**Pointage** (pointeur.irongs.com, clé de module `pointeur`, page `/borne`). Elle est créée,
associée, activée et révoquée depuis **Gestion du pointage** (pointage.irongs.com, clé
`pointage`). La borne ne dépend d'aucune session utilisateur : elle s'authentifie par sa clé
d'appareil.

## 1. Pré-requis

- `BIOMETRIC_ENABLED` **absent** tant que le GO du pilote n'est pas signé (la borne s'installe et
  s'associe sans lui ; elle affiche alors « POINTAGE FACIAL INDISPONIBLE » et accepte le QR).
- Permission `biometric_admin × admin` pour créer, associer, activer, révoquer (Administration →
  Utilisateurs → Permissions). Un pointeur terrain ordinaire ne peut rien faire de tout cela.
- Employés du pilote : consentement admissible + enrôlement supervisé (`docs/biometrics.md` § 13.2).

## 2. Matériel recommandé

| Élément | Recommandation |
|---|---|
| Appareil | tablette Samsung Galaxy Tab **dédiée** (aucun autre usage), Android et Chrome à jour |
| Support | fixation murale ou pied, caméra frontale à hauteur de visage (≈ 1,50–1,65 m), à 40–70 cm de la personne |
| Alimentation | secteur permanent (chargeur branché) |
| Éclairage | lumière de face ; jamais de fenêtre / soleil derrière la personne (contre-jour) |
| Réseau | Wi-Fi du site ou 4G ; accès HTTPS à `pointeur.irongs.com` ; aucun port entrant |

Smartphone : même procédure. Un GO tablette ne vaut **pas** GO smartphone (checklist § 10.3).
iPhone / iPad : prévus (Safari ≥ 15.4 : WebCrypto P-256, IndexedDB, `getUserMedia`,
`requestVideoFrameCallback`) mais **non validés sur appareil réel** ; pas de lecture QR par la
caméra sur Safari (`BarcodeDetector` absent) → QR par HENEX ou pointeur.

## 3. Association (≈ 5 minutes, administrateur sur place)

1. ATLAS → Gestion du pointage (pointage.irongs.com) → **Terminaux (tablettes)** → « + Ajouter un terminal » :
   nom (ex. `TAB-HAMOUL-01`), type « Tablette Android (Samsung) », site, emplacement.
2. Le code d'association s'affiche (10 caractères + QR), **valable 10 minutes, une seule fois**.
   Ne pas le photographier ni le transmettre par messagerie.
3. Sur la tablette, Chrome → `https://pointeur.irongs.com/borne` (ou scanner le QR). Saisir le
   code, choisir la caméra (frontale par défaut) → « Associer cette borne ». Autoriser la caméra.
4. La borne affiche le nom du terminal et du site. Dans ATLAS : « Associé », empreinte de clé,
   **Facial coupé**.
5. Installer en application : menu Chrome ⋮ → « Ajouter à l'écran d'accueil » / « Installer » →
   « Borne de pointage ATLAS » (plein écran, démarre sur `/borne`).

La clé de la borne est créée sur la tablette et **ne peut pas en être extraite** ; effacer les
données de Chrome, réinitialiser la tablette ou changer de profil ⇒ nouvelle association.

## 4. Réglages Android conseillés (standard, sans outil propriétaire)

- Écran : veille **jamais** pendant la charge (Options de développement → « Rester activé ») ou
  délai maximal ; la borne demande aussi le maintien de l'écran (`Wake Lock`) quand c'est permis.
- **Épinglage d'application** (Paramètres → Sécurité → Épingler les applications) sur la borne
  installée, avec code de déverrouillage pour quitter : l'utilisateur ne peut pas en sortir.
- Compte Google / Samsung de service, sans données personnelles ; notifications désactivées.
- Chrome → Paramètres des sites → `pointeur.irongs.com` → Caméra : **Autoriser**.
- Mises à jour : automatiques la nuit ; vérifier après chaque mise à jour que la borne revient
  (elle redémarre seule sur `/borne`).
- Débogage USB **désactivé** (sinon injection d'une caméra virtuelle possible).
- Samsung Knox / MDM : possible ensuite, **non requis et non testé** ici.

## 5. Mise en service du facial (après GO signé)

1. `BIOMETRIC_ENABLED=true` (décision explicite, variable Coolify, redéploiement).
2. Gestion du pointage → Terminaux → « Activer le facial » sur **le seul terminal du pilote** (confirmation).
3. La borne passe à « PRÉSENTEZ VOTRE VISAGE » dans les 30 s (ou au redémarrage de l'app).

## 6. Utilisation (aucun clic)

La personne se place face à la tablette → ANALYSE EN COURS → « ✓ NOM Prénom — Matricule —
ENTRÉE ENREGISTRÉE 08:03 » (ou SORTIE). L'entrée/sortie est décidée par Attendance Core (mêmes
règles que le QR). Rester devant la tablette ne crée pas de second pointage ; la borne se réarme
quand la personne s'en va. Visage non reconnu, liveness refusé, ambigu : **aucun pointage** → QR
ou responsable.

## 7. Coupures (kill switch) — QR et saisie manuelle intacts

| Portée | Geste | Effet |
|---|---|---|
| Terminal (facial) | Terminaux → « Couper le facial » | requête suivante ; la borne garde le QR |
| Terminal (tout) | « Désactiver » | requête suivante ; « TERMINAL DÉSACTIVÉ » |
| Terminal (définitif) | « Révoquer » + motif (perte, vol, remplacement) | clé effacée ; nouvelle association obligatoire |
| Site | « Couper le pointage facial du site » (Terminaux ou Caméras, site filtré) | tous les terminaux ET caméras du site |
| Global | retirer `BIOMETRIC_ENABLED` | tous circuits faciaux de production (redéploiement) ; Mode Test et enrôlement gardent leurs propres flags |

Tablette perdue ou volée : **révoquer immédiatement**.

## 8. Hors ligne

Fail closed : « SERVICE TEMPORAIREMENT INDISPONIBLE — UTILISEZ LE QR OU LA MÉTHODE DE SECOURS ».
Aucun pointage facial n'est conservé ni rejoué plus tard. Reprise automatique au retour du réseau.
Secours : HENEX HC-666 (QR) sur le pointeur, saisie manuelle autorisée du pointeur.

## 9. Audit et surveillance

Terminaux → « Audit » : association, activations, chaque tentative (état, matricule, motif). Centre
de contrôle → Anomalies : visages inconnus, liveness, ambiguïtés (source FACIAL). Aucune image
n'est conservée.

## 10. Essais physiques

Obligatoires avant toute activation : `docs/attendance-hardware-checklist.md` § 10 (tablette) et
§ 10.3 (smartphone, si autorisé). Registre sans image.
