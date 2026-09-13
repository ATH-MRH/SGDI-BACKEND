# Nouveau client depuis un devis

Ajout du bouton « Nouveau client » à côté du sélecteur. Une fenêtre recueille l'identité fiscale et les coordonnées, puis utilise `persistClientToPostgres` et l'API Commercial existante. Le client n'est ajouté à la liste et sélectionné qu'après succès serveur. Aucun nouveau droit ni calcul de devis.

Le formulaire du devis reste monté : les lignes et les autres saisies sont conservées, y compris en cas d'annulation. La fenêtre conserve les valeurs en cas d'échec, empêche les soumissions concurrentes et refuse un changement de société avant sauvegarde. Le bouton est absent du contexte Facturation en lecture seule.

Vérification : tests frontend dédiés (succès/conservation, erreur/double clic, société/contexte), suite frontend complète, node --check, git diff --check.
