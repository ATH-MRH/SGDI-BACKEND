# Recrutement : navigation, retours d’action et convocations

Correctif d’interface uniquement. Aucun changement d’API, de migration, de SMSGate,
de notifications mobiles ou de données. Aucun nouvel APK requis pour ces changements.

## Comportement

- Le recrutement reprend les jetons visuels de Sidebar V3 (DRH/OPS) : fond bleu
  nuit dégradé, texte blanc, sélection bleue avec repère cyan, sans pictogrammes.
  Les sept rubriques, leurs droits et la navigation horizontale sur petit écran restent.
- Un refus de publication affiche son motif serveur dans le formulaire : alerte
  rouge persistante, focus et défilement vers l’erreur. Les champs obligatoires vides
  sont signalés. Un brouillon peut toujours être enregistré incomplet.
- Les autres erreurs affichées par le bandeau ont un rôle d’alerte et sont amenées
  dans la zone visible. Les erreurs du traitement sont échappées avant affichage.
- Une réponse de liste ancienne ne remplace plus l’annonce qui vient d’être
  enregistrée. En créant pour une autre société autorisée, le portefeuille revient
  à toutes les sociétés pour que le brouillon sauvegardé reste visible.
- Une convocation envoyée propose directement « Voir la convocation et son QR »
  et « Télécharger le PDF ». L’aperçu utilise le PDF existant, récupéré avec la session
  recruteur. Un document à réémettre ne propose pas ces raccourcis ; les versions
  historiques restent identifiées dans leur liste.
- L’état du document, sa consultation par le candidat et sa confirmation sont
  distingués. Aucun accusé de réception sur téléphone n’est inventé.
- « Prochaine étape » explique l’action à effectuer selon les données serveur.
  Le compte rendu est désactivé avant l’heure prévue ; le serveur conserve ses
  contrôles. L’absence n’est jamais déduite automatiquement. Une arrivée peut
  toujours être confirmée explicitement, même sans confirmation préalable du candidat.
- Quand un entretien est déjà en cours, l’action d’en créer un autre est secondaire
  et s’intitule « Planifier un autre entretien ».
- Les versions des URL CSS/JS modifiées changent pour éviter un ancien cache.

## Recette après déploiement

1. Contrôler le commit servi et recharger la page.
2. Vérifier le bleu nuit dans toutes les rubriques du recrutement, sur ordinateur
   et sur petit écran, sans changement des permissions.
3. Dans un brouillon de test, laisser Missions et Profil recherché vides. Publier :
   le motif doit être lisible immédiatement et les deux champs signalés. Corriger,
   enregistrer puis publier uniquement si la diffusion réelle est souhaitée.
4. Ouvrir une candidature de test avec une convocation déjà envoyée : voir le suivi,
   les deux accès directs au PDF et la prochaine étape. Ouvrir et fermer l’aperçu.
5. Avant l’heure prévue : compte rendu désactivé. À partir de l’heure prévue :
   compte rendu accessible. Une consultation ou un scan seul ne doit rien enregistrer.
6. Vérifier un compte en lecture seule et une convocation annulée, remplacée ou
   à réémettre. Aucun droit d’écriture ni accès public au PDF n’est ajouté.

Les tests Chrome utilisent uniquement des données fictives et des réponses locales.
Ils ne valident pas la réception push, le téléchargement sur téléphone ou la caméra.
