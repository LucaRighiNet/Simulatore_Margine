// Modello dati della simulazione: valori di default, voci suggerite, serializzazione.
// Separato dal motore perché qui vivono le convenzioni aziendali, che cambiano,
// mentre le formule no.

import { RIDUZIONI, STADI, valoreAStadio, indiceStadio } from './calcolo.mjs';

export const VERSIONE_SCHEMA = 2;

let contatore = 0;
export function id(prefisso = 'x') {
  contatore += 1;
  return prefisso + '-' + Date.now().toString(36) + '-' + contatore.toString(36);
}

/** Voci suggerite nel menu "aggiungi", per categoria. L'elenco è un aiuto, non un vincolo. */
export const SUGGERIMENTI = {
  materiale: [
    'ABB', 'Siemens', 'Schneider', 'Rittal', 'Phoenix Contact', 'Weidmuller',
    'Componenti elettrici', 'Carpenteria e quadro', 'Cavi', 'Minuteria',
    'Strumentazione', 'Materiale di installazione', 'Altro materiale',
  ],
  manodopera: [
    'Produzione e cablaggio', 'Ingegneria elettrica', 'Ingegneria software',
    'Montaggio in cantiere', 'Messa in servizio', 'Project management',
  ],
  altri: [
    'Trasferte e viaggi', 'Vitto e alloggio', 'Noleggi', 'Trasporti e logistica',
    'Subappalti e terzisti', 'Collaudi e certificazioni', 'Attrezzature di cantiere',
    'Sicurezza e DPI', 'Altro costo diretto',
  ],
};

export const NOMI_SERVIZI = ['Quadri elettrici', 'Installazione cantiere', 'Commissioning'];

const ETICHETTA_CAT = {
  materiale: 'Materiale',
  manodopera: 'Manodopera',
  altri: 'Altri costi diretti',
};

const riduzioniVuote = () => ({ trattativa: 0, kom: 0, simulato: 0 });

export function nuovaVoce(cat, nome) {
  return { id: id('v'), cat, nome, base: 0, rid: riduzioniVuote() };
}

export function nuovoServizio(nome) {
  return { id: id('s'), nome, ricavo: { base: 0, rid: riduzioniVuote() }, voci: [] };
}

/** Servizio con una voce per categoria: la forma minima con cui si comincia. */
export function servizioStandard(nome) {
  const s = nuovoServizio(nome);
  s.voci = ['materiale', 'manodopera', 'altri'].map((c) => nuovaVoce(c, ETICHETTA_CAT[c]));
  return s;
}

export function nomiServiziStandard() {
  return NOMI_SERVIZI.slice();
}

export function nuovaSimulazione() {
  return {
    versione: VERSIONE_SCHEMA,
    meta: {
      codice: '',
      cliente: '',
      descrizione: '',
      data: new Date().toISOString().slice(0, 10),
      autore: '',
      note: '',
    },
    parametri: { riservaPct: 0, targetPct: 0 },
    servizi: [servizioStandard('Quadri elettrici')],
  };
}

function normalizzaRid(raw) {
  const r = riduzioniVuote();
  for (const k of RIDUZIONI) {
    const v = raw && raw[k];
    r[k] = Number.isFinite(Number(v)) ? Number(v) : 0;
  }
  return r;
}

/**
 * Converte una voce del vecchio modello, che aveva due colonne di valori assoluti e uno
 * scostamento simulato, nel modello a stadi. Il preventivo diventa la base, la differenza
 * fino al KOM diventa la riduzione di quello stadio, e lo scostamento simulato la terza.
 * Nessun numero cambia: cambia solo il modo in cui è espresso.
 */
function migraVoce(v, deltaVoce) {
  const netto = (c) => {
    const d = v[c] || {};
    const q = Number(d.q) || 0;
    const sconto = Number(d.sconto) || 0;
    if (v.cat === 'manodopera' && v.modo === 'ore') return 0; // le tariffe non esistono più
    return q * (1 - sconto / 100);
  };
  const prev = netto('preventivo');
  const kom = netto('kom');
  const base = prev || kom;
  const rid = riduzioniVuote();
  if (base > 0 && kom > 0) rid.kom = (1 - kom / base) * 100;
  if (Number.isFinite(Number(deltaVoce))) rid.simulato = -Number(deltaVoce);
  return { id: v.id || id('v'), cat: v.cat || 'materiale', nome: v.nome || 'Voce', base, rid };
}

/** Normalizza una simulazione caricata da file, migrando il modello precedente. */
export function normalizza(raw) {
  const base = nuovaSimulazione();
  if (!raw || typeof raw !== 'object') return base;

  const parametriGrezzi = raw.parametri || {};
  const sim = {
    versione: VERSIONE_SCHEMA,
    meta: { ...base.meta, ...(raw.meta || {}) },
    parametri: {
      riservaPct: Number(parametriGrezzi.riservaPct ?? parametriGrezzi.ctgPct) || 0,
      targetPct: Number(parametriGrezzi.targetPct) || 0,
    },
    servizi: [],
  };

  const sorgente = Array.isArray(raw.servizi) ? raw.servizi
    : Array.isArray(raw.linee) ? raw.linee
      : base.servizi;
  const delta = raw.delta || {};

  sim.servizi = sorgente.map((s) => {
    const voci = (s.voci || []).map((v) => (
      v.rid || typeof v.base === 'number'
        ? { id: v.id || id('v'), cat: v.cat || 'materiale', nome: v.nome || 'Voce', base: Number(v.base) || 0, rid: normalizzaRid(v.rid) }
        : migraVoce(v, (delta.voce || {})[v.id])
    ));

    let ricavo;
    if (s.ricavo && typeof s.ricavo.base === 'number') {
      ricavo = { base: Number(s.ricavo.base) || 0, rid: normalizzaRid(s.ricavo.rid) };
    } else {
      const prev = Number((s.ricavo || {}).preventivo) || 0;
      const kom = Number((s.ricavo || {}).kom) || 0;
      const b = prev || kom;
      const rid = riduzioniVuote();
      if (b > 0 && kom > 0) rid.kom = (1 - kom / b) * 100;
      ricavo = { base: b, rid };
    }

    return { id: s.id || id('s'), nome: s.nome || 'Servizio', ricavo, voci };
  });

  if (!sim.servizi.length) sim.servizi = base.servizi;
  return sim;
}

/** Nome file dell'archivio: leggibile, ordinabile, senza caratteri problematici. */
export function nomeFile(sim) {
  const pulisci = (s) => String(s || '').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 40);
  const codice = pulisci(sim.meta.codice) || 'senza-codice';
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  return `${codice}_${stamp}.json`;
}

// --- commessa di esempio -------------------------------------------------------------

// [categoria, nome, base, % trattativa, % kom, % simulato]
const ESEMPIO_VOCI = [
  ['materiale', 'Componenti elettrici', 108000, 2, 0, 5],
  ['materiale', 'Carpenteria e quadro', 24500, 0, 0, 3],
  ['materiale', 'Cavi e minuteria', 10500, 0, 0, 0],
  ['manodopera', 'Produzione e cablaggio', 19760, 0, 0, 6],
  ['manodopera', 'Ingegneria elettrica', 10400, 0, 0, 0],
  ['manodopera', 'Ingegneria software', 8120, 0, 0, 0],
  ['altri', 'Trasporti e logistica', 3200, 0, 0, 0],
];

/**
 * Commessa di esempio, dichiaratamente fittizia. Serve perché lo strumento si apra in uno
 * stato operativo invece che su una maschera vuota. I valori sono plausibili per una
 * commessa di automazione industriale ma non sono dati reali.
 */
export function simulazioneEsempio() {
  const s = nuovaSimulazione();
  s.meta = {
    codice: 'C-2026-014',
    cliente: 'Cliente dimostrativo',
    descrizione: 'ESEMPIO — sostituire con i dati della commessa reale',
    data: new Date().toISOString().slice(0, 10),
    autore: '',
    note: '',
  };
  s.parametri = { riservaPct: 2, targetPct: 12 };

  const servizio = nuovoServizio('Quadri elettrici');
  servizio.ricavo = { base: 240000, rid: { trattativa: 3.333, kom: 0, simulato: 0 } };
  servizio.voci = ESEMPIO_VOCI.map(([cat, nome, valore, t, k, si]) => {
    const v = nuovaVoce(cat, nome);
    v.base = valore;
    v.rid = { trattativa: t, kom: k, simulato: si };
    return v;
  });
  s.servizi = [servizio];
  return s;
}

/** Riconosce l'esempio, per poterlo segnalare senza salvarne un contrassegno nel file. */
export function eEsempio(sim) {
  return String(sim?.meta?.descrizione || '').startsWith('ESEMPIO');
}

void STADI; void valoreAStadio; void indiceStadio;
