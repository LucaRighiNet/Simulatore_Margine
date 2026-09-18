// Modello dati della simulazione: valori di default, voci suggerite, serializzazione.
// Separato dal motore di calcolo perché qui vivono le convenzioni aziendali, che cambiano,
// mentre le formule no.

export const VERSIONE_SCHEMA = 1;

let contatore = 0;
export function id(prefisso = 'x') {
  contatore += 1;
  return prefisso + '-' + Date.now().toString(36) + '-' + contatore.toString(36);
}

/** Tipi di manodopera con tariffa oraria centralizzata. Le tariffe partono vuote di proposito. */
export const TARIFFE_DEFAULT = [
  'Produzione e cablaggio',
  'Ingegneria elettrica',
  'Ingegneria software',
  'Montaggio in cantiere',
  'Messa in servizio',
  'Project management',
];

/** Voci suggerite nel menu "aggiungi", per categoria. L'elenco è un aiuto, non un vincolo. */
export const SUGGERIMENTI = {
  materiale: [
    'ABB', 'Siemens', 'Schneider', 'Rittal', 'Phoenix Contact', 'Weidmuller',
    'Componenti elettrici', 'Carpenteria e quadro', 'Cavi', 'Minuteria',
    'Strumentazione', 'Materiale di installazione', 'Altro materiale',
  ],
  manodopera: TARIFFE_DEFAULT,
  altri: [
    'Trasferte e viaggi', 'Vitto e alloggio', 'Noleggi', 'Trasporti e logistica',
    'Subappalti e terzisti', 'Collaudi e certificazioni', 'Attrezzature di cantiere',
    'Sicurezza e DPI', 'Altro costo diretto',
  ],
};

export const LINEE_DEFAULT = [
  {
    nome: 'Quadri elettrici',
    voci: [
      ['materiale', 'Componenti elettrici'],
      ['materiale', 'Carpenteria e quadro'],
      ['materiale', 'Cavi e minuteria'],
      ['manodopera', 'Produzione e cablaggio'],
      ['manodopera', 'Ingegneria elettrica'],
      ['manodopera', 'Ingegneria software'],
      ['altri', 'Trasporti e logistica'],
    ],
  },
  {
    nome: 'Installazione cantiere',
    voci: [
      ['materiale', 'Materiale di installazione'],
      ['manodopera', 'Montaggio in cantiere'],
      ['altri', 'Trasferte e viaggi'],
      ['altri', 'Vitto e alloggio'],
      ['altri', 'Noleggi'],
      ['altri', 'Subappalti e terzisti'],
    ],
  },
  {
    nome: 'Commissioning',
    voci: [
      ['manodopera', 'Messa in servizio'],
      ['manodopera', 'Ingegneria software'],
      ['altri', 'Trasferte e viaggi'],
      ['altri', 'Vitto e alloggio'],
    ],
  },
];

export function nuovaVoce(cat, nome, tariffe) {
  const v = {
    id: id('v'),
    cat,
    nome,
    preventivo: { q: 0, sconto: 0 },
    kom: { q: 0, sconto: 0 },
  };
  if (cat === 'manodopera') {
    const t = (tariffe || []).find((x) => x.nome === nome);
    v.tariffaId = t ? t.id : null;
  }
  return v;
}

export function nuovaTariffa(nome, eurOra = 0) {
  return { id: id('t'), nome, eurOra };
}

export function nuovaLinea(nome) {
  return { id: id('l'), nome, ricavo: { preventivo: 0, kom: 0 }, voci: [] };
}

/** Nomi delle linee di servizio predefinite, per poterle reinserire dopo una cancellazione. */
export function nomiLineeStandard() {
  return LINEE_DEFAULT.map((d) => d.nome);
}

/** Ricrea una linea standard completa delle sue voci di default. */
export function lineaStandard(nome, tariffe) {
  const def = LINEE_DEFAULT.find((d) => d.nome === nome);
  const l = nuovaLinea(nome);
  if (def) l.voci = def.voci.map(([cat, n]) => nuovaVoce(cat, n, tariffe));
  return l;
}

export function nuovaSimulazione() {
  const tariffe = TARIFFE_DEFAULT.map((n) => nuovaTariffa(n, 0));
  const linee = LINEE_DEFAULT.map((def) => {
    const l = nuovaLinea(def.nome);
    l.voci = def.voci.map(([cat, nome]) => nuovaVoce(cat, nome, tariffe));
    return l;
  });
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
    parametri: { sgPct: 0, ctgPct: 0, targetPct: 0, validitaTariffe: '' },
    tariffe,
    linee,
    delta: { ricavo: 0, ricavoLinea: {}, globale: 0, linea: {}, catLinea: {}, voce: {} },
  };
}

/** Normalizza una simulazione caricata da file, tollerando campi mancanti. */
export function normalizza(raw) {
  const base = nuovaSimulazione();
  if (!raw || typeof raw !== 'object') return base;
  const sim = {
    versione: VERSIONE_SCHEMA,
    meta: { ...base.meta, ...(raw.meta || {}) },
    parametri: { ...base.parametri, ...(raw.parametri || {}) },
    tariffe: Array.isArray(raw.tariffe) && raw.tariffe.length ? raw.tariffe : base.tariffe,
    linee: Array.isArray(raw.linee) ? raw.linee : base.linee,
    delta: { ...base.delta, ...(raw.delta || {}) },
  };
  sim.linee = sim.linee.map((l) => ({
    id: l.id || id('l'),
    nome: l.nome || 'Linea',
    ricavo: { preventivo: 0, kom: 0, ...(l.ricavo || {}) },
    voci: (l.voci || []).map((v) => ({
      id: v.id || id('v'),
      cat: v.cat || 'materiale',
      nome: v.nome || 'Voce',
      tariffaId: v.tariffaId ?? null,
      preventivo: { q: 0, sconto: 0, ...(v.preventivo || {}) },
      kom: { q: 0, sconto: 0, ...(v.kom || {}) },
    })),
  }));
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

/**
 * Commessa di esempio, dichiaratamente fittizia. Serve perché il tool si apra in uno stato
 * operativo invece che su una maschera vuota: chi lo apre la prima volta vede subito cosa fa.
 * I valori sono plausibili per una commessa di automazione industriale ma non sono dati reali.
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
  s.parametri = { sgPct: 9, ctgPct: 2, targetPct: 12, validitaTariffe: '' };

  const tariffe = {
    'Produzione e cablaggio': 38,
    'Ingegneria elettrica': 52,
    'Ingegneria software': 58,
    'Montaggio in cantiere': 41,
    'Messa in servizio': 46,
    'Project management': 62,
  };
  s.tariffe.forEach((t) => { t.eurOra = tariffe[t.nome] ?? 0; });

  // [nome voce, preventivo q, preventivo sconto, kom q, kom sconto]
  const dati = {
    'Quadri elettrici': {
      ricavo: [240000, 232000],
      voci: [
        ['Componenti elettrici', 180000, 40, 180000, 37],
        ['Carpenteria e quadro', 35000, 30, 35000, 30],
        ['Cavi e minuteria', 14000, 25, 14000, 25],
        ['Produzione e cablaggio', 520, 0, 560, 0],
        ['Ingegneria elettrica', 200, 0, 210, 0],
        ['Ingegneria software', 140, 0, 160, 0],
        ['Trasporti e logistica', 3200, 0, 3500, 0],
      ],
    },
    'Installazione cantiere': {
      ricavo: [140000, 136000],
      voci: [
        ['Materiale di installazione', 28000, 20, 29000, 20],
        ['Montaggio in cantiere', 900, 0, 980, 0],
        ['Trasferte e viaggi', 12000, 0, 14000, 0],
        ['Vitto e alloggio', 9500, 0, 10500, 0],
        ['Noleggi', 6500, 0, 7000, 0],
        ['Subappalti e terzisti', 18000, 0, 21000, 0],
      ],
    },
    Commissioning: {
      ricavo: [86000, 84000],
      voci: [
        ['Messa in servizio', 620, 0, 680, 0],
        ['Ingegneria software', 220, 0, 240, 0],
        ['Trasferte e viaggi', 13500, 0, 14500, 0],
        ['Vitto e alloggio', 10500, 0, 11000, 0],
      ],
    },
  };

  for (const linea of s.linee) {
    const d = dati[linea.nome];
    if (!d) continue;
    linea.ricavo = { preventivo: d.ricavo[0], kom: d.ricavo[1] };
    for (const [nome, pq, ps, kq, ks] of d.voci) {
      const v = linea.voci.find((x) => x.nome === nome);
      if (!v) continue;
      v.preventivo = { q: pq, sconto: ps };
      v.kom = { q: kq, sconto: ks };
    }
  }
  s.delta = { ricavo: 0, ricavoLinea: {}, globale: 0, linea: {}, catLinea: {}, voce: {} };
  return s;
}

/** Riconosce l'esempio, per poterlo segnalare senza salvarne un flag nel file. */
export function eEsempio(sim) {
  return String(sim?.meta?.descrizione || '').startsWith('ESEMPIO');
}
