// ATLAS V3 — modules-v3/drh/documents.mjs
//
// Adapté depuis employee-dossier.mjs DRH Next (sectionDocuments/wireDocumentsSection/
// openDocumentContent/documentActionsHTML), déjà audité et sécurisé (P0 DRH-NEXT-DOC-URL-AUTH
// fermée). RÈGLE ABSOLUE préservée (§13 de la mission) : d.file_path (URL /uploads/... brute)
// n'est JAMAIS utilisé comme src/href direct — un <img>/<a> statique n'envoie pas l'en-tête
// Authorization. Seule voie correcte : fetch() authentifié (api.getBlob) → Blob → URL objet
// locale (URL.createObjectURL), jamais l'URL API exposée dans le DOM. Chargé à la demande
// (clic), jamais eagerly pour toute la liste. GET /drh/documents?owner_type=employee&owner_id=X
// (métadonnées) + GET /drh/documents/{id}/content (blob, authentifié).
import { api } from "../../core-v3/api.mjs";
import { loadData } from "../../core-v3/data-loader.mjs";
import { escapeHTML, emptyStateHTML } from "../../core-v3/ui.mjs";

function documentActionsHTML(d) {
  if (!d.file_path) return "—";
  const mime = String(d.mime_type || "");
  if (mime.startsWith("image/")) {
    return `<span data-dn-doc-preview-slot="${d.id}"><button type="button" class="dn-btn" data-dn-doc-open="${d.id}" data-dn-doc-mime="${escapeHTML(mime)}">Aperçu</button></span>`;
  }
  return `<button type="button" class="dn-btn" data-dn-doc-open="${d.id}" data-dn-doc-mime="${escapeHTML(mime)}">Ouvrir</button>`;
}

export async function render(e) {
  const rows = await loadData(`drh:employee:${e.id}:documents`, (signal) => api.get(`/drh/documents?owner_type=employee&owner_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  if (!Array.isArray(rows) || !rows.length) return emptyStateHTML("Aucun document enregistré.");
  return `<table class="dn-table"><thead><tr><th>Libellé</th><th>Fichier</th><th>Type</th><th>Déposé par</th><th>Date</th><th></th></tr></thead><tbody>
    ${rows.map(d => `<tr><td>${escapeHTML(d.label || "—")}</td><td>${escapeHTML(d.file_name || "—")}</td><td>${escapeHTML(d.mime_type || "—")}</td><td>${escapeHTML(d.uploaded_by || "—")}</td><td>${escapeHTML((d.created_at || "").slice(0, 10) || "—")}</td><td>${documentActionsHTML(d)}</td></tr>`).join("")}
  </tbody></table>`;
}

export function wire() {
  document.querySelectorAll("[data-dn-doc-open]").forEach(btn => {
    btn.addEventListener("click", () => openDocumentContent(btn));
  });
}

async function openDocumentContent(btn) {
  const id = btn.getAttribute("data-dn-doc-open");
  const mime = btn.getAttribute("data-dn-doc-mime") || "";
  const originalLabel = btn.textContent;
  btn.setAttribute("disabled", "disabled");
  btn.textContent = "Chargement…";
  try {
    const blob = await api.getBlob(`/drh/documents/${encodeURIComponent(id)}/content`);
    const objectUrl = URL.createObjectURL(blob);
    if (mime.startsWith("image/")) {
      const slot = document.querySelector(`[data-dn-doc-preview-slot="${id}"]`);
      if (slot) slot.innerHTML = `<a href="${objectUrl}" target="_blank" rel="noopener"><img src="${objectUrl}" alt="Aperçu" style="max-width:64px;max-height:64px;border-radius:4px;display:block"></a>`;
    } else {
      window.open(objectUrl, "_blank", "noopener");
      btn.removeAttribute("disabled");
      btn.textContent = originalLabel;
    }
    // Révoquée après délai plutôt qu'immédiatement (le temps que l'onglet/l'<img> charge
    // l'URL objet) ; unref() (Node uniquement) évite de garder un test artificiellement vivant.
    const revokeTimer = setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    if (typeof revokeTimer?.unref === "function") revokeTimer.unref();
  } catch (err) {
    btn.removeAttribute("disabled");
    btn.textContent = err?.code === "FORBIDDEN" ? "Accès refusé" : (err?.code === "NOT_FOUND" ? "Introuvable" : "Erreur");
  }
}
