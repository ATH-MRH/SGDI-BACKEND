// DRH NEXT — modules/leaves.mjs
//
// LOT 6 : écran "Congés" de la navigation principale.
//
// Audit backend : GET /drh/leaves?employee_id=&status= → list[LeaveOut], AUCUNE
// pagination (même limite que /drh/contracts, LOT 4). Même décision : sélecteur employé
// (partagé via _employee-picker.mjs), la gestion réelle (liste + demande + validation)
// vit dans le Dossier 360° (LOT 3, onglet Congés — enrichi ce lot avec la création et la
// validation, voir employee-dossier.mjs). Pas de seconde implémentation parallèle.
import { renderEmployeePicker } from "./_employee-picker.mjs";

export async function renderLeaves() {
  renderEmployeePicker({
    viewSelector: "#dn-view",
    title: "Congés",
    subtitle: "Recherchez un employé pour consulter, demander ou valider ses congés/absences (aucune liste globale : le backend ne fournit pas de congés paginés indépendamment d'un employé).",
    linkTargetHash: (id) => `#/employees/${id}`,
    linkLabel: "Voir ses congés",
    cacheNamespace: "leaves-picker",
  });
}
