// Interfaccia del simulatore. Tutto il calcolo sta in calcolo.mjs: qui si disegna e si
// raccoglie input. Una pagina sola: dati, cruscotto e grafici insieme.
//
// Il re-render completo avviene solo quando cambia la struttura (righe, servizi, scheda);
// digitare un numero aggiorna soltanto i valori derivati, per non perdere il fuoco dal
// campo in cui si sta scrivendo.

import {
  calcola, calcolaStadio, valoreAStadio, riduzionePerValore, riduzionePerMargine,
  sensitivita, STADI, RIDUZIONI, ETICHETTA_STADIO, ETICHETTA_STADIO_BREVE,
  CATEGORIE, ETICHETTA_CATEGORIA,
} from './calcolo.mjs';
import {
  nuovaSimulazione, simulazioneEsempio, eEsempio, normalizza, nuovaVoce, nuovoServizio,
  servizioStandard, nomiServiziStandard, SUGGERIMENTI, nomeFile,
} from './modello.mjs';
import {
  modo, salva, elenca, elimina, scegliCartella, supportaCartella, ripristinaCartella,
  scarica, apriFile, salvaBozza, leggiBozza,
} from './archivio.mjs';

let sim = nuovaSimulazione();
let scheda = 'cruscotto';
let elencoArchivio = [];
let messaggio = null;
let ripristino = null;
let margineVoluto = null;

// --- utilità -----------------------------------------------------------------------

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, attrs = {}, ...figli) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'testo') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of figli.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.appendChild(typeof f === 'string' || typeof f === 'number' ? document.createTextNode(String(f)) : f);
  }
  return n;
}

const nfEuro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const nfNum = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

const euro = (n) => nfEuro.format(Number.isFinite(n) ? n : 0);
const numero = (n) => nfNum.format(Number.isFinite(n) ? n : 0);
const perc = (f) => (f === null || f === undefined || !Number.isFinite(f) ? 'n.d.' : (f * 100).toFixed(1).replace('.', ',') + '%');
const segno = (v, s) => (v > 0 ? '+' : '') + s;
const euroSegnato = (n) => segno(n, euro(n));
const punti = (v) => (v === null || !Number.isFinite(v) ? 'n.d.' : segno(v, v.toFixed(1).replace('.', ',')) + ' p.p.');

/** Percentuale come la si scrive in un campo: al massimo due decimali, senza zeri inutili. */
function testoPct(v) {
  const n = Number(v) || 0;
  if (n === 0) return '';
  return (Math.round(n * 100) / 100).toString().replace('.', ',');
}

/** Accetta 1234,56 oppure 1.234,56 oppure 1234.56 senza indovinare a caso. */
function leggiNumero(s) {
  const t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return 0;
  let n;
  if (t.includes(',')) n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) n = parseFloat(t.replace(/\./g, ''));
  else n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

function imposta(percorso, valore) {
  const parti = percorso.split('.');
  let o = sim;
  for (let i = 0; i < parti.length - 1; i += 1) {
    if (o[parti[i]] === null || typeof o[parti[i]] !== 'object') o[parti[i]] = {};
    o = o[parti[i]];
  }
  o[parti[parti.length - 1]] = valore;
}

function classeMargine(f, target) {
  if (f === null || !Number.isFinite(f)) return 'p-neutro';
  if (target > 0) {
    if (f >= target) return 'p-buono';
    if (f >= target * 0.8) return 'p-attenzione';
    return 'p-critico';
  }
  if (f >= 0.15) return 'p-buono';
  if (f >= 0) return 'p-attenzione';
  return 'p-critico';
}

function avvisa(testo, azione = null) {
  messaggio = testo ? { testo, azione } : null;
  disegnaMessaggio();
  if (testo) {
    const durata = azione ? 20000 : 6000;
    setTimeout(() => {
      if (messaggio && messaggio.testo === testo) { messaggio = null; disegnaMessaggio(); }
    }, durata);
  }
}

function disegnaMessaggio() {
  const c = $('#messaggio');
  if (!c) return;
  c.textContent = '';
  if (!messaggio) { c.hidden = true; c.className = ''; return; }
  c.className = 'avviso';
  c.hidden = false;
  c.appendChild(h('span', { testo: messaggio.testo }));
  if (messaggio.azione) {
    c.appendChild(h('button', { style: 'white-space:nowrap', testo: messaggio.azione.testo, onclick: messaggio.azione.onclick }));
  }
}

/** Esegue un'azione distruttiva conservando lo stato precedente, e offre di annullarla. */
function conAnnulla(descrizione, azione) {
  const prima = JSON.parse(JSON.stringify(sim));
  azione();
  ripristino = prima;
  disegna();
  avvisa(descrizione, {
    testo: 'Annulla',
    onclick: () => {
      if (!ripristino) return;
      sim = normalizza(ripristino);
      ripristino = null;
      disegna();
      avvisa('Ripristinato.');
    },
  });
}

// --- valori derivati e spiegazioni ---------------------------------------------------

const spiegazioni = new Map();

/**
 * Regola unica del colore: verde quando il margine ci guadagna, rosso quando ci perde.
 * Su un costo vuol dire scendere, su ricavo e margine salire. Il colore non è mai l'unico
 * segnale: accanto c'è sempre il segno, e sui valori assoluti una freccia.
 */
function versoScostamento(valore, partenza, piuEMeglio) {
  if (!(Math.abs(partenza) > 1e-9)) return { nullo: true };
  const scarto = valore - partenza;
  if (Math.abs(scarto) < 0.005) return { nullo: true, scarto: 0 };
  const bene = piuEMeglio ? scarto > 0 : scarto < 0;
  return { nullo: false, scarto, bene, classe: bene ? 'v-buono' : 'v-critico' };
}

function scrivi(sel, testo, classe, spiegazione, grezzo, comePct) {
  if (spiegazione !== undefined && spiegazione !== null) spiegazioni.set(sel, spiegazione);
  for (const n of $$(`[data-out="${sel}"]`)) {
    if (n.tagName === 'INPUT') {
      if (document.activeElement !== n && grezzo !== undefined) {
        n.value = comePct ? testoPct(grezzo) : (grezzo ? numero(grezzo) : '');
      }
      n.classList.remove('v-buono', 'v-critico');
      if (classe) n.classList.add(classe);
      const sp = spiegazioni.get(sel);
      if (sp) n.setAttribute('title', sp);
      continue;
    }
    n.textContent = testo;
    n.classList.remove('v-buono', 'v-critico');
    if (classe) n.classList.add(classe);
    const sp = spiegazioni.get(sel);
    if (sp) {
      n.classList.add('spiegabile');
      n.setAttribute('title', sp);
      n.setAttribute('tabindex', '0');
      n.setAttribute('role', 'button');
    }
  }
}

function segnalaDirezione(chiave, verso) {
  for (const n of $$(`[data-out="${chiave}"]`)) {
    const cella = n.closest ? n.closest('td') : null;
    const freccia = cella && cella.querySelector('.direzione');
    if (!freccia) continue;
    if (verso.nullo) {
      freccia.textContent = '';
      freccia.className = 'direzione';
      freccia.removeAttribute('title');
      continue;
    }
    freccia.textContent = verso.scarto > 0 ? '▲' : '▼';
    freccia.className = 'direzione ' + verso.classe;
    freccia.setAttribute('title', `${verso.scarto > 0 ? 'più' : 'meno'} ${euro(Math.abs(verso.scarto))} rispetto allo stadio precedente`);
  }
}

function chiudiSpiegazione() {
  const p = $('#spiegazione');
  if (p) { p.hidden = true; p.textContent = ''; }
  for (const n of $$('.spiegabile.aperta')) n.classList.remove('aperta');
}

function mostraSpiegazione(cella) {
  const chiave = cella.getAttribute('data-out');
  const testo = spiegazioni.get(chiave);
  if (!testo) return;
  const p = $('#spiegazione');
  if (!p) return;
  chiudiSpiegazione();
  cella.classList.add('aperta');
  const et = cella.getAttribute('data-et') || '';
  p.textContent = '';
  p.appendChild(h('div', { class: 'titolo-spiega' },
    h('span', { testo: (et ? et + ' · ' : '') + cella.textContent.trim() }),
    h('button', { class: 'muto', 'aria-label': 'Chiudi', testo: '×', onclick: chiudiSpiegazione })));
  p.appendChild(h('div', { class: 'corpo-spiega', testo }));
  p.hidden = false;
}

function collegaSpiegazioni() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#spiegazione')) return;
    const cella = t.closest('[data-out].spiegabile');
    if (cella) { e.preventDefault(); mostraSpiegazione(cella); return; }
    chiudiSpiegazione();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') chiudiSpiegazione();
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList
        && e.target.classList.contains('spiegabile')) {
      e.preventDefault();
      mostraSpiegazione(e.target);
    }
  });
}

// --- campi -------------------------------------------------------------------------

function campoTesto(etichetta, percorso, valore, extra = {}) {
  return h('label', { class: 'campo' },
    h('span', { testo: etichetta }),
    h('input', {
      type: 'text', value: valore ?? '', id: 'c-' + percorso.replace(/[^\w]/g, '-'),
      ...extra,
      oninput: (e) => { imposta(percorso, e.target.value); aggiornaDerivati(); },
    }));
}

function campoNumero(etichetta, percorso, valore, extra = {}) {
  return h('label', { class: 'campo' },
    h('span', { testo: etichetta }),
    h('input', {
      type: 'text', inputmode: 'decimal', class: 'num',
      value: valore ? String(valore).replace('.', ',') : '',
      id: 'c-' + percorso.replace(/[^\w]/g, '-'),
      ...extra,
      oninput: (e) => { imposta(percorso, leggiNumero(e.target.value)); aggiornaDerivati(); },
    }));
}

// --- tabella del servizio ------------------------------------------------------------

const L_VOCE = 210;
const L_VALORE = 132;
const L_PCT = 66;
const L_AZIONE = 40;

function larghezzaTabella() {
  return L_VOCE + L_VALORE * STADI.length + L_PCT * RIDUZIONI.length + L_AZIONE;
}

function colonneTabella() {
  const totale = larghezzaTabella();
  const q = (px) => ((px / totale) * 100).toFixed(3) + '%';
  const cols = [h('col', { style: `width:${q(L_VOCE)}` }), h('col', { style: `width:${q(L_VALORE)}` })];
  for (let i = 0; i < RIDUZIONI.length; i += 1) {
    cols.push(h('col', { style: `width:${q(L_PCT)}` }));
    cols.push(h('col', { style: `width:${q(L_VALORE)}` }));
  }
  cols.push(h('col', { style: `width:${q(L_AZIONE)}` }));
  return h('colgroup', {}, ...cols);
}

/** Campo del valore di partenza: è l'unico numero che non deriva da nient'altro. */
function cellaBase(elemento, chiaveOut) {
  return h('td', { class: 'n', 'data-et': ETICHETTA_STADIO.preventivo },
    h('div', { class: 'coppia coppia-valore' },
      h('input', {
        type: 'text', inputmode: 'decimal', class: 'num principale',
        value: elemento.base ? numero(elemento.base) : '',
        'aria-label': 'Valore di preventivo',
        oninput: (e) => { elemento.base = leggiNumero(e.target.value); aggiornaDerivati(); },
      }),
      h('span', { class: 'accessorio' }, h('span', { class: 'suff', testo: '€' }))),
    h('span', { hidden: true, 'data-out': chiaveOut }));
}

/**
 * Coppia percentuale + valore per uno stadio derivato. Si può scrivere l'una o l'altro:
 * scrivendo la percentuale si ottiene il valore, scrivendo il valore si ottiene la
 * percentuale che lo produce. Il KOM resta così un numero che si può dettare, pur essendo
 * espresso come riduzione rispetto allo stadio precedente.
 */
function cellePassaggio(elemento, indice, chiave, etichettaVoce) {
  const riduzione = RIDUZIONI[indice];
  const stadio = STADI[indice + 1];

  const cellaPct = h('td', { class: 'n cella-pct', 'data-et': 'Riduzione verso ' + ETICHETTA_STADIO_BREVE[stadio] },
    h('div', { class: 'coppia coppia-pct' },
      h('input', {
        type: 'text', inputmode: 'decimal', class: 'num pct',
        'data-out': `rid:${chiave}:${riduzione}`,
        placeholder: '0',
        'aria-label': `Riduzione percentuale verso ${ETICHETTA_STADIO[stadio]} di ${etichettaVoce}`,
        oninput: (e) => {
          if (!elemento.rid) elemento.rid = {};
          elemento.rid[riduzione] = leggiNumero(e.target.value);
          aggiornaDerivati();
        },
      }),
      h('span', { class: 'suff', testo: '%' })));

  const cellaVal = h('td', { class: 'n', 'data-et': ETICHETTA_STADIO_BREVE[stadio] },
    h('div', { class: 'coppia coppia-valore' },
      h('input', {
        type: 'text', inputmode: 'decimal',
        class: 'num principale' + (stadio === 'simulato' ? ' simulato' : ''),
        'data-out': `val:${chiave}:${stadio}`,
        placeholder: '—',
        'aria-label': `${ETICHETTA_STADIO[stadio]} di ${etichettaVoce}`,
        oninput: (e) => {
          const testo = e.target.value.trim();
          if (!elemento.rid) elemento.rid = {};
          if (testo === '') { elemento.rid[riduzione] = 0; aggiornaDerivati(); return; }
          const p = riduzionePerValore(elemento, stadio, leggiNumero(testo));
          if (p === null) {
            avvisa(`${ETICHETTA_STADIO_BREVE[STADI[indice]]} vale zero: da zero nessuna percentuale porta a un altro numero. Inserisci prima il valore di partenza.`);
            return;
          }
          elemento.rid[riduzione] = p;
          aggiornaDerivati();
        },
      }),
      h('span', { class: 'accessorio' },
        h('span', { class: 'direzione' }),
        h('span', { class: 'suff', testo: '€' }))));

  return [cellaPct, cellaVal];
}

function rigaVoce(servizio, voce) {
  const nome = h('input', {
    type: 'text', value: voce.nome, list: 'sugg-' + voce.cat,
    'aria-label': 'Nome della voce',
    oninput: (e) => { voce.nome = e.target.value; },
  });
  return h('tr', {},
    h('td', { 'data-et': 'Voce' }, nome),
    cellaBase(voce, `val:${voce.id}:preventivo`),
    ...RIDUZIONI.flatMap((_, i) => cellePassaggio(voce, i, voce.id, voce.nome || 'questa voce')),
    h('td', { class: 'azione-riga' }, h('button', {
      class: 'muto', title: 'Rimuovi voce', 'aria-label': 'Rimuovi voce', testo: '×',
      onclick: () => conAnnulla(`Voce "${voce.nome || 'senza nome'}" rimossa.`,
        () => { servizio.voci = servizio.voci.filter((x) => x.id !== voce.id); }),
    })));
}

function tabellaServizio(servizio) {
  const corpo = h('tbody', {});

  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { 'data-et': 'Voce', testo: 'Ricavo del servizio' }),
    cellaBase(servizio.ricavo, `val:ric-${servizio.id}:preventivo`),
    ...RIDUZIONI.flatMap((_, i) => cellePassaggio(servizio.ricavo, i, 'ric-' + servizio.id, 'ricavo')),
    h('td', { class: 'azione-riga' })));

  for (const cat of CATEGORIE) {
    const voci = servizio.voci.filter((v) => v.cat === cat);
    corpo.appendChild(h('tr', { class: 'cat' },
      h('td', { colspan: 2 + RIDUZIONI.length * 2 + 1 }, ETICHETTA_CATEGORIA[cat])));
    for (const voce of voci) corpo.appendChild(rigaVoce(servizio, voce));
    corpo.appendChild(h('tr', {},
      h('td', { 'data-et': 'Voce' }, h('button', {
        class: 'muto', testo: '+ voce',
        onclick: () => { servizio.voci.push(nuovaVoce(cat, '')); disegna(); },
      })),
      ...STADI.flatMap((st, i) => {
        const celle = i === 0 ? [] : [h('td', { class: 'n cella-pct' })];
        celle.push(h('td', {
          class: 'n derivato', 'data-et': 'Totale ' + ETICHETTA_CATEGORIA[cat] + ' ' + ETICHETTA_STADIO_BREVE[st],
          'data-out': `cat:${servizio.id}:${cat}:${st}`, testo: '—',
        }));
        return celle;
      }),
      h('td', { class: 'azione-riga' })));
  }

  const rigaTotale = (etichetta, prefisso) => h('tr', { class: 'somma' },
    h('td', { 'data-et': 'Voce', testo: etichetta }),
    ...STADI.flatMap((st, i) => {
      const celle = i === 0 ? [] : [h('td', { class: 'n cella-pct' })];
      celle.push(h('td', {
        class: 'n', 'data-et': ETICHETTA_STADIO_BREVE[st],
        'data-out': `${prefisso}:${servizio.id}:${st}`, testo: '—',
      }));
      return celle;
    }),
    h('td', { class: 'azione-riga' }));

  corpo.appendChild(rigaTotale('Totale costi diretti', 'cdserv'));
  corpo.appendChild(rigaTotale('Margine di contribuzione', 'mdcserv'));

  const intestazione = h('tr', {}, h('th', { testo: 'Voce' }));
  STADI.forEach((st, i) => {
    if (i > 0) intestazione.appendChild(h('th', { class: 'n th-pct', title: 'Riduzione percentuale rispetto allo stadio precedente: sconti, ottimizzazioni previste, trattative con i fornitori', testo: '− %' }));
    intestazione.appendChild(h('th', { class: 'n' + (st === 'simulato' ? ' th-simulato' : ''), testo: ETICHETTA_STADIO_BREVE[st] }));
  });
  intestazione.appendChild(h('th', { class: 'azione-riga' }));

  return h('div', { class: 'tabellone' },
    h('table', { class: 'tab-dati tab-fissa', style: `max-width:${larghezzaTabella()}px` },
      colonneTabella(),
      h('thead', {}, intestazione),
      corpo));
}

function pannelloServizio(servizio, i) {
  return h('section', { class: 'pannello' },
    h('div', { class: 'servizio-titolo' },
      h('input', {
        type: 'text', value: servizio.nome, 'aria-label': 'Nome del servizio',
        oninput: (e) => { servizio.nome = e.target.value; aggiornaDerivati(); },
      }),
      h('button', {
        class: 'muto', title: 'Rimuovi il servizio', 'aria-label': 'Rimuovi il servizio', testo: '×',
        onclick: () => conAnnulla(`Servizio "${servizio.nome}" rimosso con le sue ${servizio.voci.length} voci.`,
          () => { sim.servizi.splice(i, 1); }),
      })),
    tabellaServizio(servizio));
}

function pannelloAggiungiServizio() {
  const presenti = new Set(sim.servizi.map((s) => s.nome.trim().toLowerCase()));
  const mancanti = nomiServiziStandard().filter((n) => !presenti.has(n.trim().toLowerCase()));
  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Aggiungi un servizio' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'azioni' },
        ...mancanti.map((n) => h('button', {
          testo: '+ ' + n,
          onclick: () => { sim.servizi.push(servizioStandard(n)); disegna(); avvisa(`Servizio "${n}" aggiunto.`); },
        })),
        h('button', {
          testo: '+ servizio personalizzato',
          onclick: () => { sim.servizi.push(nuovoServizio('Nuovo servizio')); disegna(); },
        })),
      h('p', { class: 'nota', testo: 'Un servizio in più aggiunge una tabella: ricavo e costi diretti si sommano a quelli già presenti.' })));
}

// --- cruscotto ----------------------------------------------------------------------

const usaRiserva = () => Number(sim.parametri.riservaPct || 0) !== 0;

function rigaRiepilogo(etichetta, chiave, formato = 'euro', forte = false) {
  return h('tr', forte ? { class: 'somma' } : {},
    h('td', { 'data-et': 'Voce', testo: etichetta }),
    ...STADI.map((st) => h('td', {
      class: 'n' + (st === 'simulato' ? ' col-simulato' : ''),
      'data-et': ETICHETTA_STADIO_BREVE[st],
      'data-out': `tot:${st}:${chiave}:${formato}`, testo: '—',
    })));
}

function pannelloRiepilogo() {
  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Margine nei quattro stadi' }),
    h('div', { class: 'tabellone' },
      h('table', { class: 'tab-confronto' },
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Voce' }),
          ...STADI.map((st) => h('th', {
            class: 'n' + (st === 'simulato' ? ' th-simulato' : ''),
            testo: ETICHETTA_STADIO_BREVE[st],
          })))),
        h('tbody', {},
          rigaRiepilogo('Ricavo', 'ricavo'),
          rigaRiepilogo('Costi diretti', 'cd'),
          rigaRiepilogo('Margine di contribuzione', 'mdc', 'euro', true),
          rigaRiepilogo('Marginalità', 'mdcPct', 'perc', true),
          ...(usaRiserva() ? [
            rigaRiepilogo('Riserva per imprevisti', 'imprevisti'),
            rigaRiepilogo('Margine industriale', 'mi', 'euro', true),
            rigaRiepilogo('Margine industriale %', 'miPct', 'perc', true),
          ] : []),
          rigaRiepilogo('Spazio residuo sui costi', 'spazio')))),
    h('div', { class: 'corpo' },
      h('div', { id: 'cascata' }),
      h('p', { class: 'nota', id: 'lettura-spazio', testo: '' })));
}

function pannelloObiettivo() {
  const valore = margineVoluto === null ? (sim.parametri.targetPct || 0) : margineVoluto;

  const applica = () => {
    const r = riduzionePerMargine(sim, valore);
    if (!r.possibile) { avvisa(r.motivo); return; }
    const p = Math.round(r.riduzionePct * 100) / 100;
    conAnnulla(`Applicata una riduzione del ${testoPct(p)}% su tutte le voci per raggiungere il ${perc(valore / 100)}.`,
      () => {
        for (const s of sim.servizi) for (const v of s.voci) { if (!v.rid) v.rid = {}; v.rid.simulato = p; }
      });
  };

  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Partire dal margine' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'riga-margine' },
        h('label', { class: 'campo' },
          h('span', { testo: 'Margine da raggiungere %' }),
          h('input', {
            type: 'text', inputmode: 'decimal', class: 'num', id: 'c-margine-voluto',
            value: String(valore).replace('.', ','),
            oninput: (e) => { margineVoluto = leggiNumero(e.target.value); aggiornaDerivati(); },
          })),
        h('button', { class: 'primario', testo: 'Applica su tutte le voci', onclick: applica }),
        h('button', {
          testo: 'Azzera le riduzioni simulate',
          onclick: () => conAnnulla('Riduzioni simulate azzerate.',
            () => { for (const s of sim.servizi) for (const v of s.voci) { if (v.rid) v.rid.simulato = 0; } }),
        })),
      h('p', { class: 'esito-margine', id: 'esito-margine', testo: '' }),
      h('p', { class: 'nota', testo: 'La riduzione calcolata finisce nella colonna % verso Simulato di ogni voce: da lì la ritocchi voce per voce, concentrandola dove è davvero ottenibile.' })));
}

function pannelloSensitivita() {
  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Dove conviene intervenire' }),
    h('div', { class: 'corpo' },
      h('div', { id: 'tornado' }),
      h('p', { class: 'nota', testo: 'Quanto guadagnerebbe il margine riducendo del 10% quella sola voce, partendo dal valore simulato attuale. In cima c’è dove un punto ottenuto vale di più.' })));
}

function bannerEsempio() {
  if (!eEsempio(sim)) return null;
  return h('div', { class: 'avviso' },
    h('span', {}, 'Stai guardando una commessa di esempio, con numeri inventati. Sostituisci i valori con quelli della tua commessa, oppure parti da una maschera vuota.'),
    h('button', {
      style: 'margin-left:auto;white-space:nowrap', testo: 'Parti da zero',
      onclick: () => { sim = nuovaSimulazione(); disegna(); },
    }));
}

function guidaColonne() {
  return h('section', { class: 'pannello pannello-guida-colonne' },
    h('div', { class: 'corpo' },
      h('h3', { class: 'sotto-titolo', testo: 'Come si legge la tabella' }),
      h('p', {}, 'Si scrive il valore di ',
        h('b', { testo: 'Preventivo' }),
        ', poi una percentuale per ogni passaggio: quanto si ottiene in trattativa con i fornitori, quanto viene fissato al KOM, quanto si pensa di ottimizzare ancora. Ogni colonna è la precedente meno la sua percentuale.'),
      h('p', {}, 'Ogni casella si scrive in entrambi i modi: metti la percentuale e ottieni il valore, oppure metti il valore e ottieni la percentuale. Una percentuale negativa è un aumento.'),
      h('p', { class: 'nota legenda-colori' },
        h('span', { class: 'v-buono', testo: '▼ verde' }), ' il margine ci guadagna, ',
        h('span', { class: 'v-critico', testo: '▲ rosso' }), ' ci perde. Su un costo guadagna quando scende, su ricavo e margine quando salgono.')));
}

function pannelloCommessa() {
  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Commessa' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'campi' },
        campoTesto('Codice commessa', 'meta.codice', sim.meta.codice, { placeholder: 'es. C-2026-014' }),
        campoTesto('Cliente', 'meta.cliente', sim.meta.cliente),
        campoTesto('Descrizione', 'meta.descrizione', sim.meta.descrizione),
        campoTesto('Data', 'meta.data', sim.meta.data, { type: 'date' }),
        campoTesto('Compilata da', 'meta.autore', sim.meta.autore))));
}

function pannelloParametri() {
  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Parametri' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'campi' },
        campoNumero('Margine obiettivo %', 'parametri.targetPct', sim.parametri.targetPct),
        h('div', { class: 'campo-spiegato' },
          campoNumero('Riserva per imprevisti %', 'parametri.riservaPct', sim.parametri.riservaPct),
          h('div', { class: 'valore-vivo' },
            h('span', { testo: 'sullo stadio simulato: ' }),
            h('b', { 'data-out': 'tot:simulato:imprevisti:euro', testo: '—' })))),
      h('p', { class: 'nota', testo: 'Il margine obiettivo è la soglia sotto la quale la commessa non deve scendere: colora il semaforo e determina lo spazio residuo. La riserva per imprevisti è un accantonamento sui costi per rischi non ancora emersi, non un costo già sostenuto; a zero sparisce dalle tabelle.' })));
}

function schedaCruscotto() {
  return h('div', {},
    bannerEsempio(),
    pannelloCommessa(),
    pannelloParametri(),
    pannelloRiepilogo(),
    pannelloObiettivo(),
    guidaColonne(),
    ...sim.servizi.map((s, i) => pannelloServizio(s, i)),
    pannelloSensitivita(),
    pannelloAggiungiServizio());
}

// --- archivio -----------------------------------------------------------------------

function schedaArchivio() {
  const modoArchivio = modo();
  const azioni = h('div', { class: 'azioni', style: 'margin-bottom:12px' },
    h('button', {
      class: 'primario', testo: 'Salva nell’archivio',
      onclick: async () => {
        try { const r = await salva(sim); await ricaricaArchivio(); avvisa(`Salvata come ${r.nome}.`); }
        catch (e) { avvisa('Salvataggio non riuscito: ' + e.message); }
      },
    }),
    supportaCartella() ? h('button', {
      testo: modoArchivio === 'cartella' ? 'Cambia cartella' : 'Scegli la cartella di rete',
      onclick: async () => {
        try { await scegliCartella(); await ricaricaArchivio(); disegna(); avvisa('Cartella collegata.'); }
        catch (e) { if (e.name !== 'AbortError') avvisa('Cartella non collegata: ' + e.message); }
      },
    }) : null,
    h('button', {
      testo: 'Scarica come file',
      onclick: () => {
        if (incorporata()) offriTesto('Simulazione in formato JSON', nomeFile(sim), JSON.stringify(sim, null, 2));
        else scarica(sim);
      },
    }),
    h('button', {
      testo: 'Apri da file',
      onclick: async () => {
        try { sim = await apriFile(); scheda = 'cruscotto'; disegna(); avvisa('Simulazione caricata.'); }
        catch (e) { avvisa(e.message); }
      },
    }),
    h('button', {
      testo: 'Nuova simulazione',
      onclick: () => {
        if (!confirm('Azzerare la simulazione corrente? Quello che non è stato salvato va perso.')) return;
        sim = nuovaSimulazione(); scheda = 'cruscotto'; disegna(); avvisa('Nuova simulazione, maschera vuota.');
      },
    }));

  const elenco = h('div', { class: 'elenco-archivio' },
    elencoArchivio.length === 0
      ? h('div', { class: 'vuoto', testo: 'Nessuna simulazione in archivio.' })
      : elencoArchivio.map((v) => {
        const r = calcolaStadio(v.sim, 'simulato');
        return h('div', { class: 'voce-archivio' },
          h('div', { class: 'id' },
            h('b', { testo: `${v.codice}${v.cliente ? ' · ' + v.cliente : ''}` }),
            h('small', { testo: `${v.descrizione ? v.descrizione + ' · ' : ''}${v.nome}` })),
          h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
            h('span', { class: 'pillola ' + classeMargine(r.miPct, (v.sim.parametri?.targetPct || 0) / 100), testo: 'Margine ' + perc(r.miPct) }),
            h('button', {
              testo: 'Apri',
              onclick: () => { sim = normalizza(JSON.parse(JSON.stringify(v.sim))); scheda = 'cruscotto'; disegna(); avvisa('Aperta ' + v.nome + '. Salvando si crea una nuova voce, l’originale resta.'); },
            }),
            h('button', {
              class: 'muto', testo: 'Elimina',
              onclick: async () => {
                if (!confirm('Eliminare ' + v.nome + '?')) return;
                await elimina(v.nome); await ricaricaArchivio(); disegna();
              },
            })));
      }));

  const nota = modoArchivio === 'cartella'
    ? h('p', { class: 'nota', testo: 'Archivio su cartella di rete. I file restano anche se il browser viene ripulito, sono visibili da Esplora risorse e rientrano nel backup aziendale.' })
    : h('div', { class: 'avviso' }, h('span', {}, 'Archivio nella memoria di questo browser. È un ripiego: sparisce con la pulizia dei dati di navigazione e non è condiviso. ' + (supportaCartella() ? 'Collega una cartella di rete per un archivio vero.' : 'Il collegamento a una cartella richiede Chrome o Edge su computer; altrimenti usa Scarica come file.')));

  return h('div', {},
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Archivio delle simulazioni' }),
      h('div', { class: 'corpo' }, azioni, nota,
        h('p', { class: 'nota', testo: 'Ogni salvataggio crea una nuova voce datata. Niente si aggiorna nel tempo: una simulazione è una fotografia della data in cui è stata fatta.' }))),
    h('section', { class: 'pannello' }, h('h2', { testo: 'Simulazioni salvate' }), h('div', { class: 'corpo' }, elenco)));
}

async function ricaricaArchivio() {
  try { elencoArchivio = await elenca(); } catch { elencoArchivio = []; }
  if (scheda === 'archivio') disegna();
}

// --- guida --------------------------------------------------------------------------

function elencoGuida(righe) {
  return h('dl', { class: 'guida-elenco' },
    ...righe.flatMap(([et, testo]) => [h('dt', { testo: et }), h('dd', { testo })]));
}

function schedaGuida() {
  const suTouch = matchMedia('(hover: none)').matches;
  return h('div', { class: 'guida' },
    h('section', { class: 'pannello' },
      h('h2', { testo: 'A cosa serve' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Simula come si muove il margine di una commessa lungo quattro stadi, dal preventivo allo scenario che stai provando. Non è un consuntivo e non tiene lo storico: ogni simulazione è una fotografia del momento in cui la fai. Quando serve, la salvi in archivio e non ci torni più sopra.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'I quattro stadi' }),
      h('div', { class: 'corpo' },
        elencoGuida([
          ['Preventivo', 'il costo come stimato in offerta, e il ricavo offerto. È l’unico valore che si scrive da zero.'],
          ['Preventivo dopo trattativa', 'quello che resta dopo la trattativa con i fornitori: sconti ottenuti, condizioni riviste.'],
          ['KOM', 'il budget concordato al kick off meeting. È il numero di cui il PM risponde.'],
          ['Simulato', 'lo scenario che stai provando: ottimizzazioni previste, rischi, margini di manovra.'],
        ]),
        h('p', {}, 'Fra una colonna e l’altra c’è una percentuale: la diminuzione ottenuta in quel passaggio. Ogni colonna è la precedente meno la sua percentuale. Una percentuale negativa è un aumento, ed è ammessa: succede che un budget salga.'),
        h('p', { class: 'nota' }, 'Ogni casella si scrive nei due versi: percentuale o valore, quello che hai. Scrivendo il valore, la percentuale si ricalcola da sola. Così il KOM resta un numero che puoi dettare, pur essendo espresso come riduzione.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Come trovare dove ottimizzare' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Metti il margine che vuoi raggiungere in "Partire dal margine": lo strumento calcola la riduzione uniforme che servirebbe e la può applicare a tutte le voci. Da lì la concentri dove è davvero ottenibile, alzando la percentuale su una voce e azzerandola su un’altra.'),
        h('p', {}, 'Il grafico "Dove conviene intervenire" ordina le voci per quanto rende un taglio del 10%: in cima c’è quella dove lo stesso sforzo vale di più.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Come vedere da dove arriva un numero' }),
      h('div', { class: 'corpo' },
        h('p', {}, suTouch
          ? 'Tocca una cella calcolata, quelle con il bordino tratteggiato sotto, e compare il calcolo che l’ha prodotta.'
          : 'Clicca una cella calcolata, quelle con il bordino tratteggiato sotto, e compare il calcolo che l’ha prodotta. Fermando il puntatore sopra, lo stesso testo appare come suggerimento del browser.'),
        h('p', { class: 'nota' }, 'Sul telefono non esiste il passaggio del dito sopra una cella: il browser non ha un evento di hover sul touch, quindi la spiegazione si apre al tocco.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Verde e rosso' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Una regola sola: verde quando il margine ci guadagna, rosso quando ci perde. Su un costo vuol dire scendere, su ricavo e margine salire. Il colore non è mai l’unico segnale: c’è sempre il segno davanti al numero, e sui valori assoluti anche una freccia.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Dal telefono' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'La tabella si ricompone in blocchi verticali: ogni numero porta con sé la propria etichetta, quindi non serve scorrere di lato.'),
        elencoGuida([
          ['Su iPhone e iPad', 'funziona tutto tranne il collegamento a una cartella di rete: Safari non espone il selettore di cartelle, e su iOS tutti i browser usano lo stesso motore. Dal telefono l’archivio resta nella memoria del browser, oppure usi Apri e Salva file.'],
          ['Archivio condiviso', 'la cartella di rete richiede Chrome o Edge su computer. È l’unico modo per avere un archivio che sopravvive alla pulizia del browser.'],
        ]))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Cosa non fa' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Niente consuntivazione ore, niente avanzamento lavori, niente storico da aggiornare, nessuna approvazione, nessun collegamento al gestionale. È voluto: serve a ragionare in fretta su uno scenario, non a sostituire il controllo di gestione.'))));
}

// --- grafici ------------------------------------------------------------------------

function svg(tag, attrs, ...figli) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  for (const f of figli.flat()) if (f) n.appendChild(f);
  return n;
}

function testoSvg(x, y, t, attrs = {}) {
  const n = svg('text', { x, y, 'font-size': 10, ...attrs });
  n.textContent = t;
  return n;
}

/** Cascata del margine di contribuzione attraverso i quattro stadi. */
function disegnaCascata(r) {
  const c = $('#cascata');
  if (!c) return;
  c.textContent = '';

  const passi = [];
  STADI.forEach((st, i) => {
    if (i > 0) {
      const p = r.passaggi[i - 1];
      const nomePassaggio = { trattativa: 'trattativa', kom: 'passaggio al KOM', simulato: 'simulazione' };
      passi.push({ et: nomePassaggio[p.riduzione], v: p.dMdc, tipo: 'delta' });
    }
    passi.push({ et: ETICHETTA_STADIO_BREVE[st], v: r.stadi[st].mdc, tipo: 'totale' });
  });

  const L = 780; const A = 250; const mB = 44; const mT = 22; const mL = 8; const mR = 8;
  let cur = 0;
  const seg = passi.map((p) => {
    if (p.tipo === 'totale') { const s = { ...p, da: 0, a: p.v }; cur = p.v; return s; }
    const da = cur; cur += p.v; return { ...p, da, a: cur };
  });
  const valori = seg.flatMap((s) => [s.da, s.a, 0]);
  const min = Math.min(...valori); const max = Math.max(...valori);
  const span = (max - min) || 1;
  const y = (v) => mT + (A - mT - mB) * (1 - (v - min) / span);
  const w = (L - mL - mR) / passi.length;

  const nodi = [svg('line', { class: 'asse', x1: mL, x2: L - mR, y1: y(0), y2: y(0), 'stroke-width': 1 })];
  seg.forEach((s, i) => {
    const x = mL + i * w + w * 0.16;
    const bw = w * 0.68;
    const y1 = y(Math.max(s.da, s.a)); const y2 = y(Math.min(s.da, s.a));
    const positivo = s.tipo === 'totale' ? s.a >= 0 : s.v >= 0;
    const fill = s.tipo === 'totale' ? 'var(--accento)' : (positivo ? 'var(--buono)' : 'var(--critico)');
    nodi.push(svg('rect', { x, y: y1, width: bw, height: Math.max(2, y2 - y1), fill, rx: 2 }));
    nodi.push(testoSvg(x + bw / 2, y1 - 5, s.tipo === 'totale' ? euro(s.a) : euroSegnato(s.v),
      { 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600 }));
    nodi.push(testoSvg(x + bw / 2, A - mB + 16, s.et, { 'text-anchor': 'middle', 'font-size': 9.5 }));
    if (i < seg.length - 1) {
      nodi.push(svg('line', { class: 'griglia', x1: x + bw, x2: mL + (i + 1) * w + w * 0.16, y1: y(s.a), y2: y(s.a), 'stroke-dasharray': '2 2', 'stroke-width': 1 }));
    }
  });
  nodi.push(testoSvg(L / 2, A - 6, 'margine di contribuzione, stadio per stadio', { 'text-anchor': 'middle', 'font-size': 9.5 }));

  c.appendChild(h('div', { class: 'tabellone' },
    svg('svg', { viewBox: `0 0 ${L} ${A}`, width: '100%', role: 'img', 'aria-label': 'Cascata del margine di contribuzione nei quattro stadi' }, ...nodi)));
}

/** Classifica delle voci per quanto rende ridurle del dieci per cento. */
function disegnaSensitivita() {
  const c = $('#tornado');
  if (!c) return;
  c.textContent = '';
  const s = sensitivita(sim, 10);
  const righe = s.righe.filter((x) => x.guadagno > 0).slice(0, 10);
  if (!righe.length) {
    c.appendChild(h('p', { class: 'nota', testo: 'Inserisci dei costi per vedere dove conviene intervenire.' }));
    return;
  }
  const massimo = Math.max(...righe.map((x) => x.guadagno));
  const L = 780; const hr = 24; const mT = 10; const mB = 20; const etW = 250;
  const A = mT + righe.length * hr + mB;
  const larghezzaMax = L - etW - 96;

  const nodi = [];
  righe.forEach((r, i) => {
    const yy = mT + i * hr;
    const et = r.etichetta.length > 40 ? r.etichetta.slice(0, 39) + '…' : r.etichetta;
    nodi.push(testoSvg(etW - 10, yy + 14, et, { 'text-anchor': 'end', 'font-size': 10 }));
    const lw = (r.guadagno / massimo) * larghezzaMax;
    nodi.push(svg('rect', { x: etW, y: yy + 5, width: Math.max(2, lw), height: hr - 11, fill: 'var(--buono)', rx: 2, opacity: 0.9 }));
    nodi.push(testoSvg(etW + lw + 8, yy + 14, '+' + euro(r.guadagno), { 'font-size': 10, 'font-weight': 600 }));
  });

  c.appendChild(h('div', { class: 'tabellone' },
    svg('svg', { viewBox: `0 0 ${L} ${A}`, width: '100%', role: 'img', 'aria-label': 'Voci ordinate per quanto rende ridurle del dieci per cento' }, ...nodi)));
}

// --- aggiornamento dei valori derivati -----------------------------------------------

function formatta(v, formato) {
  if (formato === 'perc') return perc(v);
  if (formato === 'punti') return punti(v);
  return euro(v);
}

function aggiornaDerivati() {
  const r = calcola(sim);
  const target = (sim.parametri.targetPct || 0) / 100;
  const riserva = sim.parametri.riservaPct || 0;
  const sSim = r.stadi.simulato;

  // Riepilogo per stadio
  for (const st of STADI) {
    const x = r.stadi[st];
    const et = ETICHETTA_STADIO[st];
    for (const [k, v] of Object.entries(x)) {
      if (typeof v === 'number' || v === null) {
        scrivi(`tot:${st}:${k}:euro`, formatta(v, 'euro'));
        scrivi(`tot:${st}:${k}:perc`, formatta(v, 'perc'));
      }
    }
    scrivi(`tot:${st}:mdc:euro`, euro(x.mdc), null,
      `${et}: ricavo ${euro(x.ricavo)} meno costi diretti ${euro(x.cd)} = ${euro(x.mdc)}.`);
    scrivi(`tot:${st}:mdcPct:perc`, perc(x.mdcPct), null,
      `${euro(x.mdc)} diviso ricavo ${euro(x.ricavo)} = ${perc(x.mdcPct)}.`);
    scrivi(`tot:${st}:imprevisti:euro`, euro(x.imprevisti), null,
      `Costi diretti ${euro(x.cd)} × ${testoPct(riserva) || '0'}% = ${euro(x.imprevisti)}.`);
    scrivi(`tot:${st}:mi:euro`, euro(x.mi), null,
      `${euro(x.ricavo)} meno costi diretti ${euro(x.cd)} meno riserva ${euro(x.imprevisti)} = ${euro(x.mi)}.`);
    scrivi(`tot:${st}:miPct:perc`, perc(x.miPct), null,
      `${euro(x.mi)} diviso ricavo ${euro(x.ricavo)} = ${perc(x.miPct)}.`);
    scrivi(`tot:${st}:spazio:euro`, euro(x.spazio), versoScostamento(x.spazio, 0, true).classe || null,
      `Costo massimo compatibile con il margine obiettivo ${euro(x.cdMax)} meno costi ${euro(x.cd)} = ${euro(x.spazio)}.`);
  }

  // Valori e percentuali di ogni riga, stadio per stadio
  for (const servizio of sim.servizi) {
    const elementi = [['ric-' + servizio.id, servizio.ricavo, true, 'Ricavo del servizio'],
      ...servizio.voci.map((v) => [v.id, v, false, v.nome || 'voce'])];

    for (const [chiave, elemento, piuEMeglio, nome] of elementi) {
      RIDUZIONI.forEach((rid, i) => {
        const stadio = STADI[i + 1];
        const valore = valoreAStadio(elemento, stadio);
        const precedente = valoreAStadio(elemento, STADI[i]);
        const verso = versoScostamento(valore, precedente, piuEMeglio);
        const pct = Number((elemento.rid || {})[rid]) || 0;
        const spiega = `${nome}: ${ETICHETTA_STADIO_BREVE[STADI[i]]} ${euro(precedente)}`
          + (pct ? ` meno ${testoPct(pct)}%` : ' senza riduzione')
          + ` = ${euro(valore)}.`;
        scrivi(`val:${chiave}:${stadio}`, euro(valore), verso.classe || null, spiega, valore);
        scrivi(`rid:${chiave}:${rid}`, testoPct(pct), null, undefined, pct, true);
        segnalaDirezione(`val:${chiave}:${stadio}`, verso);
      });
    }

    for (const st of STADI) {
      const s = r.stadi[st].servizi.find((x) => x.id === servizio.id);
      if (!s) continue;
      scrivi(`cdserv:${servizio.id}:${st}`, euro(s.cd), null,
        CATEGORIE.map((cat) => `${ETICHETTA_CATEGORIA[cat]} ${euro(s.perCategoria[cat] || 0)}`).join(' + ') + ` = ${euro(s.cd)}.`);
      scrivi(`mdcserv:${servizio.id}:${st}`, `${euro(s.mdc)}  ·  ${perc(s.mdcPct)}`, null,
        `${servizio.nome}, ${ETICHETTA_STADIO[st]}: ricavo ${euro(s.ricavo)} meno costi ${euro(s.cd)} = ${euro(s.mdc)}.`);
      for (const cat of CATEGORIE) {
        scrivi(`cat:${servizio.id}:${cat}:${st}`, euro(s.perCategoria[cat]), null,
          `Somma delle voci di ${ETICHETTA_CATEGORIA[cat]} in ${servizio.nome}, stadio ${ETICHETTA_STADIO[st]}: ${euro(s.perCategoria[cat])}.`);
      }
    }
  }

  // Barra dei risultati, confrontata con lo stadio KOM
  const rif = r.stadi.kom;
  const cls = (valore, partenza, piuEMeglio) => versoScostamento(valore, partenza, piuEMeglio).classe || null;
  scrivi('barra:ricavo', euro(sSim.ricavo), cls(sSim.ricavo, rif.ricavo, true));
  scrivi('barra:costi', euro(sSim.cd), cls(sSim.cd, rif.cd, false));
  scrivi('barra:mdc', euro(sSim.mdc), cls(sSim.mdc, rif.mdc, true),
    `Ricavo ${euro(sSim.ricavo)} meno costi diretti ${euro(sSim.cd)} = ${euro(sSim.mdc)}. Rispetto al KOM: ${euroSegnato(sSim.mdc - rif.mdc)}.`);
  scrivi('barra:mdcpct', perc(sSim.mdcPct), cls(sSim.mdcPct, rif.mdcPct, true));
  scrivi('barra:komPct', perc(rif.mdcPct));

  const pil = $('#semaforo');
  if (pil) {
    pil.className = 'pillola ' + classeMargine(sSim.miPct, target);
    const nome = usaRiserva() ? 'Margine industriale' : 'Margine';
    pil.textContent = nome + ' simulato ' + perc(sSim.miPct) + (target > 0 ? ' · obiettivo ' + perc(target) : '');
  }

  const lettura = $('#lettura-spazio');
  if (lettura) {
    if (!(sSim.ricavo > 0)) lettura.textContent = 'Inserisci il ricavo per calcolare lo spazio residuo sui costi.';
    else if (sSim.spazio >= 0) lettura.textContent = `Allo stadio simulato i costi possono crescere di ${euro(sSim.spazio)} (${perc(sSim.spazioPct)}) prima di scendere sotto il margine obiettivo.`;
    else lettura.textContent = `Allo stadio simulato i costi superano di ${euro(-sSim.spazio)} il massimo compatibile con il margine obiettivo: servono ${perc(-sSim.spazioPct)} di riduzione.`;
  }

  const esito = $('#esito-margine');
  if (esito) {
    const voluto = margineVoluto === null ? (sim.parametri.targetPct || 0) : margineVoluto;
    const res = riduzionePerMargine(sim, voluto);
    esito.className = 'esito-margine';
    if (!res.possibile) {
      esito.textContent = res.motivo;
      esito.classList.add('esito-nulla');
    } else {
      esito.textContent = `Per arrivare al ${perc(voluto / 100)} serve una riduzione del ${testoPct(Math.round(res.riduzionePct * 100) / 100) || '0'}% su tutte le voci: `
        + `da ${euro(res.attuale)} a ${euro(res.richiesto)}, ${euroSegnato(res.variazione)}.`;
      esito.classList.add(res.riduzionePct > 0.005 ? 'esito-sforzo' : 'esito-agio');
    }
  }

  if (scheda === 'cruscotto') { disegnaCascata(r); disegnaSensitivita(); }
  salvaBozza(sim);
}

// --- esportazione e consegna ---------------------------------------------------------

function incorporata() {
  try { return window.self !== window.top; } catch { return true; }
}

function offriTesto(titolo, nomeSuggerito, testo) {
  const area = h('textarea', { readonly: true, spellcheck: 'false' });
  area.value = testo;
  const pannello = h('section', { class: 'pannello riquadro-testo' },
    h('h2', { testo: titolo }),
    h('div', { class: 'corpo' },
      h('p', { class: 'nota', style: 'margin-top:0' }, `Il salvataggio diretto non è disponibile in questa finestra. Copia il testo e incollalo in un file chiamato ${nomeSuggerito}.`),
      area,
      h('div', { class: 'azioni', style: 'margin-top:8px' },
        h('button', {
          class: 'primario', testo: 'Copia negli appunti',
          onclick: async () => {
            area.select();
            try { await navigator.clipboard.writeText(testo); avvisa('Copiato negli appunti.'); }
            catch { avvisa('Copia automatica non riuscita: il testo è selezionato, usa Ctrl+C.'); }
          },
        }),
        h('button', { testo: 'Chiudi', onclick: () => pannello.remove() }))));
  const main = document.querySelector('main');
  main.insertBefore(pannello, main.firstChild || null);
  area.focus();
  area.select();
}

function esportaCsv() {
  const r = calcola(sim);
  const righe = [['Commessa', sim.meta.codice], ['Cliente', sim.meta.cliente], ['Data', sim.meta.data], []];
  righe.push(['Servizio', 'Categoria', 'Voce', ...STADI.map((s) => ETICHETTA_STADIO[s]),
    ...RIDUZIONI.map((x) => 'Riduzione ' + x + ' %')]);

  for (const servizio of sim.servizi) {
    righe.push([servizio.nome, 'Ricavo', '',
      ...STADI.map((s) => valoreAStadio(servizio.ricavo, s)),
      ...RIDUZIONI.map((x) => Number((servizio.ricavo.rid || {})[x]) || 0)]);
    for (const cat of CATEGORIE) {
      for (const v of servizio.voci.filter((x) => x.cat === cat)) {
        righe.push([servizio.nome, ETICHETTA_CATEGORIA[cat], v.nome,
          ...STADI.map((s) => valoreAStadio(v, s)),
          ...RIDUZIONI.map((x) => Number((v.rid || {})[x]) || 0)]);
      }
    }
  }
  righe.push([]);
  for (const [et, k] of [['Ricavo', 'ricavo'], ['Costi diretti', 'cd'], ['Margine di contribuzione', 'mdc'],
    ['Riserva per imprevisti', 'imprevisti'], ['Margine industriale', 'mi']]) {
    righe.push(['TOTALE', et, '', ...STADI.map((s) => r.stadi[s][k])]);
  }
  righe.push(['TOTALE', 'Marginalità %', '', ...STADI.map((s) => (r.stadi[s].mdcPct ?? 0) * 100)]);
  righe.push(['TOTALE', 'Margine industriale %', '', ...STADI.map((s) => (r.stadi[s].miPct ?? 0) * 100)]);

  const csv = righe.map((riga) => riga.map((c) => {
    const s = typeof c === 'number' ? String(Math.round(c * 100) / 100).replace('.', ',') : String(c ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');

  const nomeCsv = nomeFile(sim).replace(/\.json$/, '.csv');
  if (incorporata()) { offriTesto('Esportazione CSV', nomeCsv, csv); return; }
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeCsv;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// --- struttura -----------------------------------------------------------------------

const SCHEDE = [
  ['cruscotto', 'Cruscotto'],
  ['archivio', 'Archivio'],
  ['guida', 'Guida'],
];

function disegna() {
  chiudiSpiegazione();
  const radice = $('#radice');
  radice.textContent = '';

  const nav = h('nav', { class: 'schede', role: 'tablist' },
    ...SCHEDE.map(([k, et]) => h('button', {
      role: 'tab', 'aria-selected': scheda === k ? 'true' : 'false', testo: et,
      onclick: () => { scheda = k; disegna(); },
    })));

  let contenuto;
  try {
    contenuto = scheda === 'cruscotto' ? schedaCruscotto()
      : scheda === 'guida' ? schedaGuida()
        : schedaArchivio();
  } catch (e) {
    contenuto = h('div', { class: 'avviso' },
      h('span', {}, 'Questa scheda non si è potuta aprire: ' + (e && e.message ? e.message : 'errore sconosciuto')
        + '. Le altre schede e i dati inseriti non sono stati toccati.'));
  }

  radice.appendChild(nav);
  radice.appendChild(h('main', {}, contenuto));
  disegnaMessaggio();
  aggiornaDerivati();
}

function testa() {
  return h('header', { class: 'testa' },
    h('div', { class: 'marchio' },
      h('strong', { testo: 'Simulatore margine di commessa' }),
      h('span', { testo: 'Righi Solutions' })),
    h('div', { class: 'azioni' },
      h('button', { testo: 'Esporta CSV', onclick: esportaCsv }),
      h('button', { testo: 'Stampa', onclick: () => window.print() }),
      h('button', {
        class: 'primario', testo: 'Salva nell’archivio',
        onclick: async () => {
          try { const r = await salva(sim); await ricaricaArchivio(); avvisa(`Salvata come ${r.nome}.`); }
          catch (e) { avvisa('Salvataggio non riuscito: ' + e.message); }
        },
      })));
}

function barra() {
  const metrica = (et, chiave, classe = '') => h('div', { class: 'metrica ' + classe },
    h('div', { class: 'et', testo: et }),
    h('div', { class: 'val', 'data-out': chiave, testo: '—' }));

  return h('footer', { class: 'barra' },
    h('span', { class: 'pillola p-neutro', id: 'semaforo', testo: '—' }),
    metrica('Ricavo simulato', 'barra:ricavo', 'secondaria'),
    metrica('Costi simulati', 'barra:costi', 'secondaria'),
    metrica('MdC simulato', 'barra:mdc', 'forte'),
    metrica('Marginalità KOM', 'barra:komPct', 'secondaria'),
    metrica('Marginalità sim.', 'barra:mdcpct', 'forte'));
}

function datalist() {
  return h('div', { hidden: true },
    ...CATEGORIE.map((c) => h('datalist', { id: 'sugg-' + c },
      ...SUGGERIMENTI[c].map((s) => h('option', { value: s })))));
}

export function avvia() {
  document.body.appendChild(testa());
  document.body.appendChild(h('div', { id: 'radice' }));
  document.body.appendChild(h('div', { id: 'messaggio', hidden: true }));
  document.body.appendChild(h('div', { id: 'spiegazione', hidden: true, role: 'status' }));
  document.body.appendChild(barra());
  document.body.appendChild(datalist());
  collegaSpiegazioni();

  const bozza = leggiBozza();
  const utile = bozza && (bozza.meta.codice || (bozza.servizi || []).some((s) => (s.voci || []).some((v) => Number(v.base))));
  sim = utile ? bozza : simulazioneEsempio();

  disegna();
  ripristinaCartella().then(() => ricaricaArchivio());
}
