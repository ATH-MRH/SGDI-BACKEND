const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "static", "recrute.html"), "utf8");

test("module recrutement: navigation latérale complète", () => {
  assert.match(source, /data-section="dashboard"[^>]*>.*Tableau de bord/s);
  assert.match(source, /data-section="candidates"[^>]*>.*Candidatures/s);
  assert.match(source, /data-section="interviews"[^>]*>.*Entretiens/s);
  assert.match(source, /data-section="announcements"[^>]*>.*Annonces recrutement/s);
  assert.match(source, /data-section="reserve"[^>]*>.*Réserve/s);
  assert.match(source, /data-section="archive"[^>]*>.*Archives/s);
});

test("annonces recrutement: cycle opérationnel disponible", () => {
  for (const fn of [
    "renderRecruitAnnouncements",
    "openAnnouncementForm",
    "saveRecruitAnnouncement",
    "setAnnouncementStatus",
    "deleteRecruitAnnouncement",
    "filterRecruitAnnouncements",
    "shareRecruitAnnouncement",
    "recruitAnnouncementPoster",
  ]) assert.match(source, new RegExp(`function ${fn}\\(`));
  assert.match(source, />Publier \/ Partager</);
  assert.match(source, />Clôturer</);
});

test("tableau de bord recrutement: indicateurs et accès rapides", () => {
  assert.match(source, /Nouvelles candidatures/);
  assert.match(source, /À convoquer/);
  assert.match(source, /Entretiens planifiés/);
  assert.match(source, /Transmis à la DRH/);
  assert.match(source, /Avancement du recrutement/);
  assert.match(source, /Candidatures à traiter/);
  assert.match(source, /Annonces actives/);
  assert.match(source, /function renderRecruitInterviews\(/);
});

test("recrutement: transmet le candidat à la DRH sans créer employé ni contrat", () => {
  assert.match(source, /function transmitCandidateToDrh\(/);
  assert.match(source, /marquer-contractualisation/);
  assert.match(source, /Aucun employé et aucun contrat ne seront créés/);
  assert.doesNotMatch(source, /onclick="openContractForCandidate\(\$\{item\.id\}\)">Recruter/);
  assert.doesNotMatch(source, /\{key:"contrat",label:"Contrat"\}/);
});
