# Compteurs de rapprochement RH / Commercial / OPS

Les trois compteurs du tableau de bord RH proviennent ensemble de
`/api/ui/sidebar-stats`, objet `staffing`. Ils ne sont pas recalculés depuis les
collections du navigateur. Le périmètre est la société active intersectée avec
les sociétés autorisées par le serveur.

- `contract` : contrats DC structurés validés (`dc_contract_sites`), somme des
  besoins par fonction × 4 groupes. Seuls les sites dont le début de rotation
  est atteint sont inclus ; leur clé DC doit correspondre dans OPS. Un brouillon
  DC ne retombe jamais sur les anciennes données techniques.
  Pour les contrats historiques sans référentiel DC structuré : `Client.data.tech_sites` (données Commercial,
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

## Création des sites

La validation `/api/commercial/dc/clients/{id}/contract` publie les sites OPS
avec `client_id` et `dcContractSiteKey`. Les anciens POST de création OPS,
portail client et création via le pont de collections sont refusés (403).
Les sites existants restent disponibles pour l'exploitation. Aucun site existant
n'est supprimé, recréé ou rapproché automatiquement par son nom.

## Responsabilités OPS

OPS conserve les affectations, les coordonnées cartographiques, le système de
rotation et les PV (ouverture, augmentation, diminution, fermeture). Une
republication DC conserve la rotation et les coordonnées déjà saisies dans OPS.
Les PV sont des documents archivés du site : ils ne créent pas de site et ne
modifient pas automatiquement le contrat ou les affectations. Le besoin Commercial
reste protégé dans le formulaire OPS, l'API de site et le pont legacy.
