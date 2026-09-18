import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcola, calcolaColonna, costoVoce, fattoreVoce, gap, sensitivita, CATEGORIE,
} from '../src/calcolo.mjs';
import { nuovaSimulazione, normalizza, nomeFile } from '../src/modello.mjs';

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

test('manodopera senza tariffa associata costa zero, non NaN', () => {
  const v = { cat: 'manodopera', tariffaId: null, kom: { q: 120 } };
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
