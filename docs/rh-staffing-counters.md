# Compteurs de rapprochement RH / Commercial / OPS

Les trois compteurs du tableau de bord RH proviennent ensemble de
`/api/ui/sidebar-stats`, objet `staffing`. Ils ne sont pas recalculés depuis les
collections du navigateur. Le périmètre est la société active intersectée avec
les sociétés autorisées par le serveur.

- `contract` : somme du besoin `Client.data.tech_sites` (données Commercial,
  y compris les sites du formulaire Contrat enregistrés dans `tech_sites`).
  Client actif, début de contrat renseigné et atteint, fin non dépassée ou ouverte.
  Le calcul du besoin reprend celui du Commercial : total enregistré, sinon
  groupes × nuit + max(0, jour − nuit).
- `actual` : nombre de salariés DRH distincts non sortants affectés par OPS à
  des sites actifs rattachés à ces clients via `Site.client_id`. Affectation
  active, début atteint, fin non dépassée ou ouverte. Société du salarié identique
  à celle du contrat ; la société du site, si renseignée, doit aussi correspondre.
  Les congés/absences restent des indicateurs séparés et ne suppriment pas une
  affectation toujours en vigueur.
- `gap` : réel moins contrat. Négatif = déficit, positif = excédent.

Un site sans lien `client_id` ne peut pas être rapproché automatiquement : son
nom libre n'est pas utilisé pour deviner un client. Un contrat sans date de début
n'est pas considéré en vigueur. Ces données doivent être complétées dans leurs
modules d'origine ; aucune réparation automatique ni écriture de données métier
n'est effectuée par les compteurs.

L'absence de réponse serveur affiche « — », jamais un faux zéro. L'effectif RH
total et l'effectif affecté sont des notions différentes.
