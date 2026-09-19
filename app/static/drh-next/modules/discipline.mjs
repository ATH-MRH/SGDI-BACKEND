// DRH NEXT — modules/discipline.mjs
//
// LOT 7 : écran "Discipline" de la navigation principale.
//
// Audit backend : GET /drh/sanctions?employee_id=&… → list[SanctionOut], AUCUNE
// pagination (même limite que contrats/congés). Même décision architecturale : sélecteur
// employé (partagé), la lecture + création réelle vit dans le Dossier 360° (LOT 3, onglet
// Discipline — enrichi ce lot avec la création, voir employee-dossier.mjs). Le backend ne
// modélise ni incident, ni convocation, ni commission, ni décision séparément — seul un
// enregistrement de sanction plat existe ; aucun de ces concepts n'est donc fabriqué ici.
//
// Sensibilité (mission §12) : ces données ne doivent JAMAIS être chargées dans l'annuaire
// général — respecté par construction : cet écran, comme le Dossier, n'appelle
// /drh/sanctions qu'après une recherche explicite + ouverture de l'onglet Discipline.
import { renderEmployeePicker } from "./_employee-picker.mjs";

export async function renderDiscipline() {
  renderEmployeePicker({
    viewSelector: "#dn-view",
    title: "Discipline",
    subtitle: "Recherchez un employé pour consulter ou enregistrer une sanction (aucune liste globale : ces données sensibles ne sont chargées qu'après recherche explicite).",
    linkTargetHash: (id) => `#/employees/${id}`,
    linkLabel: "Voir son dossier disciplinaire",
    cacheNamespace: "discipline-picker",
  });
}
