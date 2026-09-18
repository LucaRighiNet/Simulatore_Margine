import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcola, calcolaColonna, costoVoce, fattoreVoce, gap, sensitivita, baseSimulato, incidenze,
  modoManodopera, scostamentoPerMargine, CATEGORIE,
} from '../src/calcolo.mjs';
import { nuovaSimulazione, simulazioneEsempio, normalizza, nomeFile } from '../src/modello.mjs';

const vicino = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `atteso ${b}, ottenuto ${a}`);

function simMinima({ rPrev = 0, rKom = 0, cPrev = 0, cKom = 0, sg = 0, ctg = 0, target = 0 } = {}) {
  return {
    parametri: { sgPct: sg, ctgPct: ctg, targetPct: target },
    tariffe: [],
    linee: [{
      id: 'L1',
      nome: 'Linea',
      ricavo: { preventivo: rPrev, kom: rKom },
      voci: [{
        id: 'V1', cat: 'materiale', nome: 'Materiale',
        preventivo: { q: cPrev, sconto: 0 },
        kom: { q: cKom, sconto: 0 },
      }],
    }],
    delta: {},
  };
}

test('costo materiale applica lo sconto sul listino', () => {
  const v = { cat: 'materiale', kom: { q: 1000, sconto: 35 } };
  vicino(costoVoce(v, 'kom', []), 650);
});

test('costo manodopera è ore per tariffa oraria', () => {
  const tariffe = [{ id: 'T1', nome: 'Cablaggio', eurOra: 42.5 }];
  const v = { cat: 'manodopera', tariffaId: 'T1', kom: { q: 120 } };
  vicino(costoVoce(v, 'kom', tariffe), 5100);
});

test('manodopera senza tariffa vale come importo, non come zero silenzioso', () => {
  const v = { cat: 'manodopera', tariffaId: null, kom: { q: 12000 } };
  assert.equal(modoManodopera(v), 'importo');
  vicino(costoVoce(v, 'kom', []), 12000);
});

test('il modo esplicito vince sulla presenza della tariffa', () => {
  const tariffe = [{ id: 'T1', nome: 'Cablaggio', eurOra: 40 }];
  vicino(costoVoce({ cat: 'manodopera', modo: 'importo', tariffaId: 'T1', kom: { q: 900 } }, 'kom', tariffe), 900);
  vicino(costoVoce({ cat: 'manodopera', modo: 'ore', tariffaId: 'T1', kom: { q: 900 } }, 'kom', tariffe), 36000);
});

test('manodopera in ore con tariffa mancante non produce NaN', () => {
  const v = { cat: 'manodopera', modo: 'ore', tariffaId: 'inesistente', kom: { q: 120 } };
  assert.equal(costoVoce(v, 'kom', []), 0);
});

test('valori testuali con virgola decimale sono accettati', () => {
  const v = { cat: 'materiale', kom: { q: '1.234,50'.replace('.', ''), sconto: '10' } };
  vicino(costoVoce(v, 'kom', []), 1111.05);
});

test('margine di contribuzione e marginalità di linea', () => {
  const r = calcolaColonna(simMinima({ rKom: 1000, cKom: 800 }), 'kom');
  vicino(r.mdc, 200);
  vicino(r.mdcPct, 0.2);
  vicino(r.linee[0].mdcPct, 0.2);
});

test('marginalità è nulla e non infinita quando il ricavo è zero', () => {
  const r = calcolaColonna(simMinima({ rKom: 0, cKom: 500 }), 'kom');
  assert.equal(r.mdcPct, null);
  vicino(r.mdc, -500);
});

test('margine industriale sottrae spese generali e contingency sui costi diretti', () => {
  const r = calcolaColonna(simMinima({ rKom: 1000, cKom: 800, sg: 10, ctg: 5 }), 'kom');
  vicino(r.speseGenerali, 80);
  vicino(r.contingency, 40);
  vicino(r.mi, 1000 - 800 - 80 - 40);
  vicino(r.miPct, 0.08);
});

test('al costo di break-even il margine industriale coincide con l obiettivo', () => {
  const sim = simMinima({ rKom: 1000, cKom: 800, sg: 10, ctg: 5, target: 12 });
  const r = calcolaColonna(sim, 'kom');
  const prova = simMinima({ rKom: 1000, cKom: r.cdMax, sg: 10, ctg: 5, target: 12 });
  vicino(calcolaColonna(prova, 'kom').miPct, 0.12, 1e-9);
  vicino(r.riserva, r.cdMax - 800);
});

test('gli scostamenti si compongono moltiplicativamente sui quattro livelli', () => {
  const sim = simMinima({ rKom: 0, cKom: 1000 });
  sim.delta = {
    globale: 10,
    linea: { L1: 10 },
    catLinea: { 'L1|materiale': 10 },
    voce: { V1: 10 },
  };
  const f = fattoreVoce(sim, sim.linee[0], sim.linee[0].voci[0]);
  vicino(f, 1.1 ** 4);
  vicino(calcolaColonna(sim, 'simulato').cd, 1000 * 1.1 ** 4);
});

test('la colonna simulato deriva dal KOM e non dal preventivo', () => {
  const sim = simMinima({ cPrev: 500, cKom: 1000 });
  sim.delta = { globale: 50 };
  vicino(calcolaColonna(sim, 'simulato').cd, 1500);
  vicino(calcolaColonna(sim, 'preventivo').cd, 500);
});

test('il ricavo simulato risponde al proprio scostamento', () => {
  const sim = simMinima({ rKom: 1000, cKom: 0 });
  sim.delta = { ricavo: -5, ricavoLinea: { L1: -5 } };
  vicino(calcolaColonna(sim, 'simulato').ricavo, 1000 * 0.95 * 0.95);
});

test('esempio numerico del documento: le tre variazioni sono distinte e corrette', () => {
  const sim = simMinima({ rPrev: 1000000, cPrev: 820000, rKom: 960000, cKom: 825600 });
  const r = calcola(sim);
  vicino(r.colonne.preventivo.mdc, 180000);
  vicino(r.colonne.preventivo.mdcPct, 0.18);
  vicino(r.colonne.kom.mdc, 134400);
  vicino(r.colonne.kom.mdcPct, 0.14);

  const g = r.gapPreventivoKom;
  vicino(g.dMdc, -45600);          // variazione assoluta, euro
  vicino(g.dMdcPp, -4);            // variazione della marginalità, punti percentuali
  vicino(g.dMdcRel, -25.333333, 1e-5); // variazione relativa del margine, percentuale
  assert.notEqual(g.dMdcPp, g.dMdcRel, 'punti percentuali e percentuale non devono coincidere');
});

test('effetto ricavo ed effetto costo sommano esattamente alla variazione di margine', () => {
  const sim = simMinima({ rPrev: 1000000, cPrev: 820000, rKom: 960000, cKom: 825600 });
  const g = calcola(sim).gapPreventivoKom;
  vicino(g.effettoRicavo, -40000);
  vicino(g.effettoCosto, -5600);
  vicino(g.effettoRicavo + g.effettoCosto, g.dMdc);
});

test('la scomposizione per linea somma al totale', () => {
  const sim = nuovaSimulazione();
  sim.linee.forEach((l, i) => {
    l.ricavo = { preventivo: 100000 * (i + 1), kom: 95000 * (i + 1) };
    l.voci.forEach((v, j) => {
      v.preventivo = { q: 1000 * (j + 1), sconto: 0 };
      v.kom = { q: 1100 * (j + 1), sconto: 0 };
    });
  });
  const g = calcola(sim).gapPreventivoKom;
  const somma = g.perLinea.reduce((s, l) => s + l.effettoRicavo + l.effettoCosto, 0);
  vicino(somma, g.dMdc, 1e-6);
  for (const l of g.perLinea) {
    const sommaCat = CATEGORIE.reduce((s, c) => s + l.perCategoria[c], 0);
    vicino(sommaCat, l.effettoCosto, 1e-6);
  }
});

test('la variazione relativa non è definita se il margine di partenza non è positivo', () => {
  const a = calcolaColonna(simMinima({ rKom: 1000, cKom: 1200 }), 'kom');
  const b = calcolaColonna(simMinima({ rKom: 1000, cKom: 1100 }), 'kom');
  assert.equal(gap(a, b).dMdcRel, null);
});

test('la sensitività ordina i driver per ampiezza di impatto decrescente', () => {
  const sim = nuovaSimulazione();
  sim.linee[0].voci.find((v) => v.cat === 'materiale').kom = { q: 500000, sconto: 0 };
  sim.linee[1].voci.find((v) => v.cat === 'materiale').kom = { q: 1000, sconto: 0 };
  const s = sensitivita(sim, 10);
  assert.ok(s.righe.length > 1);
  for (let i = 1; i < s.righe.length; i += 1) {
    assert.ok(s.righe[i - 1].ampiezza >= s.righe[i].ampiezza);
  }
  assert.match(s.righe[0].etichetta, /Quadri elettrici/);
});

test('una simulazione vuota non produce NaN in nessun totale', () => {
  const r = calcola(nuovaSimulazione());
  for (const c of Object.values(r.colonne)) {
    for (const [k, v] of Object.entries(c)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${c.colonna}.${k} non finito`);
    }
  }
});

test('normalizza ricostruisce una simulazione da un file incompleto', () => {
  const sim = normalizza({ meta: { codice: 'C-1' }, linee: [{ nome: 'Solo nome' }] });
  assert.equal(sim.meta.codice, 'C-1');
  assert.equal(sim.linee[0].nome, 'Solo nome');
  assert.deepEqual(sim.linee[0].voci, []);
  assert.ok(sim.linee[0].id);
  assert.doesNotThrow(() => calcola(sim));
});

test('normalizza tollera input non valido', () => {
  assert.equal(normalizza(null).linee.length, 3);
  assert.equal(normalizza('rotto').versione, 1);
});

test('il nome file è ordinabile e privo di caratteri problematici', () => {
  const sim = nuovaSimulazione();
  sim.meta.codice = 'C 2026/014 «speciale»';
  const n = nomeFile(sim);
  assert.match(n, /^[\w-]+_\d{4}-\d{2}-\d{2}_\d{4}\.json$/, 'solo caratteri sicuri e data ordinabile');
  assert.ok(!/[\/\\:*?"<>|«»]/.test(n), 'nessun carattere vietato dal file system');
  assert.match(n, /^C-2026014-speciale_/, 'il codice resta riconoscibile');
  const vuoto = nuovaSimulazione();
  assert.match(nomeFile(vuoto), /^senza-codice_/, 'ricade su un nome valido se il codice manca');
});

test('se il KOM è vuoto la simulazione poggia sul preventivo', () => {
  const sim = simMinima({ rPrev: 1000, cPrev: 800, rKom: 0, cKom: 0 });
  sim.delta = { globale: 25 };
  assert.equal(baseSimulato(sim), 'preventivo');
  const s = calcolaColonna(sim, 'simulato');
  vicino(s.cd, 1000);      // 800 + 25%
  vicino(s.ricavo, 1000);  // ricavo di preventivo, nessuno scostamento sui ricavi
  assert.equal(s.base, 'preventivo');
});

test('appena il KOM ha un valore la simulazione torna a poggiare sul KOM', () => {
  const sim = simMinima({ rPrev: 1000, cPrev: 800, rKom: 0, cKom: 900 });
  assert.equal(baseSimulato(sim), 'kom');
  vicino(calcolaColonna(sim, 'simulato').cd, 900);
});

test('basta il solo ricavo KOM a spostare la base sul KOM', () => {
  const sim = simMinima({ rPrev: 1000, cPrev: 800, rKom: 950, cKom: 0 });
  assert.equal(baseSimulato(sim), 'kom');
});

test('con KOM vuoto i cursori muovono davvero il margine simulato', () => {
  const sim = simMinima({ rPrev: 1000, cPrev: 800 });
  const prima = calcolaColonna(sim, 'simulato').mdc;
  sim.delta = { globale: 10 };
  const dopo = calcolaColonna(sim, 'simulato').mdc;
  assert.notEqual(prima, dopo);
  vicino(dopo, 1000 - 880);
});

test('calcola dichiara su quale colonna poggia la simulazione', () => {
  assert.equal(calcola(simMinima({ rPrev: 1000, cPrev: 800 })).baseSimulazione, 'preventivo');
  assert.equal(calcola(simMinima({ rKom: 1000, cKom: 800 })).baseSimulazione, 'kom');
});

test('sui costi diretti le incidenze delle voci sommano a 100%', () => {
  const sim = simulazioneEsempio();
  const { righe } = incidenze(sim, calcola(sim), 'cd');
  for (const col of ['preventivo', 'kom', 'simulato']) {
    const somma = righe.filter((r) => r.tipo === 'voce').reduce((s, r) => s + r.valori[col], 0);
    vicino(somma, 1, 1e-9);
  }
});

test('sul ricavo le voci piu il margine di contribuzione sommano a 100%', () => {
  const sim = simulazioneEsempio();
  const { righe } = incidenze(sim, calcola(sim), 'ricavo');
  for (const col of ['preventivo', 'kom', 'simulato']) {
    const voci = righe.filter((r) => r.tipo === 'voce').reduce((s, r) => s + r.valori[col], 0);
    const mdc = righe.find((r) => r.tipo === 'margine').valori[col];
    vicino(voci + mdc, 1, 1e-9);
  }
});

test('le categorie sommano alla loro linea e le linee al totale', () => {
  const sim = simulazioneEsempio();
  const { righe } = incidenze(sim, calcola(sim), 'cd');
  const linee = righe.filter((r) => r.tipo === 'linea');
  vicino(linee.reduce((s, r) => s + r.valori.kom, 0), 1, 1e-9);
  // la prima linea: somma delle sue categorie
  const primaLinea = sim.linee[0];
  const cat = righe.filter((r) => r.tipo === 'categoria' && r.id.startsWith(primaLinea.id + '|'));
  vicino(cat.reduce((s, r) => s + r.valori.kom, 0), linee[0].valori.kom, 1e-9);
});

test('uno scostamento uniforme non muove le incidenze sui costi ma muove quelle sul ricavo', () => {
  const sim = simulazioneEsempio();
  sim.delta = { ricavo: 0, ricavoLinea: {}, globale: 12, linea: {}, catLinea: {}, voce: {} };
  const r = calcola(sim);

  const suCosti = incidenze(sim, r, 'cd').righe.filter((x) => x.tipo === 'voce');
  for (const riga of suCosti) vicino(riga.dKomSimulato, 0, 1e-9);

  const suRicavo = incidenze(sim, r, 'ricavo').righe.filter((x) => x.tipo === 'voce');
  assert.ok(suRicavo.some((x) => Math.abs(x.dKomSimulato) > 0.01),
    'sul ricavo almeno una voce deve muoversi');
});

test('uno scostamento su una sola categoria ne aumenta il peso sui costi e riduce gli altri', () => {
  const sim = simulazioneEsempio();
  const chiave = sim.linee[0].id + '|materiale';
  sim.delta = { ricavo: 0, ricavoLinea: {}, globale: 0, linea: {}, catLinea: { [chiave]: 20 }, voce: {} };
  const righe = incidenze(sim, calcola(sim), 'cd').righe;
  const colpita = righe.find((r) => r.tipo === 'categoria' && r.id === chiave);
  assert.ok(colpita.dKomSimulato > 0, 'la categoria toccata deve pesare di piu');
  const altra = righe.find((r) => r.tipo === 'categoria' && r.id !== chiave);
  assert.ok(altra.dKomSimulato < 0, 'le altre devono pesare di meno');
});

test('con denominatore nullo l incidenza è n.d. e non infinito', () => {
  const sim = simMinima({ rPrev: 0, cPrev: 0, rKom: 0, cKom: 0 });
  const righe = incidenze(sim, calcola(sim), 'cd').righe;
  for (const r of righe) {
    for (const v of Object.values(r.valori)) assert.equal(v, null);
    assert.equal(r.dPreventivoKom, null);
  }
});

test('partendo dal margine, lo scostamento sui costi lo centra esattamente', () => {
  const sim = simMinima({ rKom: 1000000, cKom: 850000, sg: 9, ctg: 2, target: 12 });
  const r = scostamentoPerMargine(sim, 12, 'costi');
  assert.ok(r.possibile);
  sim.delta = { globale: r.deltaPct };
  vicino(calcolaColonna(sim, 'simulato').miPct, 0.12, 1e-9);
});

test('partendo dal margine, lo scostamento sui ricavi lo centra esattamente', () => {
  const sim = simMinima({ rKom: 1000000, cKom: 850000, sg: 9, ctg: 2, target: 12 });
  const r = scostamentoPerMargine(sim, 12, 'ricavi');
  assert.ok(r.possibile);
  sim.delta = { ricavo: r.deltaPct };
  vicino(calcolaColonna(sim, 'simulato').miPct, 0.12, 1e-9);
});

test('il calcolo inverso funziona anche senza costi di struttura', () => {
  const sim = simMinima({ rKom: 500000, cKom: 400000 });
  for (const leva of ['costi', 'ricavi']) {
    const s = simMinima({ rKom: 500000, cKom: 400000 });
    const r = scostamentoPerMargine(s, 25, leva);
    assert.ok(r.possibile, leva);
    s.delta = leva === 'costi' ? { globale: r.deltaPct } : { ricavo: r.deltaPct };
    vicino(calcolaColonna(s, 'simulato').miPct, 0.25, 1e-9);
  }
  void sim;
});

test('il calcolo inverso parte dallo stato simulato corrente, scostamenti inclusi', () => {
  const sim = simMinima({ rKom: 1000000, cKom: 800000, sg: 10 });
  sim.delta = { globale: 15, ricavo: -5 };
  const r = scostamentoPerMargine(sim, 10, 'costi');
  sim.delta = { ...sim.delta, globale: r.deltaPct };
  vicino(calcolaColonna(sim, 'simulato').miPct, 0.10, 1e-9);
});

test('sull esempio reale il margine obiettivo si raggiunge da entrambe le leve', () => {
  for (const leva of ['costi', 'ricavi']) {
    const s = simulazioneEsempio();
    const r = scostamentoPerMargine(s, 12, leva);
    assert.ok(r.possibile, leva);
    s.delta = { ...s.delta, ...(leva === 'costi' ? { globale: r.deltaPct } : { ricavo: r.deltaPct }) };
    vicino(calcolaColonna(s, 'simulato').miPct, 0.12, 1e-9);
  }
});

test('un margine irraggiungibile o dati mancanti danno un motivo, non un numero', () => {
  const vuota = nuovaSimulazione();
  assert.equal(scostamentoPerMargine(vuota, 12, 'costi').possibile, false);
  assert.equal(scostamentoPerMargine(vuota, 12, 'ricavi').possibile, false);
  const s = simMinima({ rKom: 1000, cKom: 800 });
  const r = scostamentoPerMargine(s, 100, 'costi');
  assert.equal(r.possibile, false);
  assert.match(r.motivo, /100%/);
});

test('per alzare il margine i costi devono scendere e i ricavi salire', () => {
  const s = simMinima({ rKom: 1000000, cKom: 900000 });  // marginalita 10%
  const c = scostamentoPerMargine(s, 20, 'costi');
  const v = scostamentoPerMargine(s, 20, 'ricavi');
  assert.ok(c.deltaPct < 0, 'i costi devono scendere');
  assert.ok(v.deltaPct > 0, 'i ricavi devono salire');
});
