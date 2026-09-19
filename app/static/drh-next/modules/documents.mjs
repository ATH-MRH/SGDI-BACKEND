// DRH NEXT — modules/documents.mjs
//
// LOT 8 : écran "Documents" de la navigation principale.
//
// Audit backend : GET /drh/documents?owner_type=&owner_id= → list[DocumentOut], AUCUNE
// pagination (même limite que les autres sections employé-centrées). AUCUNE route
// d'upload de fichier pour ce modèle générique (voir audit détaillé dans
// employee-dossier.mjs::sectionDocuments) — cet écran reste donc, comme Contrats/
// Congés/Discipline, un sélecteur menant au Dossier 360° (LOT 3, onglet Documents,
// enrichi ce lot avec métadonnées + aperçu image). Aucune capacité de dépôt fabriquée.
import { renderEmployeePicker } from "./_employee-picker.mjs";

export async function renderDocuments() {
  renderEmployeePicker({
    viewSelector: "#dn-view",
    title: "Documents",
    subtitle: "Recherchez un employé pour consulter ses documents (aucune liste globale : le backend ne fournit pas de documents paginés indépendamment d'un employé, ni de dépôt de fichier pour ce module).",
    linkTargetHash: (id) => `#/employees/${id}`,
    linkLabel: "Voir ses documents",
    cacheNamespace: "documents-picker",
  });
}
