// DRH NEXT — modules/assignments.mjs
//
// LOT 5 : écran "Affectations & mouvements RH".
//
// Audit backend (avant tout code) : le modèle Assignment (site/poste/dates/historique)
// vit exclusivement dans app/modules/ops/models.py et n'est exposé QUE sous
// /api/ops/assignments — un module DIFFÉRENT de /api/drh, gated séparément par
// enforce_module_access (permission "ops", indépendante de "drh" — voir
// app/modules/auth/dependencies.py). L'appeler depuis DRH Next romprait la séparation
// de modules déjà actée (mission DATA-1) et échouerait en 403 pour tout compte RH sans
// permission OPS — un vrai gestionnaire RH n'a normalement PAS cette permission.
// service.fiche_position() agrège bien les affectations, mais reste délibérément non
// utilisé ici (LOT 3 : "aucune requête massive regroupant tout le dossier").
//
// Capacité DRH réellement disponible : UNIQUEMENT l'affectation ACTIVE courante, déjà
// jointe côté serveur dans EmployeeOut (current_site_name, current_client_name,
// current_group_code, current_position — voir schemas.py) et déjà affichée par le
// Dossier 360° (LOT 3, onglet "Affectation"). Aucun historique de mouvements n'est
// accessible sous /api/drh — inventer une frise chronologique route par route serait
// fabriquer une donnée que le backend ne fournit pas (interdit explicitement).
//
// Décision : cet écran reste, comme Contrats (LOT 4), un sélecteur d'employé menant au
// Dossier 360° (onglet "Affectation", qui affiche déjà honnêtement "Historique des
// affectations non disponible pour le moment" dans l'onglet dédié) — pas de seconde
// implémentation parallèle de la même donnée. Dette documentée dès le LOT 3 :
// DRH-NEXT-ASSIGNMENT-HISTORY (inchangée, non corrigée ici : nécessiterait soit une
// route DRH dédiée côté backend, soit une décision d'architecture sur le partage
// OPS/DRH — hors périmètre d'un lot frontend).
import { renderEmployeePicker } from "./_employee-picker.mjs";

export async function renderAssignments() {
  renderEmployeePicker({
    viewSelector: "#dn-view",
    title: "Affectations & mouvements RH",
    subtitle: "Recherchez un employé pour consulter son affectation actuelle (site, client, poste). Aucun historique de mouvements n'est exposé par l'API DRH — voir l'onglet \"Affectation\" du dossier employé.",
    linkTargetHash: (id) => `#/employees/${id}`,
    linkLabel: "Voir son affectation",
    cacheNamespace: "assignments-picker",
  });
}
