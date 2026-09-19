// DRH NEXT — modules/employees.js
//
// LOT 1 : architecture de route SEULEMENT (§17 du lot). Aucune liste, aucune
// recherche, aucun dossier 360° ici — LOT 2 construira /employees réellement
// (liste paginée serveur via /api/drh/employees/page, recherche, filtres),
// LOT 3 le Dossier 360°. Ce module prouve juste que le routeur et le shell
// savent monter un module DRH NEXT réel sur cette route.
import { mount } from "../core/ui.mjs";

export async function renderEmployees() {
  mount("#dn-view", `<div class="dn-page-head"><h1>Employés</h1></div>
    <div class="dn-card dn-panel">
      <div class="dn-empty-state">Liste paginée, recherche et filtres arrivent au LOT 2.</div>
    </div>`);
}

export async function renderEmployeeDetail(params) {
  mount("#dn-view", `<div class="dn-page-head"><h1>Employé</h1></div>
    <div class="dn-card dn-panel">
      <div class="dn-empty-state">Dossier 360° (ID ${params?.id ? String(params.id).replace(/[<>&]/g, "") : "?"}) arrive au LOT 3.</div>
    </div>`);
}
