# Portail emploi : recherche et vue liste / détail

Refonte visuelle du portail public dans l’identité IRON Emploi : blanc, bleu #235CCC, Arial, recherche poste / wilaya, filtres société / contrat, liste à gauche et détail à droite. Sur téléphone, le bouton « Voir le détail » ouvre le panneau avec retour à la liste et focus clavier. Aucun contenu de démonstration n’est embarqué.

Les annonces et leur détail viennent uniquement des routes publiques existantes. Le texte est inséré avec textContent, jamais comme HTML. Une annonce devenue indisponible affiche un motif et ne propose pas de lien de candidature dans son détail. Les requêtes concurrentes sont annulées et leurs anciennes réponses ignorées. La candidature reste le parcours existant `/espace/offers/:id` ; afficher un détail n’envoie rien.

Les favoris du portail conservent uniquement des identifiants sur cet appareil, au maximum 200. Le filtre est explicitement limité à la page de résultats courante. Ils ne sont pas synchronisés avec les favoris du compte candidat ou de l’APK.

L’espace candidat web reprend le bleu et le fond blanc via les composants partagés. Le thème natif Android/iOS n’est pas modifié. Aucun nouvel APK n’est nécessaire pour cette refonte web. Les écrans, formulaires, messages, compteurs, convocations, consentements et accès existants restent utilisés.

Aucun endpoint serveur, migration, variable, signature mobile ou paramètre SMS/push n’est ajouté ou modifié. Les liens CSS/JS du portail ont une nouvelle version pour éviter l’ancien cache. Le déploiement doit reconstruire l’export web comme le fait déjà le Dockerfile.

Validation : tests DOM du catalogue, filtres, texte non interprété, favoris et détail indisponible ; tests des routes du portail ; tests / lint / typecheck mobiles ; export web ; Chrome avec serveur isolé, dépôt d’un vrai fichier PDF fictif, candidature reçue par le recruteur. Le profil est prérempli par API dans ce scénario. Aucun SMS ni push réel. Les contrôles Chrome couvrent le catalogue à 320/390/768/1440 px, le détail mobile et son retour. Pas d’essai sur téléphone physique ni de construction complète de l’image Docker dans cette session.
