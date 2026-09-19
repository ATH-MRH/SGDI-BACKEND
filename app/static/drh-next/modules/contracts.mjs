// DRH NEXT — modules/contracts.mjs
//
// LOT 4 : écran "Contrats" de la navigation principale.
//
// Audit backend (avant tout code, app/modules/drh/routes.py::contracts) :
//   GET /drh/contracts?employee_id=&status=  → response_model=list[ContractOut]
// AUCUNE pagination (pas de page/page_size, contrairement à /employees/page). Sans
// employee_id, le backend retourne TOUS les contrats accessibles au périmètre de
// l'utilisateur (_filter_employee_owned_rows), potentiellement des milliers de lignes —
// exactement le type de "requête massive" que la mission interdit. Il n'existe donc
// AUCUNE capacité backend pour un tableau "tous les contrats de la société, paginé,
// trié" : le construire côté client en découpant une réponse non bornée reviendrait à
// fabriquer une pagination fictive ET à télécharger une collection complète — interdit
// deux fois (LOT 2 §"aucun full", LOT 4 "ne reconstruis pas une logique métier").
//
// Décision : cet écran reste EMPLOYÉ-CENTRÉ. Rechercher un employé (même endpoint
// paginé/sécurisé que l'annuaire LOT 2, page_size réduite car c'est un sélecteur, pas
// un tableau) puis atteindre ses contrats via le Dossier 360° (LOT 3, onglet Contrats,
// lui-même appelé avec ?employee_id= borné). Aucune nouvelle route contrat n'est créée :
// le lien pointe simplement vers #/employees/{id} déjà construit et testé au LOT 3.
// LOT 5 : la recherche elle-même est désormais partagée avec assignments.mjs via
// _employee-picker.mjs (même besoin exact, deuxième consommateur) — comportement inchangé.
//
// Dette documentée (non corrigée ici, hors périmètre frontend) : DRH-NEXT-CONTRACTS-PAGE
// — un futur GET /drh/contracts/page paginé côté backend permettrait un vrai tableau
// "tous les contrats" ; sans lui, cet écran reste volontairement un sélecteur.
import { renderEmployeePicker } from "./_employee-picker.mjs";

export async function renderContracts() {
  renderEmployeePicker({
    viewSelector: "#dn-view",
    title: "Contrats",
    subtitle: "Recherchez un employé pour consulter ses contrats (aucune liste globale : le backend ne fournit pas de contrats paginés indépendamment d'un employé).",
    linkTargetHash: (id) => `#/employees/${id}`,
    linkLabel: "Voir ses contrats",
    cacheNamespace: "contracts-picker",
  });
}
