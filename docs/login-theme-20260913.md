# Harmonisation des connexions — 13 septembre 2026

Base : fa7fa73194bb4046856c7cc6a2b8bf5413564871.

Le thème Commercial est partagé par les connexions des modules internes, avec des textes propres à chaque activité. Paie utilise le formulaire commun en conservant les champs obligatoires. Recrutement et Pointage gardent leurs formulaires autonomes et partagent une feuille de style dédiée. Le portail client DHL conserve son identité distincte.

Les événements de connexion, noms et identifiants des champs, gestionnaires de mot de passe et contrôles d'accès sont conservés. Aucun changement métier ou backend. Les versions des ressources statiques sont actualisées.

Validation : 288 tests frontend réussis, vérification syntaxique JavaScript (y compris scripts intégrés Pointage/Recrutement), git diff --check. Contrôle Chrome headless du rendu Facturation sur bureau ; adaptation mobile des formulaires autonomes.

Correction additionnelle demandée : cachet de facture porté de 86 × 68 à 172 × 136 pixels, proportions conservées et colonne de signature élargie. Commit distinct.
