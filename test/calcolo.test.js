import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcola, calcolaStadio, valoreAStadio, riduzionePerValore, riduzionePerMargine,
  sensitivita, incidenze, STADI, RIDUZIONI, CATEGORIE,
} from '../src/calcolo.mjs';
import { nuovaSimulazione, simulazioneEsempio, normalizza, nomeFile, servizioStandard } from '../src/modello.mjs';

const vicino = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `atteso ${b}, ottenuto ${a}`);

function simMinima({ ricavo = 0, ridRicavo = {}, costo = 0, ridCosto = {}, riserva = 0, target = 0 } = {}) {
  return {
    parametri: { riservaPct: riserva, targetPct: target },
    servizi: [{
      id: 'S1',
      nome: 'Servizio',
      ricavo: { base: ricavo, rid: { trattativa: 0, kom: 0, simulato: 0, ...ridRicavo } },
      voci: [{
        id: 'V1', cat: 'materiale', nome: 'Materiale',
        base: costo, rid: { trattativa: 0, kom: 0, simulato: 0, ...ridCosto },
      }],
    }],
  };
}

test('le riduzioni si applicano in cascata, una per stadio', () => {
  const v = { base: 1000, rid: { trattativa: 10, kom: 20, simulato: 50 } };
  vicino(valoreAStadio(v, 'preventivo'), 1000);
  vicino(valoreAStadio(v, 'trattativa'), 900);
  vicino(valoreAStadio(v, 'kom'), 720);
  vicino(valoreAStadio(v, 'simulato'), 360);
});

test('una riduzione negativa e un aumento, ed e ammessa', () => {
  const v = { base: 1000, rid: { trattativa: -25, kom: 0, simulato: 0 } };
  vicino(valoreAStadio(v, 'trattativa'), 1250);
});

test('una voce senza riduzioni vale lo stesso in tutti gli stadi', () => {
  const v = { base: 500, rid: {} };
  for (const s of STADI) vicino(valoreAStadio(v, s), 500);
});

test('scrivendo il valore voluto si ricava la percentuale che lo produce', () => {
  const v = { base: 1000, rid: { trattativa: 10, kom: 0, simulato: 0 } };
  const p = riduzionePerValore(v, 'kom', 720);
  vicino(p, 20);
  v.rid.kom = p;
  vicino(valoreAStadio(v, 'kom'), 720);
});

test('il percorso inverso funziona su ogni stadio derivato', () => {
  for (const [i, stadio] of STADI.slice(1).entries()) {
    const v = { base: 800, rid: { trattativa: 5, kom: 5, simulato: 5 } };
    const p = riduzionePerValore(v, stadio, 600);
    v.rid[RIDUZIONI[i]] = p;
    vicino(valoreAStadio(v, stadio), 600);
  }
});

test('dal preventivo non si ricava alcuna percentuale: e il punto di partenza', () => {
  assert.equal(riduzionePerValore({ base: 100, rid: {} }, 'preventivo', 50), null);
});

test('da uno stadio precedente nullo non si ricava alcuna percentuale', () => {
  assert.equal(riduzionePerValore({ base: 0, rid: {} }, 'kom', 500), null);
});

test('margine di contribuzione e marginalita per stadio', () => {
  const r = calcolaStadio(simMinima({ ricavo: 1000, costo: 800 }), 'preventivo');
  vicino(r.mdc, 200);
  vicino(r.mdcPct, 0.2);
});

test('la marginalita e nulla e non infinita quando il ricavo e zero', () => {
  const r = calcolaStadio(simMinima({ ricavo: 0, costo: 500 }), 'preventivo');
  assert.equal(r.mdcPct, null);
  vicino(r.mdc, -500);
});

test('il margine industriale sottrae la sola riserva per imprevisti', () => {
  const r = calcolaStadio(simMinima({ ricavo: 1000, costo: 800, riserva: 5 }), 'preventivo');
  vicino(r.imprevisti, 40);
  vicino(r.mi, 160);
  vicino(r.miPct, 0.16);
});

test('senza riserva il margine industriale coincide con quello di contribuzione', () => {
  const r = calcolaStadio(simMinima({ ricavo: 1000, costo: 800 }), 'preventivo');
  vicino(r.mi, r.mdc);
});

test('al costo massimo il margine industriale coincide con l obiettivo', () => {
  const sim = simMinima({ ricavo: 1000, costo: 800, riserva: 5, target: 12 });
  const r = calcolaStadio(sim, 'preventivo');
  const prova = simMinima({ ricavo: 1000, costo: r.cdMax, riserva: 5, target: 12 });
  vicino(calcolaStadio(prova, 'preventivo').miPct, 0.12, 1e-9);
  vicino(r.spazio, r.cdMax - 800);
});

test('i passaggi fra stadi scompongono la variazione in effetto ricavo ed effetto costo', () => {
  const sim = simMinima({ ricavo: 1000, ridRicavo: { trattativa: 10 }, costo: 800, ridCosto: { trattativa: 25 } });
  const p = calcola(sim).passaggi[0];
  vicino(p.effettoRicavo, -100);
  vicino(p.effettoCosto, 200);
  vicino(p.effettoRicavo + p.effettoCosto, p.dMdc);
  vicino(p.dMdc, 100);
});

test('i passaggi sono tre, uno per riduzione, nell ordine giusto', () => {
  const p = calcola(simMinima({ ricavo: 100, costo: 50 })).passaggi;
  assert.equal(p.length, 3);
  assert.deepEqual(p.map((x) => x.riduzione), RIDUZIONI);
  assert.deepEqual(p.map((x) => x.a), ['trattativa', 'kom', 'simulato']);
});

test('la riduzione uniforme calcolata centra il margine voluto', () => {
  const sim = simulazioneEsempio();
  const r = riduzionePerMargine(sim, 30);
  assert.ok(r.possibile);
  for (const s of sim.servizi) for (const v of s.voci) v.rid.simulato = r.riduzionePct;
  vicino(calcolaStadio(sim, 'simulato').miPct, 0.30, 1e-9);
});

test('la riduzione uniforme tiene conto della riserva per imprevisti', () => {
  const sim = simMinima({ ricavo: 1000000, costo: 900000, riserva: 8 });
  const r = riduzionePerMargine(sim, 15);
  sim.servizi[0].voci[0].rid.simulato = r.riduzionePct;
  vicino(calcolaStadio(sim, 'simulato').miPct, 0.15, 1e-9);
});

test('un margine irraggiungibile da un motivo, non un numero', () => {
  assert.equal(riduzionePerMargine(simMinima({ ricavo: 1000, costo: 800 }), 100).possibile, false);
  assert.equal(riduzionePerMargine(nuovaSimulazione(), 12).possibile, false);
});

test('la sensitivita ordina le voci per guadagno decrescente e nomina la voce', () => {
  const s = sensitivita(simulazioneEsempio(), 10);
  assert.ok(s.righe.length >= 7);
  assert.match(s.righe[0].etichetta, /Componenti elettrici/);
  for (let i = 1; i < s.righe.length; i += 1) {
    assert.ok(s.righe[i - 1].guadagno >= s.righe[i].guadagno);
  }
});

test('una riduzione del dieci per cento rende il dieci per cento del costo simulato', () => {
  const sim = simMinima({ ricavo: 1000, costo: 800 });
  const r = sensitivita(sim, 10).righe[0];
  vicino(r.guadagno, 80);
});

test('le voci gia azzerate non compaiono fra i driver', () => {
  assert.equal(sensitivita(nuovaSimulazione(), 10).righe.length, 0);
});

test('le incidenze sui costi sommano a 100% in ogni stadio', () => {
  const sim = simulazioneEsempio();
  const { righe } = incidenze(sim, calcola(sim), 'cd');
  for (const st of STADI) {
    const somma = righe.filter((r) => r.tipo === 'voce').reduce((a, r) => a + r.valori[st], 0);
    vicino(somma, 1, 1e-9);
  }
});

test('una simulazione vuota non produce NaN in nessun totale', () => {
  const r = calcola(nuovaSimulazione());
  for (const st of Object.values(r.stadi)) {
    for (const [k, v] of Object.entries(st)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${st.stadio}.${k} non finito`);
    }
  }
});

test('la simulazione di partenza ha un solo servizio, Quadri elettrici', () => {
  const s = nuovaSimulazione();
  assert.equal(s.servizi.length, 1);
  assert.equal(s.servizi[0].nome, 'Quadri elettrici');
  assert.deepEqual(s.servizi[0].voci.map((v) => v.cat), ['materiale', 'manodopera', 'altri']);
});

test('normalizza ricostruisce da un file incompleto', () => {
  const sim = normalizza({ meta: { codice: 'C-1' }, servizi: [{ nome: 'Solo nome' }] });
  assert.equal(sim.meta.codice, 'C-1');
  assert.equal(sim.servizi[0].nome, 'Solo nome');
  assert.deepEqual(sim.servizi[0].voci, []);
  assert.doesNotThrow(() => calcola(sim));
});

test('normalizza tollera input non valido', () => {
  assert.equal(normalizza(null).servizi.length, 1);
  assert.equal(normalizza('rotto').versione, 2);
});

test('un file del modello precedente si apre conservando i numeri', () => {
  const vecchio = {
    meta: { codice: 'C-0' },
    parametri: { ctgPct: 3, targetPct: 10, sgPct: 9 },
    linee: [{
      id: 'L1', nome: 'Quadri elettrici',
      ricavo: { preventivo: 200000, kom: 190000 },
      voci: [{ id: 'V1', cat: 'materiale', nome: 'ABB', preventivo: { q: 100000, sconto: 40 }, kom: { q: 100000, sconto: 35 } }],
    }],
    delta: { voce: { V1: 10 } },
  };
  const sim = normalizza(vecchio);
  assert.equal(sim.servizi[0].nome, 'Quadri elettrici');
  vicino(sim.parametri.riservaPct, 3);
  vicino(valoreAStadio(sim.servizi[0].ricavo, 'preventivo'), 200000);
  vicino(valoreAStadio(sim.servizi[0].ricavo, 'kom'), 190000);
  vicino(valoreAStadio(sim.servizi[0].voci[0], 'preventivo'), 60000);
  vicino(valoreAStadio(sim.servizi[0].voci[0], 'kom'), 65000);
  vicino(valoreAStadio(sim.servizi[0].voci[0], 'simulato'), 65000 * 1.1);
});

test('i costi di struttura del vecchio modello non vengono piu applicati', () => {
  const sim = normalizza({ parametri: { sgPct: 20, ctgPct: 0 }, linee: [] });
  assert.equal(sim.parametri.riservaPct, 0);
  assert.ok(!('sgPct' in sim.parametri));
});

test('servizioStandard crea una voce per categoria', () => {
  const s = servizioStandard('Installazione cantiere');
  assert.equal(s.nome, 'Installazione cantiere');
  assert.deepEqual(s.voci.map((v) => v.cat), CATEGORIE);
});

test('il nome file e ordinabile e privo di caratteri problematici', () => {
  const sim = nuovaSimulazione();
  sim.meta.codice = 'C 2026/014 «speciale»';
  const n = nomeFile(sim);
  assert.match(n, /^[\w-]+_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
  assert.match(nomeFile(nuovaSimulazione()), /^senza-codice_/);
});
