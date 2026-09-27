// DRH NEXT — écarts Attendance V1 : onglets Pointage (Attendance Core) et Biométrie du
// dossier, entrée « Pointage » du menu (plus d'écran « pas encore planifié »).
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
import { renderEmployeeDossier, _resetForTests as resetDossier } from "../../app/static/drh-next/modules/employee-dossier.mjs";
import { renderAttendance } from "../../app/static/drh-next/modules/attendance.mjs";
import { _resetForTests as resetLoader } from "../../app/static/drh-next/core/data-loader.mjs";
import fs from "node:fs";

const jsonResp = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
function setup() {
  const { window } = freshEnv();
  setUser({ username: "rh", authorizedSocieties: ["SOCIETE A"] });
  document.body.innerHTML = '<div id="dn-view"></div>';
  resetLoader(); resetDossier();
  return { window };
}

test("onglet Pointage : événements (source, caméra, auteur), anomalies et corrections avant/après", async () => {
  const { window } = setup();
  const data = {
    current: { status: "present", site: "SITE A", closed: false },
    days: [{ id: 3, date: "2027-04-05", site: "SITE A", status: "maladie", arrival: "", departure: "", closed: true }],
    events: [
      { id: 9, at: "2027-04-05T09:00:00+01:00", type: "CORRECTION", source: "MANUAL", site: "SITE A", actor: "DRH01", observation: "Certificat reçu", changes: { status: { avant: "absent", apres: "maladie" } } },
      { id: 8, at: "2027-04-05T07:58:00+01:00", type: "ARRIVAL", source: "FACIAL", site: "SITE A", actor: "PTG01", device_id: 7, observation: "" },
    ],
    anomalies: [{ id: 1, date: "2027-04-05", type: "LATE", severity: "warning", status: "OPEN", message: "Arrivée à 08:40" }],
  };
  window.fetch = async (url) => String(url).includes("/attendance/employees/1") ? jsonResp(data) : jsonResp({ id: 1, code: "E1", first_name: "A", last_name: "B" });
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="pointage"]').click();
  await tick(); await tick();
  const text = document.querySelector("#dn-dossier-panel").textContent;
  assert.match(text, /Correction/); assert.match(text, /absent → maladie/); assert.match(text, /Certificat reçu/);
  assert.match(text, /Facial/); assert.match(text, /caméra #7/); assert.match(text, /PTG01/);
  assert.match(text, /Arrivée à 08:40/); assert.match(text, /Clôturé/);
});

test("onglet Biométrie : chargé seulement à l'ouverture ; 403 expliqué, jamais masqué", async () => {
  const { window } = setup();
  const seen = [];
  window.fetch = async (url) => { seen.push(String(url)); return String(url).includes("/biometrics/") ? jsonResp({ detail: "Permission biométrique explicite requise" }, 403) : jsonResp({ id: 1, code: "E1" }); };
  await renderEmployeeDossier({ id: "1" });
  assert.equal(seen.some((u) => u.includes("/biometrics/")), false, "aucun appel biométrique avant l'ouverture de l'onglet");
  document.querySelector('[data-dn-tab="biometrie"]').click();
  await tick(); await tick();
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Permission biométrique requise/);
});

test("onglet Biométrie : état, historique, désactivation motivée", async () => {
  const { window } = setup();
  const status = { employee_id: 1, enabled: true, photo_available: true, enrollment: "ACTIVE",
    consent: { status: "contract_confirmed", proof_reference: "CDD art. 12", notice_version: "2026-09-v1", admissible: true },
    active_template: { id: 4, activated_at: "2027-04-01T10:00:00" },
    templates: [{ id: 4, status: "ACTIVE", source: "EMPLOYEE_PHOTO", created_at: "2027-04-01T10:00:00" }, { id: 2, status: "INACTIVE", source: "CAMERA", created_at: "2027-01-01T08:00:00", status_reason: "Remplacé par un nouvel enrôlement" }] };
  const posts = [];
  window.prompt = () => "Départ de l'employé";
  window.fetch = async (url, opts = {}) => {
    if ((opts.method || "GET") === "POST") { posts.push({ url: String(url), body: JSON.parse(opts.body) }); return jsonResp({ deactivated: 1 }); }
    return String(url).includes("/biometrics/") ? jsonResp(status) : jsonResp({ id: 1, code: "E1" });
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="biometrie"]').click();
  await tick(); await tick();
  const text = document.querySelector("#dn-dossier-panel").textContent;
  assert.match(text, /Accord du contrat confirmé/); assert.match(text, /CDD art\. 12/); assert.match(text, /Remplacé par un nouvel enrôlement/);
  document.querySelector("[data-dn-bio-deactivate]").click();
  await tick(); await tick();
  assert.deepEqual(posts[0], { url: posts[0].url, body: { reason: "Départ de l'employé" } });
  assert.match(posts[0].url, /\/biometrics\/employees\/1\/deactivate$/);
});

test("menu : plus d'entrée « Alertes » morte ; « Pointage » affiche les KPI réels du jour", async () => {
  const app = fs.readFileSync(new URL("../../app/static/drh-next/app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(app, /route: "alerts"/);
  assert.doesNotMatch(app, /renderComingSoon|pas encore planifié/);
  const { window } = setup();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp({ date: "2027-04-05", kpi: { expected: 12, present: 9, absent: 2, anomalies: 3 }, total: 12, items: [] }); };
  await renderAttendance();
  await tick(); await tick();
  const text = document.querySelector("#dn-view").textContent;
  assert.equal(calls.length, 1); assert.match(calls[0], /\/attendance\/board\?page_size=1$/);
  assert.match(text, /Effectif prévu12/); assert.match(text, /Anomalies ouvertes3/); assert.match(text, /centre de contrôle Pointage/);
});
