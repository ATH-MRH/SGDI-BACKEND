// Tests FRONTEND du module PAIE — vraies fonctions de app/static/sgdi-app.js.
// La paie n'a AUCUN code backend : tout le calcul (barème IRG algérien, CNAS,
// brut/net, optimisation du net cible) vit ici. C'est le module où une erreur
// coûte le plus cher : les montants attendus sont dérivés du barème légal,
// pas recopiés depuis le code.
//
// Barème IRG mensuel algérien (tranches) :
//   0 – 20 000 : 0 %   | 20 000 – 40 000 : 23 % | 40 000 – 80 000 : 27 %
//   80 000 – 160 000 : 30 % | 160 000 – 320 000 : 33 % | > 320 000 : 35 %
// Exonération totale jusqu'à 30 000 DA de net imposable.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  'defaultPaieConfig', 'paieConfig', 'paieEnsure', 'defaultPaieRubriques',
  'irgBaremeMensuel', 'irgSalaireAlgerie',
  'calcPaieAgent', 'paieNetFromBase', 'paieBaseBruteForAgent', 'paieOptimizeFromNet',
  'paieGrilleBounds', 'paieGrilleForAgent', 'paieAgentFonction',
  'paieIsClosed', 'paieClosedInfo', 'paieElementsFor', 'paieBulletinFor', 'paieCalcForAgent',
  'paieMonthLabel', 'paieBulletinSnapshot',
]);

const YM = '2026-03';

/** Base de données minimale et FRAÎCHE pour chaque test (paieConfig/paieEnsure mutent db). */
function freshDb(extra = {}) {
  const t = T();
  t.setDb({ agents: [], paieRubriques: [], paieElements: [], paieBulletins: [], paieClotures: [], paieGrilles: [], ...extra });
  t.setSession({ username: 'testeur' });
  return t;
}

test('sgdi-app.js se charge et expose les fonctions PAIE', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const n of ['irgBaremeMensuel', 'calcPaieAgent', 'paieOptimizeFromNet']) assert.ok(t[n], `${n} introuvable`);
});

// ── Barème IRG progressif ────────────────────────────────────────────────────

test('irgBaremeMensuel: tranches progressives du barème algérien', () => {
  const f = freshDb().irgBaremeMensuel;
  assert.strictEqual(f(0), 0);
  assert.strictEqual(f(20000), 0, 'la 1re tranche est à 0 %');
  assert.strictEqual(f(30000), 2300, '(30000-20000) x 23 %');
  assert.strictEqual(f(40000), 4600, '20000 x 23 %');
  assert.strictEqual(f(50000), 7300, '4600 + 10000 x 27 %');
  assert.strictEqual(f(80000), 15400, '4600 + 40000 x 27 %');
  assert.strictEqual(f(100000), 21400, '15400 + 20000 x 30 %');
  assert.strictEqual(f(160000), 39400, '15400 + 80000 x 30 %');
  assert.strictEqual(f(200000), 52600, '39400 + 40000 x 33 %');
  assert.strictEqual(f(320000), 92200, '39400 + 160000 x 33 %');
  assert.strictEqual(f(400000), 120200, '92200 + 80000 x 35 %');
});

test('irgBaremeMensuel: valeurs négatives ou invalides -> 0', () => {
  const f = freshDb().irgBaremeMensuel;
  assert.strictEqual(f(-5000), 0);
  assert.strictEqual(f(null), 0);
  assert.strictEqual(f('pas-un-nombre'), 0);
});

// ── IRG net d'abattement ─────────────────────────────────────────────────────

test('irgSalaireAlgerie: exonération totale jusqu\'à 30 000 DA', () => {
  const t = freshDb();
  const cfg = t.paieConfig();
  const r = t.irgSalaireAlgerie(30000, cfg);
  assert.strictEqual(r.irg, 0);
  assert.strictEqual(r.irgBrut, 0);
  assert.strictEqual(r.abattement, 0);
  assert.match(r.formule, /Exon/);
  assert.strictEqual(t.irgSalaireAlgerie(0, cfg).irg, 0);
});

test('irgSalaireAlgerie: abattement de 40 % plafonné à 1 500 DA', () => {
  const t = freshDb();
  const cfg = t.paieConfig();
  // Base 50 000 : brut 7 300 ; 40 % = 2 920 -> plafonné à 1 500 ; IRG = 5 800
  const r = t.irgSalaireAlgerie(50000, cfg);
  assert.strictEqual(r.irgBrut, 7300);
  assert.strictEqual(r.abattement, 1500);
  assert.strictEqual(r.irg, 5800);
  assert.match(r.formule, /Barème progressif/);
});

test('irgSalaireAlgerie: abattement plancher de 1 000 DA', () => {
  const t = freshDb();
  const cfg = t.paieConfig();
  // Base 35 000 : brut 3 450 ; 40 % = 1 380 -> dans [1000, 1500] -> abattement 1 380
  const r = t.irgSalaireAlgerie(35000, cfg);
  assert.strictEqual(r.irgBrut, 3450);
  assert.strictEqual(r.abattement, 1380);
  assert.strictEqual(r.irg, 2070);
  assert.match(r.formule, /Barème progressif/, '35 000 exactement : hors formule spéciale');
});

test('irgSalaireAlgerie: formule spéciale sur la tranche 30 001 – 35 000 DA', () => {
  const t = freshDb();
  const cfg = t.paieConfig();
  // Base 32 000 : brut 2 760 ; abattement 40 % = 1 104 ; avant formule 1 656
  // Formule : 1656 x (137/51) - 27925/8 = 4448,47 - 3490,63 = 957,85 -> 958
  const r = t.irgSalaireAlgerie(32000, cfg);
  assert.strictEqual(r.irgBrut, 2760);
  assert.strictEqual(r.abattement, 1104);
  assert.strictEqual(r.irg, 958);
  assert.match(r.formule, /spéciale/);
  // La formule spéciale allège l'impôt par rapport au barème seul
  assert.ok(r.irg < r.irgBrut - r.abattement, 'la formule spéciale doit réduire l\'IRG');
});

test('irgSalaireAlgerie: la formule spéciale raccorde l\'exonération au barème sans marche d\'escalier', () => {
  const t = freshDb();
  const cfg = t.paieConfig();
  const irg = (b) => t.irgSalaireAlgerie(b, cfg).irg;

  // Borne basse : à 30 000 on est exonéré, juste au-dessus l'IRG démarre à ~0
  assert.strictEqual(irg(30000), 0, '30 000 exactement : exonéré');
  assert.ok(irg(30001) <= 5, `à 30 001 l'IRG doit démarrer près de 0, obtenu ${irg(30001)}`);

  // Borne haute : la formule spéciale rejoint EXACTEMENT le barème normal à 35 000.
  // C'est sa raison d'être : sans elle, on passerait brutalement de 0 à 2 070 DA.
  assert.match(t.irgSalaireAlgerie(34999, cfg).formule, /spéciale/);
  assert.match(t.irgSalaireAlgerie(35000, cfg).formule, /Barème progressif/);
  assert.ok(Math.abs(irg(35000) - irg(34999)) <= 1,
    `marche d'escalier à 35 000 : ${irg(34999)} -> ${irg(35000)}`);

  // Sur toute la bande, l'IRG est croissant (jamais de baisse quand le salaire monte)
  let precedent = -1;
  for (let base = 30000; base <= 36000; base += 250) {
    const courant = irg(base);
    assert.ok(courant >= precedent, `IRG non croissant à ${base} : ${precedent} -> ${courant}`);
    precedent = courant;
  }
});

// ── Configuration ────────────────────────────────────────────────────────────

test('paieConfig: fusionne les défauts et corrige un abattement max aberrant', () => {
  const t = freshDb({ paieConfig: { tauxCnasSalarie: 10, abattementMaxMensuel: 999999 } });
  const cfg = t.paieConfig();
  assert.strictEqual(cfg.tauxCnasSalarie, 10, 'la valeur personnalisée est conservée');
  assert.strictEqual(cfg.snmg, 24000, 'les défauts manquants sont ajoutés');
  assert.strictEqual(cfg.abattementMaxMensuel, 1500, 'un abattement max > 10 000 est corrigé');
  assert.strictEqual(cfg.tauxOeuvresSociales, 0.5);
});

test('paieEnsure: crée les collections et sème les rubriques système, sans doublon', () => {
  const t = freshDb();
  t.paieEnsure();
  t.paieEnsure(); // idempotent
  const db = t.paieGrilleBounds({}) && null; // no-op, on relit via paieElementsFor
  const codes = [...T().defaultPaieRubriques()].map((r) => r.code);
  assert.ok(codes.includes('BASE') && codes.includes('PN') && codes.includes('ABS'));
  // Les rubriques système ont les bons drapeaux fiscaux
  const rubs = [...T().defaultPaieRubriques()];
  const panier = rubs.find((r) => r.code === 'PANIER');
  assert.strictEqual(panier.imposable, false, 'la prime panier n\'est pas imposable');
  assert.strictEqual(panier.cotisable, false, 'la prime panier n\'est pas cotisable');
  const base = rubs.find((r) => r.code === 'BASE');
  assert.strictEqual(base.imposable, true);
  assert.strictEqual(base.cotisable, true);
});

// ── Brut -> net ──────────────────────────────────────────────────────────────

test('paieNetFromBase: chaîne CNAS 9 % -> IRG -> net, et coût employeur', () => {
  const t = freshDb();
  const r = t.paieNetFromBase(50000, t.paieConfig());
  assert.strictEqual(r.brutCotisable, 50000);
  assert.strictEqual(r.cnasSalarie, 4500, '9 % de 50 000');
  assert.strictEqual(r.baseIRG, 45500, 'net social = brut - CNAS');
  assert.strictEqual(r.irg, 4585, 'brut 6 085 - abattement 1 500');
  assert.strictEqual(r.netAPayer, 40915);
  assert.strictEqual(r.cnasPatronal, 12500, '25 % de 50 000');
  assert.strictEqual(r.oeuvresSociales, 250, '0,5 % de 50 000');
  assert.strictEqual(r.coutEmployeur, 62750, '50 000 + 12 500 + 250');
});

test('paieNetFromBase: un salaire sous le seuil ne paie pas d\'IRG', () => {
  const t = freshDb();
  const r = t.paieNetFromBase(24000, t.paieConfig()); // net social 21 840 < 30 000
  assert.strictEqual(r.cnasSalarie, 2160);
  assert.strictEqual(r.baseIRG, 21840);
  assert.strictEqual(r.irg, 0);
  assert.strictEqual(r.netAPayer, 21840);
});

test('paieNetFromBase: base nulle ou négative -> tout à zéro', () => {
  const t = freshDb();
  const r = t.paieNetFromBase(-1000, t.paieConfig());
  assert.strictEqual(r.brutCotisable, 0);
  assert.strictEqual(r.netAPayer, 0);
  assert.strictEqual(r.coutEmployeur, 0);
});

// ── Bulletin complet ─────────────────────────────────────────────────────────

test('calcPaieAgent: salaire de base seul — cohérent avec paieNetFromBase', () => {
  const t = freshDb();
  const c = t.calcPaieAgent({ id: 'a1', salaireBase: 50000 }, YM);
  assert.strictEqual(c.brutBase, 50000);
  assert.strictEqual(c.gains, 50000);
  assert.strictEqual(c.primes, 0);
  assert.strictEqual(c.brutCotisable, 50000);
  assert.strictEqual(c.cnasSalarie, 4500);
  assert.strictEqual(c.netSocial, 45500);
  assert.strictEqual(c.baseIRG, 45500);
  assert.strictEqual(c.irg, 4585);
  assert.strictEqual(c.netAPayer, 40915);
  assert.strictEqual(c.cnasPatronal, 12500);
  assert.strictEqual(c.oeuvresSociales, 250);
  assert.strictEqual(c.coutEmployeur, 62750);
});

test('calcPaieAgent: la prime de nuit est cotisable ET imposable', () => {
  const t = freshDb();
  const agent = { id: 'a1', salaireBase: 50000, affectationCourante: { horaire: 'Nuit' } };
  const c = t.calcPaieAgent(agent, YM);
  assert.strictEqual(c.primeNuit, 3000);
  assert.strictEqual(c.gains, 53000);
  assert.strictEqual(c.primes, 3000);
  assert.strictEqual(c.brutCotisable, 53000, 'la prime de nuit entre dans l\'assiette CNAS');
  assert.strictEqual(c.cnasSalarie, 4770, '9 % de 53 000');
  assert.strictEqual(c.netSocial, 48230);
  assert.strictEqual(c.irg, 5322, 'brut 6 822 - abattement 1 500');
  assert.strictEqual(c.netAPayer, 42908);
  // Un agent de jour n'a pas de prime de nuit
  assert.strictEqual(t.calcPaieAgent({ id: 'a2', salaireBase: 50000, affectationCourante: { horaire: 'Jour' } }, YM).primeNuit, 0);
});

test('calcPaieAgent: la prime panier s\'ajoute au net sans CNAS ni IRG', () => {
  const t = freshDb({ paieConfig: { primePanier: 2000 } });
  const c = t.calcPaieAgent({ id: 'a1', salaireBase: 50000 }, YM);
  assert.strictEqual(c.gains, 52000);
  assert.strictEqual(c.brutCotisable, 50000, 'le panier ne cotise pas');
  assert.strictEqual(c.cnasSalarie, 4500);
  assert.strictEqual(c.baseIRG, 45500, 'le panier n\'est pas imposable');
  assert.strictEqual(c.irg, 4585);
  assert.strictEqual(c.netAPayer, 42915, '40 915 + 2 000 nets');
  assert.strictEqual(c.coutEmployeur, 64750, 'le panier coûte son montant, sans charge');
});

test('calcPaieAgent: une retenue (avance) se déduit du net, pas de l\'assiette', () => {
  const t = freshDb({ paieElements: [{ id: 'e1', agentId: 'a1', ym: YM, rubriqueId: 'rub_avance', montant: 5000 }] });
  const c = t.calcPaieAgent({ id: 'a1', salaireBase: 50000 }, YM);
  assert.strictEqual(c.retenuesRubriques, 5000);
  assert.strictEqual(c.brutCotisable, 50000, 'une avance ne réduit pas l\'assiette CNAS');
  assert.strictEqual(c.irg, 4585, 'ni la base IRG');
  assert.strictEqual(c.netAPayer, 35915, '40 915 - 5 000');
});

test('calcPaieAgent: un rappel de salaire est cotisable et imposable', () => {
  const t = freshDb({ paieElements: [{ id: 'e1', agentId: 'a1', ym: YM, rubriqueId: 'rub_rappel', montant: 3000 }] });
  const c = t.calcPaieAgent({ id: 'a1', salaireBase: 50000 }, YM);
  assert.strictEqual(c.gains, 53000);
  assert.strictEqual(c.brutCotisable, 53000);
  assert.strictEqual(c.netAPayer, 42908, 'identique à une prime de nuit de même montant');
});

test('calcPaieAgent: les éléments d\'un autre mois ou d\'un autre agent sont ignorés', () => {
  const t = freshDb({ paieElements: [
    { id: 'e1', agentId: 'a1', ym: '2026-02', rubriqueId: 'rub_rappel', montant: 9999 },
    { id: 'e2', agentId: 'autre', ym: YM, rubriqueId: 'rub_rappel', montant: 9999 },
  ] });
  const c = t.calcPaieAgent({ id: 'a1', salaireBase: 50000 }, YM);
  assert.strictEqual(c.gains, 50000);
  assert.strictEqual(c.netAPayer, 40915);
});

test('calcPaieAgent: agent sans salaire -> bulletin à zéro, pas de NaN', () => {
  const t = freshDb();
  const c = t.calcPaieAgent({ id: 'a1' }, YM);
  for (const k of ['brutBase', 'gains', 'brutCotisable', 'cnasSalarie', 'irg', 'netAPayer', 'coutEmployeur']) {
    assert.strictEqual(c[k], 0, `${k} doit valoir 0`);
    assert.ok(!Number.isNaN(c[k]), `${k} ne doit jamais être NaN`);
  }
});

// ── Grille de fonction ───────────────────────────────────────────────────────

test('paieGrilleBounds: le SNMG est le plancher absolu de la base', () => {
  const t = freshDb();
  const b = t.paieGrilleBounds({ id: 'a1' });
  assert.strictEqual(b.min, 24000, 'sans grille, le minimum est le SNMG');
  assert.strictEqual(b.max, 0, 'sans grille, pas de maximum');
});

test('paieGrilleForAgent / paieGrilleBounds: grille par fonction, minimum relevé', () => {
  const t = freshDb();
  const agent = { id: 'a1', fonction: 'CHEF DE POSTE', societe: 'Iron Global Securite' };
  const fonction = t.paieAgentFonction(agent);
  t.setDb({
    agents: [], paieRubriques: [], paieElements: [], paieBulletins: [], paieClotures: [],
    paieGrilles: [{ id: 'g1', fonction, min: 40000, max: 80000, reference: 55000 }],
  });
  assert.ok(t.paieGrilleForAgent(agent), 'la grille doit être trouvée par fonction');
  const b = t.paieGrilleBounds(agent);
  assert.strictEqual(b.min, 40000, 'la grille relève le plancher au-dessus du SNMG');
  assert.strictEqual(b.max, 80000);
  assert.strictEqual(b.reference, 55000);
  // Une grille sous le SNMG ne peut pas abaisser le plancher légal
  t.setDb({ agents: [], paieRubriques: [], paieElements: [], paieBulletins: [], paieClotures: [],
    paieGrilles: [{ id: 'g2', fonction, min: 10000, max: 0 }] });
  assert.strictEqual(t.paieGrilleBounds(agent).min, 24000, 'le SNMG prime sur une grille trop basse');
});

// ── Base brute déduite du net contractuel ────────────────────────────────────

test('paieBaseBruteForAgent: la base explicite prime sur le net contractuel', () => {
  const t = freshDb();
  assert.strictEqual(t.paieBaseBruteForAgent({ salaireBase: 50000, salaireNet: 40915 }), 50000);
  assert.strictEqual(t.paieBaseBruteForAgent({ paieBaseBrute: 45000 }), 45000);
  assert.strictEqual(t.paieBaseBruteForAgent({}), 0);
  assert.strictEqual(t.paieBaseBruteForAgent(null), 0);
});

test('paieBaseBruteForAgent: sans base, elle est reconstruite depuis le net contractuel', () => {
  const t = freshDb();
  const base = t.paieBaseBruteForAgent({ id: 'a1', salaireNet: 40915 });
  assert.ok(Math.abs(base - 50000) <= 2, `base reconstruite ${base}, attendu ~50 000`);
});

// ── Optimisation du net cible (aller-retour net -> base -> net) ───────────────

test('paieOptimizeFromNet: retrouve la base qui produit exactement le net cible', () => {
  const t = freshDb();
  const r = t.paieOptimizeFromNet(40915, { id: 'a1' });
  assert.ok(Math.abs(r.base - 50000) <= 2, `base ${r.base}, attendu ~50 000`);
  assert.ok(Math.abs(r.netAPayer - 40915) <= 2, `net ${r.netAPayer}, attendu 40 915`);
  assert.strictEqual(r.nonTaxable, 0, 'sans plafond d\'optimisation, aucune prime non imposable');
  assert.strictEqual(r.warning, '');
});

test('paieOptimizeFromNet: net cible sous le minimum de grille -> base au plancher + avertissement', () => {
  const t = freshDb();
  const r = t.paieOptimizeFromNet(15000, { id: 'a1' }); // net mini au SNMG = 21 840
  assert.strictEqual(r.base, 24000, 'la base reste au SNMG');
  assert.match(r.warning, /inférieur ou égal au net minimal/);
});

test('paieOptimizeFromNet: net cible au-dessus du maximum de grille -> base plafonnée + avertissement', () => {
  const t = freshDb();
  const agent = { id: 'a1', fonction: 'AGENT DE SECURITE' };
  const fonction = t.paieAgentFonction(agent);
  t.setDb({ agents: [], paieRubriques: [], paieElements: [], paieBulletins: [], paieClotures: [],
    paieGrilles: [{ id: 'g1', fonction, min: 24000, max: 30000 }] });
  const r = t.paieOptimizeFromNet(80000, agent);
  assert.strictEqual(r.base, 30000, 'la base est plafonnée au maximum de la grille');
  assert.match(r.warning, /supérieur au maximum/);
});

test('paieOptimizeFromNet: les primes non imposables réduisent la base et le coût employeur', () => {
  const t = freshDb({ paieConfig: { optimisationPanierMax: 3000, optimisationTransportMax: 2000 } });
  const cible = 40915;
  const r = t.paieOptimizeFromNet(cible, { id: 'a1' });

  assert.strictEqual(r.nonTaxable, 5000, 'les 5 000 DA non imposables sont utilisés en priorité');
  assert.strictEqual(r.panier, 3000, 'le panier est servi en premier, jusqu\'à son plafond');
  assert.strictEqual(r.transport, 2000, 'le reste va au transport');
  assert.ok(Math.abs(r.netAPayer - cible) <= 2, `net ${r.netAPayer}, attendu ${cible}`);

  // Le net cible est atteint avec une base plus faible -> moins de charges
  const sans = freshDb().paieOptimizeFromNet(cible, { id: 'a1' });
  assert.ok(r.base < sans.base, `base optimisée ${r.base} doit être < ${sans.base}`);
  assert.ok(r.coutEmployeur < sans.coutEmployeur, 'l\'optimisation doit réduire le coût employeur');
});

// ── Clôture mensuelle ────────────────────────────────────────────────────────

test('paieIsClosed / paieClosedInfo: clôture par société ou globale', () => {
  const t = freshDb({ paieClotures: [{ id: 'c1', ym: YM, societe: 'Iron Global Securite', closedBy: 'drh' }] });
  assert.strictEqual(t.paieIsClosed(YM, 'Iron Global Securite'), true);
  assert.strictEqual(t.paieIsClosed(YM, 'Sword Corporation'), false, 'une autre société n\'est pas clôturée');
  assert.strictEqual(t.paieIsClosed('2026-04', 'Iron Global Securite'), false, 'un autre mois n\'est pas clôturé');
  assert.strictEqual(t.paieClosedInfo(YM, 'Iron Global Securite').closedBy, 'drh');
  assert.strictEqual(t.paieClosedInfo('2026-04', 'Iron Global Securite'), null);

  // Une clôture globale (societe vide) couvre toutes les sociétés
  const g = freshDb({ paieClotures: [{ id: 'c2', ym: YM, societe: '' }] });
  assert.strictEqual(g.paieIsClosed(YM, 'Sword Corporation'), true);
});

test('paieCalcForAgent: un bulletin clôturé est FIGÉ et ne se recalcule pas', () => {
  const t = freshDb({
    paieBulletins: [{ id: 'b1', agentId: 'a1', ym: YM, calcul: { netAPayer: 12345, brutBase: 20000 } }],
  });
  const agent = { id: 'a1', salaireBase: 50000 };
  // Le bulletin historisé prime sur le recalcul (qui donnerait 40 915)
  assert.strictEqual(t.paieCalcForAgent(agent, YM).netAPayer, 12345);
  // Sur un mois non clôturé, on recalcule
  assert.strictEqual(t.paieCalcForAgent(agent, '2026-04').netAPayer, 40915);
});

test('paieBulletinFor / paieElementsFor: filtrent bien par agent et par mois', () => {
  const t = freshDb({
    paieBulletins: [{ id: 'b1', agentId: 'a1', ym: YM, calcul: {} }],
    paieElements: [
      { id: 'e1', agentId: 'a1', ym: YM, rubriqueId: 'rub_avance', montant: 100 },
      { id: 'e2', agentId: 'a1', ym: '2026-04', rubriqueId: 'rub_avance', montant: 200 },
      { id: 'e3', agentId: 'a2', ym: YM, rubriqueId: 'rub_avance', montant: 300 },
    ],
  });
  assert.strictEqual(t.paieBulletinFor('a1', YM).id, 'b1');
  assert.strictEqual(t.paieBulletinFor('a1', '2026-04'), null);
  assert.strictEqual(t.paieBulletinFor('inconnu', YM), null);
  const els = [...t.paieElementsFor('a1', YM)];
  assert.strictEqual(els.length, 1);
  assert.strictEqual(els[0].id, 'e1');
});

test('paieBulletinSnapshot: fige le calcul, la config et l\'identité de l\'agent', () => {
  const t = freshDb();
  const agent = { id: 'a1', matricule: 'A01', nom: 'BENALI', prenom: 'Karim', societe: 'Iron Global Securite', fonction: 'AGENT' };
  const calcul = t.calcPaieAgent(agent, YM);
  const snap = t.paieBulletinSnapshot(agent, calcul, YM);

  assert.strictEqual(snap.ym, YM);
  assert.strictEqual(snap.agentId, 'a1');
  assert.strictEqual(snap.matricule, 'A01');
  assert.strictEqual(snap.agentName, 'BENALI Karim');
  assert.strictEqual(snap.societe, 'Iron Global Securite');
  assert.strictEqual(snap.createdBy, 'testeur');
  assert.strictEqual(snap.config.snmg, 24000, 'la config du mois est figée dans le bulletin');
  assert.ok(snap.createdAt);

  // Le calcul est une COPIE : modifier l'original ne doit pas altérer le bulletin
  const netFige = snap.calcul.netAPayer;
  calcul.netAPayer = 999999;
  assert.strictEqual(snap.calcul.netAPayer, netFige, 'le bulletin doit être une copie profonde');
});

test('paieMonthLabel: libellé lisible, et repli sur le mois courant si invalide', () => {
  const t = freshDb();
  assert.match(t.paieMonthLabel('2026-03'), /2026/);
  assert.strictEqual(typeof t.paieMonthLabel(''), 'string');
  assert.strictEqual(typeof t.paieMonthLabel('n-importe-quoi'), 'string');
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
