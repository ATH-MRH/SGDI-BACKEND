// BEO is a scoped adapter of the shared Attendance workspace; writes use the existing Core route.
(function () {
  "use strict";
  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.pointage = function (container) {
    const SW = window.SW;
    if (!window.AttendanceWorkspace) { container.innerHTML = SW.errorState(new Error("Composant Pointage indisponible")); return; }
    return window.AttendanceWorkspace.mount(container, {
      office: SW.state.user?.full_name || "Chargé des effectifs",
      registerLeave: callback => { SW.attendanceCanLeave = callback; },
      quickSearch: document.getElementById("beo-quick-search"),
      siteCount: () => SW.scopeSites(SW.state.scope.society).filter(s => !SW.state.scope.site_id || String(s.id) === SW.state.scope.site_id).length,
      epoch: () => SW.state.scopeEpoch,
      placeScope: slot => { const selectors = document.getElementById("scope-selectors"); if (selectors) slot.appendChild(selectors); },
      read: params => SW.guardedApi("pointage-workspace", "/site-workforce/attendance/workspace", { params }),
      write: body => SW.api("/site-workforce/attendance", { method: "POST", body }),
      correct: (id, body) => SW.api(`/site-workforce/attendance/${id}/correct`, { method: "POST", body }),
      close: day => SW.api("/site-workforce/attendance/close", { method: "POST", params: { presence_date: day } }),
    });
  };
})();
