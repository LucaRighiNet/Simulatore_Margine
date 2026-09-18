// Interfaccia del simulatore. Tutto il calcolo sta in calcolo.mjs: qui si disegna e si
// raccoglie input. Il re-render completo avviene solo quando cambia la struttura
// (righe, linee, scheda); digitare un numero aggiorna soltanto i valori derivati, per non
// perdere il fuoco dal campo in cui si sta scrivendo.

import { calcola, calcolaColonna, sensitivita, COLONNE, CATEGORIE, ETICHETTA_CATEGORIA, ETICHETTA_COLONNA } from './calcolo.mjs';
import { nuovaSimulazione, simulazioneEsempio, eEsempio, normalizza, nuovaVoce, nuovaLinea, nuovaTariffa, SUGGERIMENTI, nomeFile } from './modello.mjs';
import {
  modo, salva, elenca, elimina, scegliCartella, supportaCartella, ripristinaCartella,
  scarica, apriFile, salvaBozza, leggiBozza,
} from './archivio.mjs';

let sim = nuovaSimulazione();
let vista = 'dettagliata';
let scheda = 'dati';
let elencoArchivio = [];
let messaggio = null;

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
const nfEuro2 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

const euro = (n) => nfEuro.format(Number.isFinite(n) ? n : 0);
const numero = (n) => nfEuro2.format(Number.isFinite(n) ? n : 0);
const perc = (f) => (f === null || f === undefined || !Number.isFinite(f) ? 'n.d.' : (f * 100).toFixed(1).replace('.', ',') + '%');
const segno = (v, s) => (v > 0 ? '+' : '') + s;
const euroSegnato = (n) => segno(n, euro(n));
const punti = (v) => (v === null || !Number.isFinite(v) ? 'n.d.' : segno(v, v.toFixed(1).replace('.', ',')) + ' p.p.');
const percRel = (v) => (v === null || !Number.isFinite(v) ? 'n.d.' : segno(v, v.toFixed(1).replace('.', ',')) + '%');

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

function avvisa(testo, tono = 'info') {
  messaggio = testo ? { testo, tono } : null;
  disegnaMessaggio();
  if (testo) setTimeout(() => { if (messaggio && messaggio.testo === testo) { messaggio = null; disegnaMessaggio(); } }, 6000);
}

function disegnaMessaggio() {
  const c = $('#messaggio');
  c.textContent = '';
  if (!messaggio) { c.hidden = true; return; }
  c.hidden = false;
  c.className = 'avviso';
  c.appendChild(h('span', { testo: messaggio.testo }));
}

// --- campi ------------------------------------------------------------------------

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
      type: 'text', inputmode: 'decimal', class: 'num', value: valore ? String(valore).replace('.', ',') : '',
      id: 'c-' + percorso.replace(/[^\w]/g, '-'),
      ...extra,
      oninput: (e) => { imposta(percorso, leggiNumero(e.target.value)); aggiornaDerivati(); },
    }));
}

function inputNumero(percorso, valore, extra = {}) {
  return h('input', {
    type: 'text', inputmode: 'decimal', class: 'num',
    value: valore ? String(valore).replace('.', ',') : '',
    ...extra,
    oninput: (e) => { imposta(percorso, leggiNumero(e.target.value)); aggiornaDerivati(); },
  });
}

// --- scheda dati -------------------------------------------------------------------

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
  const corpo = h('div', { class: 'corpo' },
    h('div', { class: 'campi' },
      campoNumero('Spese generali % sui costi diretti', 'parametri.sgPct', sim.parametri.sgPct),
      campoNumero('Contingency % sui costi diretti', 'parametri.ctgPct', sim.parametri.ctgPct),
      campoNumero('Margine industriale obiettivo %', 'parametri.targetPct', sim.parametri.targetPct),
      campoTesto('Tariffe valide dal', 'parametri.validitaTariffe', sim.parametri.validitaTariffe, { type: 'date' })),
    h('div', { class: 'tabellone', style: 'margin-top:12px' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Tipo di manodopera' }),
          h('th', { class: 'n', testo: 'Costo orario €/h' }),
          h('th', {}))),
        h('tbody', {}, ...sim.tariffe.map((t, i) => h('tr', {},
          h('td', {}, h('input', {
            type: 'text', value: t.nome,
            oninput: (e) => { t.nome = e.target.value; },
          })),
          h('td', { class: 'n', style: 'width:130px' }, inputNumero(`tariffe.${i}.eurOra`, t.eurOra, { placeholder: 'da impostare' })),
          h('td', { style: 'width:34px' }, h('button', {
            class: 'muto', title: 'Rimuovi tariffa', testo: '×',
            onclick: () => { sim.tariffe.splice(i, 1); disegna(); },
          })))))),
      h('button', {
        style: 'margin-top:8px', testo: '+ tipo di manodopera',
        onclick: () => { sim.tariffe.push(nuovaTariffa('Nuovo tipo', 0)); disegna(); },
      })),
    h('p', { class: 'nota', testo: 'Le tariffe sono il costo orario aziendale pieno, non il prezzo di vendita. Finché restano a zero il margine calcolato è privo di significato.' }));

  return h('section', { class: 'pannello' }, h('h2', { testo: 'Parametri e tariffe orarie' }), corpo);
}

function cellaValore(voce, colonna, percorsoBase) {
  if (voce.cat === 'manodopera') {
    return h('td', { class: 'n' },
      h('div', { class: 'coppia' },
        inputNumero(`${percorsoBase}.${colonna}.q`, voce[colonna].q, { placeholder: '0' }),
        h('span', { class: 'suff', testo: 'h' })));
  }
  if (voce.cat === 'materiale') {
    return h('td', { class: 'n' },
      h('div', { class: 'coppia' },
        inputNumero(`${percorsoBase}.${colonna}.q`, voce[colonna].q, { placeholder: 'listino', title: 'Importo di listino' }),
        inputNumero(`${percorsoBase}.${colonna}.sconto`, voce[colonna].sconto, { placeholder: '0', style: 'width:52px', title: 'Sconto %' }),
        h('span', { class: 'suff', testo: '%' })));
  }
  return h('td', { class: 'n' }, inputNumero(`${percorsoBase}.${colonna}.q`, voce[colonna].q, { placeholder: '0' }));
}

function rigaVoce(linea, iL, voce, iV) {
  const base = `linee.${iL}.voci.${iV}`;
  const nome = h('input', {
    type: 'text', value: voce.nome, list: 'sugg-' + voce.cat,
    oninput: (e) => { voce.nome = e.target.value; },
  });
  const celleNome = [nome];
  if (voce.cat === 'manodopera') {
    celleNome.push(h('select', {
      title: 'Tipo di manodopera a cui è agganciata la tariffa oraria',
      style: 'margin-top:3px',
      onchange: (e) => { voce.tariffaId = e.target.value || null; aggiornaDerivati(); },
    },
    h('option', { value: '', testo: '— nessuna tariffa —' }),
    ...sim.tariffe.map((t) => h('option', {
      value: t.id, selected: t.id === voce.tariffaId,
      testo: `${t.nome} · ${t.eurOra ? numero(t.eurOra) + ' €/h' : 'da impostare'}`,
    }))));
  }
  return h('tr', {},
    h('td', {}, ...celleNome),
    cellaValore(voce, 'preventivo', base),
    cellaValore(voce, 'kom', base),
    h('td', { class: 'n derivato', 'data-out': 'voce:' + voce.id, testo: '—' }),
    h('td', { style: 'width:34px' }, h('button', {
      class: 'muto', title: 'Rimuovi voce', testo: '×',
      onclick: () => { linea.voci.splice(iV, 1); disegna(); },
    })));
}

function tabellaLineaDettagliata(linea, iL) {
  const corpo = h('tbody', {});
  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { testo: 'Ricavo di linea' }),
    h('td', { class: 'n' }, inputNumero(`linee.${iL}.ricavo.preventivo`, linea.ricavo.preventivo, { placeholder: '0' })),
    h('td', { class: 'n' }, inputNumero(`linee.${iL}.ricavo.kom`, linea.ricavo.kom, { placeholder: '0' })),
    h('td', { class: 'n derivato', 'data-out': 'ricavo:' + linea.id, testo: '—' }),
    h('td', {})));

  for (const cat of CATEGORIE) {
    const voci = linea.voci.filter((v) => v.cat === cat);
    corpo.appendChild(h('tr', { class: 'cat' }, h('td', { colspan: 5 }, ETICHETTA_CATEGORIA[cat])));
    for (const voce of voci) corpo.appendChild(rigaVoce(linea, iL, voce, linea.voci.indexOf(voce)));
    corpo.appendChild(h('tr', {},
      h('td', {}, h('button', {
        class: 'muto', testo: '+ voce',
        onclick: () => { linea.voci.push(nuovaVoce(cat, '', sim.tariffe)); disegna(); },
      })),
      h('td', { colspan: 2 }),
      h('td', { class: 'n derivato', 'data-out': `cat:${linea.id}:${cat}`, testo: '—' }),
      h('td', {})));
  }

  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { testo: 'Totale costi diretti' }),
    h('td', { class: 'n', 'data-out': `cdcol:${linea.id}:preventivo`, testo: '—' }),
    h('td', { class: 'n', 'data-out': `cdcol:${linea.id}:kom`, testo: '—' }),
    h('td', { class: 'n', 'data-out': `cdcol:${linea.id}:simulato`, testo: '—' }),
    h('td', {})));
  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { testo: 'Margine di contribuzione' }),
    ...COLONNE.map((c) => h('td', { class: 'n', 'data-out': `mdclinea:${linea.id}:${c}`, testo: '—' })),
    h('td', {})));

  return h('div', { class: 'tabellone' }, h('table', {},
    h('thead', {}, h('tr', {},
      h('th', { testo: 'Voce' }),
      h('th', { class: 'n', testo: 'Preventivo' }),
      h('th', { class: 'n', testo: 'KOM' }),
      h('th', { class: 'n', testo: 'Simulato' }),
      h('th', {}))),
    corpo));
}

function tabellaLineaSemplice(linea, iL) {
  const corpo = h('tbody', {});
  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { testo: 'Ricavo di linea' }),
    h('td', { class: 'n' }, inputNumero(`linee.${iL}.ricavo.preventivo`, linea.ricavo.preventivo, { placeholder: '0' })),
    h('td', { class: 'n' }, inputNumero(`linee.${iL}.ricavo.kom`, linea.ricavo.kom, { placeholder: '0' })),
    h('td', { class: 'n derivato', 'data-out': 'ricavo:' + linea.id, testo: '—' })));

  for (const cat of CATEGORIE) {
    const voci = linea.voci.filter((v) => v.cat === cat);
    const unica = voci.length === 1 && voci[0].cat !== 'manodopera' ? voci[0] : null;
    const iV = unica ? linea.voci.indexOf(unica) : -1;
    corpo.appendChild(h('tr', {},
      h('td', {},
        h('strong', { testo: ETICHETTA_CATEGORIA[cat] }),
        voci.length > 1 || (voci.length === 1 && !unica)
          ? h('div', { class: 'nota', style: 'margin:0', testo: `somma di ${voci.length} ${voci.length === 1 ? 'voce' : 'voci'}, modificabile nella vista dettagliata` })
          : null),
      unica
        ? h('td', { class: 'n' }, inputNumero(`linee.${iL}.voci.${iV}.preventivo.q`, unica.preventivo.q, { placeholder: '0' }))
        : h('td', { class: 'n derivato', 'data-out': `catcol:${linea.id}:${cat}:preventivo`, testo: '—' }),
      unica
        ? h('td', { class: 'n' }, inputNumero(`linee.${iL}.voci.${iV}.kom.q`, unica.kom.q, { placeholder: '0' }))
        : h('td', { class: 'n derivato', 'data-out': `catcol:${linea.id}:${cat}:kom`, testo: '—' }),
      h('td', { class: 'n derivato', 'data-out': `cat:${linea.id}:${cat}`, testo: '—' })));
    if (voci.length === 0) {
      corpo.lastChild.firstChild.appendChild(h('div', {},
        h('button', {
          class: 'muto', testo: '+ voce',
          onclick: () => { linea.voci.push(nuovaVoce(cat, ETICHETTA_CATEGORIA[cat], sim.tariffe)); disegna(); },
        })));
    }
  }

  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { testo: 'Margine di contribuzione' }),
    ...COLONNE.map((c) => h('td', { class: 'n', 'data-out': `mdclinea:${linea.id}:${c}`, testo: '—' }))));

  return h('div', { class: 'tabellone' }, h('table', {},
    h('thead', {}, h('tr', {},
      h('th', { testo: 'Categoria' }),
      h('th', { class: 'n', testo: 'Preventivo' }),
      h('th', { class: 'n', testo: 'KOM' }),
      h('th', { class: 'n', testo: 'Simulato' }))),
    corpo));
}

function pannelloLinea(linea, iL) {
  return h('section', { class: 'pannello' },
    h('div', { class: 'linea-titolo' },
      h('input', {
        type: 'text', value: linea.nome, 'aria-label': 'Nome della linea di servizio',
        oninput: (e) => { linea.nome = e.target.value; aggiornaDerivati(); },
      }),
      h('button', {
        class: 'muto', title: 'Rimuovi la linea di servizio', testo: '×',
        onclick: () => { sim.linee.splice(iL, 1); disegna(); },
      })),
    vista === 'dettagliata' ? tabellaLineaDettagliata(linea, iL) : tabellaLineaSemplice(linea, iL));
}

function bannerEsempio() {
  if (!eEsempio(sim)) return null;
  return h('div', { class: 'avviso' },
    h('span', {}, 'Stai guardando una commessa di esempio, con numeri inventati. Serve a mostrare come funziona: sostituisci i valori con quelli della tua commessa, oppure parti da una maschera vuota.'),
    h('button', {
      style: 'margin-left:auto;white-space:nowrap', testo: 'Parti da zero',
      onclick: () => { sim = nuovaSimulazione(); disegna(); },
    }));
}

function schedaDati() {
  return h('div', {},
    bannerEsempio(),
    pannelloCommessa(),
    pannelloParametri(),
    h('div', { class: 'pannello', style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 14px' },
      h('strong', { style: 'font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3)', testo: 'Vista' }),
      h('button', {
        class: vista === 'semplice' ? 'primario' : '', testo: 'Semplice',
        onclick: () => { vista = 'semplice'; disegna(); },
      }),
      h('button', {
        class: vista === 'dettagliata' ? 'primario' : '', testo: 'Dettagliata',
        onclick: () => { vista = 'dettagliata'; disegna(); },
      }),
      h('span', { class: 'nota', style: 'margin:0', testo: vista === 'semplice' ? 'Nove caselle: tre linee per tre categorie.' : 'Righe per marca fornitore e tipo di manodopera.' })),
    ...sim.linee.map((l, i) => pannelloLinea(l, i)),
    h('button', {
      testo: '+ linea di servizio',
      onclick: () => { sim.linee.push(nuovaLinea('Nuova linea')); disegna(); },
    }));
}

// --- scheda simulazione ------------------------------------------------------------

function cursore(etichetta, percorso, valore, uscita) {
  const nInput = h('input', {
    type: 'text', inputmode: 'decimal', class: 'num', value: String(valore ?? 0).replace('.', ','),
    oninput: (e) => {
      const v = leggiNumero(e.target.value);
      imposta(percorso, v);
      range.value = Math.max(-60, Math.min(60, v));
      aggiornaDerivati();
    },
  });
  const range = h('input', {
    type: 'range', min: -60, max: 60, step: 1, value: Math.max(-60, Math.min(60, valore ?? 0)),
    'aria-label': etichetta,
    oninput: (e) => {
      const v = Number(e.target.value);
      imposta(percorso, v);
      nInput.value = String(v).replace('.', ',');
      aggiornaDerivati();
    },
  });
  return h('div', { class: 'cursore' },
    h('div', { class: 'et', testo: etichetta, title: etichetta }),
    range,
    h('div', { class: 'coppia' }, nInput, h('span', { class: 'suff', testo: '%' })),
    uscita ? h('div', { class: 'esito', 'data-out': uscita, testo: '—' }) : null);
}

function schedaSimulazione() {
  const globali = h('div', { class: 'cursori' },
    cursore('Tutti i costi', 'delta.globale', sim.delta.globale),
    cursore('Tutti i ricavi', 'delta.ricavo', sim.delta.ricavo));

  const perLinea = sim.linee.map((l) => h('section', { class: 'pannello' },
    h('h2', { testo: l.nome || 'Linea' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'cursori' },
        cursore('Ricavo della linea', `delta.ricavoLinea.${l.id}`, sim.delta.ricavoLinea?.[l.id] ?? 0),
        cursore('Tutti i costi della linea', `delta.linea.${l.id}`, sim.delta.linea?.[l.id] ?? 0),
        ...CATEGORIE.filter((c) => l.voci.some((v) => v.cat === c)).map((c) =>
          cursore(ETICHETTA_CATEGORIA[c], `delta.catLinea.${l.id}|${c}`, sim.delta.catLinea?.[`${l.id}|${c}`] ?? 0, `catsim:${l.id}:${c}`))))));

  return h('div', {},
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Scostamenti complessivi' }),
      h('div', { class: 'corpo' }, globali,
        h('p', { class: 'nota' }, 'Gli scostamenti si applicano alla colonna KOM e si compongono moltiplicativamente: complessivo, poi linea, poi categoria. Il KOM non viene modificato.'),
        h('button', {
          style: 'margin-top:8px', testo: 'Azzera tutti gli scostamenti',
          onclick: () => { sim.delta = { ricavo: 0, ricavoLinea: {}, globale: 0, linea: {}, catLinea: {}, voce: {} }; disegna(); },
        }))),
    ...perLinea,
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Sensitività: quali voci pesano di più' }),
      h('div', { class: 'corpo' },
        h('div', { id: 'tornado' }),
        h('p', { class: 'nota', testo: 'Effetto sul margine industriale simulato di una variazione di più o meno 10% su ciascun blocco, tenendo fermo tutto il resto. Ordinato per ampiezza.' }))));
}

// --- scheda confronto --------------------------------------------------------------

function rigaConfronto(etichetta, chiave, formato = 'euro', forte = false) {
  return h('tr', forte ? { class: 'somma' } : {},
    h('td', { testo: etichetta }),
    ...COLONNE.map((c) => h('td', { class: 'n', 'data-out': `tot:${c}:${chiave}:${formato}`, testo: '—' })));
}

function tabellaGap(titolo, chiave, sottotitolo) {
  return h('section', { class: 'pannello' },
    h('h2', { testo: titolo }),
    h('div', { class: 'corpo' },
      h('p', { class: 'nota', style: 'margin-top:0', testo: sottotitolo }),
      h('div', { class: 'tabellone' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Grandezza' }),
          h('th', { class: 'n', testo: 'Margine di contribuzione' }),
          h('th', { class: 'n', testo: 'Margine industriale' }))),
        h('tbody', {},
          h('tr', {},
            h('td', { testo: 'Variazione assoluta' }),
            h('td', { class: 'n', 'data-out': `gap:${chiave}:dMdc:euro` , testo: '—' }),
            h('td', { class: 'n', 'data-out': `gap:${chiave}:dMi:euro`, testo: '—' })),
          h('tr', {},
            h('td', { testo: 'Variazione della marginalità' }),
            h('td', { class: 'n', 'data-out': `gap:${chiave}:dMdcPp:punti`, testo: '—' }),
            h('td', { class: 'n', 'data-out': `gap:${chiave}:dMiPp:punti`, testo: '—' })),
          h('tr', {},
            h('td', { testo: 'Variazione relativa del margine' }),
            h('td', { class: 'n', 'data-out': `gap:${chiave}:dMdcRel:rel`, testo: '—' }),
            h('td', { class: 'n', 'data-out': `gap:${chiave}:dMiRel:rel`, testo: '—' })),
          h('tr', { class: 'somma' },
            h('td', { testo: 'di cui effetto ricavo' }),
            h('td', { class: 'n', 'data-out': `gap:${chiave}:effettoRicavo:euro`, testo: '—' }),
            h('td', {})),
          h('tr', { class: 'somma' },
            h('td', { testo: 'di cui effetto costo' }),
            h('td', { class: 'n', 'data-out': `gap:${chiave}:effettoCosto:euro`, testo: '—' }),
            h('td', {}))))),
      h('div', { class: 'tabellone', style: 'margin-top:10px' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Per linea di servizio' }),
          h('th', { class: 'n', testo: 'Effetto ricavo' }),
          ...CATEGORIE.map((c) => h('th', { class: 'n', testo: ETICHETTA_CATEGORIA[c] })),
          h('th', { class: 'n', testo: 'Totale' }))),
        h('tbody', { 'data-lista': 'perlinea:' + chiave })))));
}

function schedaConfronto() {
  return h('div', {},
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Le tre colonne a confronto' }),
      h('div', { class: 'tabellone' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Voce' }),
          ...COLONNE.map((c) => h('th', { class: 'n', testo: ETICHETTA_COLONNA[c] })))),
        h('tbody', {},
          rigaConfronto('Ricavo', 'ricavo'),
          rigaConfronto('Costi diretti', 'cd'),
          rigaConfronto('Margine di contribuzione', 'mdc', 'euro', true),
          rigaConfronto('Marginalità', 'mdcPct', 'perc', true),
          rigaConfronto('Spese generali', 'speseGenerali'),
          rigaConfronto('Contingency', 'contingency'),
          rigaConfronto('Margine industriale', 'mi', 'euro', true),
          rigaConfronto('Margine industriale %', 'miPct', 'perc', true))))),
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Dal preventivo al simulato' }),
      h('div', { class: 'corpo' },
        h('div', { id: 'cascata' }),
        h('p', { class: 'nota', testo: 'Margine di contribuzione. Le barre intermedie scompongono ogni scostamento in effetto ricavo ed effetto costo.' }))),
    tabellaGap('Gap 1 · Preventivo verso KOM', 'gapPreventivoKom',
      'Erosione già avvenuta prima dell’inizio dei lavori: trattativa, sconto di chiusura, ridefinizione del perimetro.'),
    tabellaGap('Gap 2 · KOM verso Simulato', 'gapKomSimulato',
      'Erosione prospettica in esecuzione, rispetto al budget di cui il PM risponde.'),
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Riserva disponibile sul simulato' }),
      h('div', { class: 'corpo' },
        h('div', { class: 'campi' },
          h('div', { class: 'metrica forte' }, h('div', { class: 'et', testo: 'Costo massimo ammissibile' }), h('div', { class: 'val', 'data-out': 'tot:simulato:cdMax:euro', testo: '—' })),
          h('div', { class: 'metrica forte' }, h('div', { class: 'et', testo: 'Riserva residua' }), h('div', { class: 'val', 'data-out': 'tot:simulato:riserva:euro', testo: '—' })),
          h('div', { class: 'metrica forte' }, h('div', { class: 'et', testo: 'Riserva in % sui costi' }), h('div', { class: 'val', 'data-out': 'tot:simulato:riservaPct:perc', testo: '—' }))),
        h('p', { class: 'nota', id: 'lettura-riserva', testo: '' }))));
}

// --- scheda archivio ---------------------------------------------------------------

function schedaArchivio() {
  const modoArchivio = modo();
  const azioni = h('div', { class: 'azioni', style: 'margin-bottom:12px' },
    h('button', {
      class: 'primario', testo: 'Salva nell’archivio',
      onclick: async () => {
        try {
          const r = await salva(sim);
          await ricaricaArchivio();
          avvisa(`Salvata come ${r.nome}.`);
        } catch (e) { avvisa('Salvataggio non riuscito: ' + e.message); }
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
        try { sim = await apriFile(); disegna(); avvisa('Simulazione caricata.'); }
        catch (e) { avvisa(e.message); }
      },
    }),
    h('button', {
      testo: 'Nuova simulazione',
      onclick: () => {
        if (!confirm('Azzerare la simulazione corrente? Quello che non è stato salvato va perso.')) return;
        sim = nuovaSimulazione(); scheda = 'dati'; disegna(); avvisa('Nuova simulazione, maschera vuota.');
      },
    }));

  const elenco = h('div', { class: 'elenco-archivio' },
    elencoArchivio.length === 0
      ? h('div', { class: 'vuoto', testo: 'Nessuna simulazione in archivio.' })
      : elencoArchivio.map((v) => {
        const r = calcolaColonna(v.sim, 'simulato');
        return h('div', { class: 'voce-archivio' },
          h('div', { class: 'id' },
            h('b', { testo: `${v.codice}${v.cliente ? ' · ' + v.cliente : ''}` }),
            h('small', { testo: `${v.descrizione ? v.descrizione + ' · ' : ''}${v.nome}` })),
          h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
            h('span', { class: 'pillola ' + classeMargine(r.miPct, (v.sim.parametri?.targetPct || 0) / 100), testo: 'MI ' + perc(r.miPct) }),
            h('button', {
              testo: 'Apri',
              onclick: () => { sim = normalizza(JSON.parse(JSON.stringify(v.sim))); scheda = 'dati'; disegna(); avvisa('Aperta ' + v.nome + '. Salvando si crea una nuova voce, l’originale resta.'); },
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
    : h('div', { class: 'avviso' }, h('span', {}, 'Archivio nella memoria di questo browser. È un ripiego: sparisce con la pulizia dei dati di navigazione e non è condiviso con gli altri PM. ' + (supportaCartella() ? 'Collega una cartella di rete per un archivio vero.' : 'Il collegamento a una cartella richiede Chrome o Edge su desktop; altrimenti usa Scarica come file.')));

  return h('div', {},
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Archivio delle simulazioni' }),
      h('div', { class: 'corpo' },
        azioni, nota,
        h('p', { class: 'nota', testo: 'Ogni salvataggio crea una nuova voce datata. Niente si aggiorna nel tempo: una simulazione è una fotografia della data in cui è stata fatta.' }))),
    h('section', { class: 'pannello' }, h('h2', { testo: 'Simulazioni salvate' }), h('div', { class: 'corpo' }, elenco)));
}

async function ricaricaArchivio() {
  try { elencoArchivio = await elenca(); }
  catch { elencoArchivio = []; }
  if (scheda === 'archivio') disegna();
}

// --- grafici -----------------------------------------------------------------------

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

function disegnaCascata(r) {
  const c = $('#cascata');
  if (!c) return;
  c.textContent = '';
  const g1 = r.gapPreventivoKom;
  const g2 = r.gapKomSimulato;
  const passi = [
    { et: 'MdC preventivo', v: r.colonne.preventivo.mdc, tipo: 'totale' },
    { et: 'Effetto ricavo', v: g1.effettoRicavo, tipo: 'delta' },
    { et: 'Effetto costo', v: g1.effettoCosto, tipo: 'delta' },
    { et: 'MdC KOM', v: r.colonne.kom.mdc, tipo: 'totale' },
    { et: 'Effetto ricavo', v: g2.effettoRicavo, tipo: 'delta' },
    { et: 'Effetto costo', v: g2.effettoCosto, tipo: 'delta' },
    { et: 'MdC simulato', v: r.colonne.simulato.mdc, tipo: 'totale' },
  ];
  const L = 760, A = 230, mB = 46, mT = 18, mL = 8, mR = 8;
  let cur = 0;
  const seg = passi.map((p) => {
    if (p.tipo === 'totale') { const s = { ...p, da: 0, a: p.v }; cur = p.v; return s; }
    const da = cur; cur += p.v; return { ...p, da, a: cur };
  });
  const valori = seg.flatMap((s) => [s.da, s.a, 0]);
  const min = Math.min(...valori), max = Math.max(...valori);
  const span = (max - min) || 1;
  const y = (v) => mT + (A - mT - mB) * (1 - (v - min) / span);
  const w = (L - mL - mR) / passi.length;

  const nodi = [svg('line', { class: 'asse', x1: mL, x2: L - mR, y1: y(0), y2: y(0), 'stroke-width': 1 })];
  seg.forEach((s, i) => {
    const x = mL + i * w + w * 0.18;
    const bw = w * 0.64;
    const y1 = y(Math.max(s.da, s.a)), y2 = y(Math.min(s.da, s.a));
    const positivo = s.tipo === 'totale' ? s.a >= 0 : s.v >= 0;
    const fill = s.tipo === 'totale' ? 'var(--accento)' : (positivo ? 'var(--buono)' : 'var(--critico)');
    nodi.push(svg('rect', { x, y: y1, width: bw, height: Math.max(2, y2 - y1), fill, rx: 2 }));
    nodi.push(testoSvg(x + bw / 2, y1 - 5, s.tipo === 'totale' ? euro(s.a) : euroSegnato(s.v),
      { 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600 }));
    const et = testoSvg(x + bw / 2, A - mB + 16, s.et, { 'text-anchor': 'middle', 'font-size': 9.5 });
    nodi.push(et);
    if (i < seg.length - 1) nodi.push(svg('line', { class: 'griglia', x1: x + bw, x2: mL + (i + 1) * w + w * 0.18, y1: y(s.a), y2: y(s.a), 'stroke-dasharray': '2 2', 'stroke-width': 1 }));
  });
  const s = svg('svg', { viewBox: `0 0 ${L} ${A}`, width: '100%', role: 'img', 'aria-label': 'Cascata del margine di contribuzione' }, ...nodi);
  c.appendChild(h('div', { class: 'tabellone' }, s));
}

function disegnaTornado() {
  const c = $('#tornado');
  if (!c) return;
  c.textContent = '';
  const s = sensitivita(sim, 10);
  const righe = s.righe.slice(0, 10).filter((r) => r.ampiezza > 0);
  if (righe.length === 0) {
    c.appendChild(h('p', { class: 'nota', testo: 'Inserisci dei costi nella colonna KOM per vedere quali voci pesano di più.' }));
    return;
  }
  const maxA = Math.max(...righe.map((r) => Math.max(Math.abs(r.su), Math.abs(r.giu))));
  const L = 760, hr = 22, mT = 20, mB = 22, etW = 230;
  const A = mT + righe.length * hr + mB;
  const cx = etW + (L - etW - 10) / 2;
  const semi = (L - etW - 20) / 2;
  const nodi = [svg('line', { class: 'asse', x1: cx, x2: cx, y1: mT - 6, y2: A - mB + 2, 'stroke-width': 1 })];
  righe.forEach((r, i) => {
    const yy = mT + i * hr;
    nodi.push(testoSvg(etW - 8, yy + 11, r.etichetta.length > 38 ? r.etichetta.slice(0, 37) + '…' : r.etichetta, { 'text-anchor': 'end', 'font-size': 10 }));
    for (const [v, colore] of [[r.giu, 'var(--buono)'], [r.su, 'var(--critico)']]) {
      const lw = (Math.abs(v) / maxA) * semi;
      nodi.push(svg('rect', { x: v >= 0 ? cx : cx - lw, y: yy + 3, width: Math.max(1, lw), height: hr - 9, fill: colore, rx: 2, opacity: .85 }));
    }
    nodi.push(testoSvg(cx + semi + 6, yy + 11, euroSegnato(r.su), { 'font-size': 9.5, 'text-anchor': 'end', x: L - 4 }));
  });
  nodi.push(testoSvg(cx, A - 6, 'margine industriale, effetto di ±10%', { 'text-anchor': 'middle', 'font-size': 9.5 }));
  c.appendChild(h('div', { class: 'tabellone' },
    svg('svg', { viewBox: `0 0 ${L} ${A}`, width: '100%', role: 'img', 'aria-label': 'Sensitività del margine ai driver di costo' }, ...nodi)));
}

// --- aggiornamento dei valori derivati ---------------------------------------------

function scrivi(sel, testo, classe) {
  for (const n of $$(`[data-out="${sel}"]`)) {
    n.textContent = testo;
    n.classList.remove('v-buono', 'v-critico');
    if (classe) n.classList.add(classe);
  }
}

function formatta(v, formato) {
  if (formato === 'perc') return perc(v);
  if (formato === 'punti') return punti(v);
  if (formato === 'rel') return percRel(v);
  return euro(v);
}

function aggiornaDerivati() {
  const r = calcola(sim);
  const target = (sim.parametri.targetPct || 0) / 100;

  for (const c of COLONNE) {
    const col = r.colonne[c];
    for (const [k, v] of Object.entries(col)) {
      if (typeof v === 'number' || v === null) {
        scrivi(`tot:${c}:${k}:euro`, formatta(v, 'euro'));
        scrivi(`tot:${c}:${k}:perc`, formatta(v, 'perc'));
      }
    }
    for (const l of col.linee) {
      scrivi(`cdcol:${l.id}:${c}`, euro(l.cd));
      scrivi(`mdclinea:${l.id}:${c}`, `${euro(l.mdc)}  ·  ${perc(l.mdcPct)}`);
      for (const cat of CATEGORIE) scrivi(`catcol:${l.id}:${cat}:${c}`, euro(l.perCategoria[cat]));
    }
  }

  const s = r.colonne.simulato;
  for (const l of s.linee) {
    scrivi('ricavo:' + l.id, euro(l.ricavo));
    for (const cat of CATEGORIE) scrivi(`cat:${l.id}:${cat}`, euro(l.perCategoria[cat]));
    for (const [idVoce, costo] of Object.entries(l.voci)) scrivi('voce:' + idVoce, euro(costo));
  }
  const kom = r.colonne.kom;
  for (const l of kom.linee) {
    for (const cat of CATEGORIE) {
      const base = l.perCategoria[cat];
      const simCat = s.linee.find((x) => x.id === l.id)?.perCategoria[cat] ?? 0;
      scrivi(`catsim:${l.id}:${cat}`, base ? euroSegnato(simCat - base) : '—');
    }
  }

  for (const [chiave, g] of [['gapPreventivoKom', r.gapPreventivoKom], ['gapKomSimulato', r.gapKomSimulato]]) {
    for (const [k, formato] of [['dMdc', 'euro'], ['dMi', 'euro'], ['dMdcPp', 'punti'], ['dMiPp', 'punti'], ['dMdcRel', 'rel'], ['dMiRel', 'rel'], ['effettoRicavo', 'euro'], ['effettoCosto', 'euro']]) {
      const v = g[k];
      scrivi(`gap:${chiave}:${k}:${formato}`, formatta(v, formato), v === null ? null : (v >= 0 ? 'v-buono' : 'v-critico'));
    }
    const tb = $(`[data-lista="perlinea:${chiave}"]`);
    if (tb) {
      tb.textContent = '';
      for (const l of g.perLinea) {
        tb.appendChild(h('tr', {},
          h('td', { testo: l.nome }),
          h('td', { class: 'n ' + (l.effettoRicavo >= 0 ? 'v-buono' : 'v-critico'), testo: euroSegnato(l.effettoRicavo) }),
          ...CATEGORIE.map((c) => h('td', { class: 'n ' + (l.perCategoria[c] >= 0 ? 'v-buono' : 'v-critico'), testo: euroSegnato(l.perCategoria[c]) })),
          h('td', { class: 'n', style: 'font-weight:600', testo: euroSegnato(l.dMdc) })));
      }
    }
  }

  // barra risultati
  scrivi('barra:ricavo', euro(s.ricavo));
  scrivi('barra:costi', euro(s.cd));
  scrivi('barra:mdc', euro(s.mdc));
  for (const c of COLONNE) scrivi(`barra:mdcpct:${c}`, perc(r.colonne[c].mdcPct));
  scrivi('barra:mi', euro(s.mi));

  const pil = $('#semaforo');
  if (pil) {
    pil.className = 'pillola ' + classeMargine(s.miPct, target);
    pil.textContent = 'MI simulato ' + perc(s.miPct) + (target > 0 ? ' · obiettivo ' + perc(target) : '');
  }

  const lettura = $('#lettura-riserva');
  if (lettura) {
    if (!(s.ricavo > 0)) lettura.textContent = 'Inserisci i ricavi di linea per calcolare la riserva.';
    else if (s.riserva >= 0) lettura.textContent = `I costi possono crescere di ${euro(s.riserva)} (${perc(s.riservaPct)}) prima di scendere sotto il margine obiettivo.`;
    else lettura.textContent = `I costi superano già di ${euro(-s.riserva)} il massimo compatibile con il margine obiettivo: servono ${perc(-s.riservaPct)} di riduzione.`;
  }

  if (scheda === 'confronto') disegnaCascata(r);
  if (scheda === 'simulazione') disegnaTornado();

  salvaBozza(sim);
}

// --- struttura -----------------------------------------------------------------------

const SCHEDE = [
  ['dati', 'Dati di commessa'],
  ['simulazione', 'Simulazione'],
  ['confronto', 'Confronto'],
  ['archivio', 'Archivio'],
];

/** In un contenitore incorporato i download vengono bloccati senza alcun errore visibile.
 *  In quel caso si offre il testo da copiare, invece di un pulsante che non fa nulla. */
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
  main.insertBefore(pannello, main.children[1] || null);
  area.focus();
  area.select();
}

function consegna(nomeFileCompleto, tipo, contenuto, titolo) {
  if (incorporata()) { offriTesto(titolo, nomeFileCompleto, contenuto); return; }
  consegna(nomeFile(sim).replace(/\.json$/, '.csv'), 'text/csv;charset=utf-8', '﻿' + csv,
    'Esportazione CSV');
}

function esportaCsv() {
  const r = calcola(sim);
  const righe = [['Commessa', sim.meta.codice], ['Cliente', sim.meta.cliente], ['Data', sim.meta.data], []];
  righe.push(['Linea', 'Categoria', 'Voce', 'Preventivo', 'KOM', 'Simulato']);
  for (const linea of sim.linee) {
    for (const cat of CATEGORIE) {
      for (const v of linea.voci.filter((x) => x.cat === cat)) {
        righe.push([linea.nome, ETICHETTA_CATEGORIA[cat], v.nome,
          r.colonne.preventivo.linee.find((l) => l.id === linea.id)?.voci[v.id] ?? 0,
          r.colonne.kom.linee.find((l) => l.id === linea.id)?.voci[v.id] ?? 0,
          r.colonne.simulato.linee.find((l) => l.id === linea.id)?.voci[v.id] ?? 0]);
      }
    }
    righe.push([linea.nome, 'Ricavo', '', ...COLONNE.map((c) => r.colonne[c].linee.find((l) => l.id === linea.id)?.ricavo ?? 0)]);
  }
  righe.push([]);
  for (const [et, k] of [['Ricavo', 'ricavo'], ['Costi diretti', 'cd'], ['Margine di contribuzione', 'mdc'], ['Spese generali', 'speseGenerali'], ['Contingency', 'contingency'], ['Margine industriale', 'mi']]) {
    righe.push(['TOTALE', et, '', ...COLONNE.map((c) => r.colonne[c][k])]);
  }
  righe.push(['TOTALE', 'Marginalità %', '', ...COLONNE.map((c) => (r.colonne[c].mdcPct ?? 0) * 100)]);
  righe.push(['TOTALE', 'Margine industriale %', '', ...COLONNE.map((c) => (r.colonne[c].miPct ?? 0) * 100)]);

  const csv = righe.map((r2) => r2.map((c) => {
    const s = typeof c === 'number' ? String(Math.round(c * 100) / 100).replace('.', ',') : String(c ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeFile(sim).replace(/\.json$/, '.csv');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function disegna() {
  const radice = $('#radice');
  radice.textContent = '';

  const nav = h('nav', { class: 'schede', role: 'tablist' },
    ...SCHEDE.map(([k, et]) => h('button', {
      role: 'tab', 'aria-selected': scheda === k ? 'true' : 'false', testo: et,
      onclick: () => { scheda = k; disegna(); },
    })));

  let contenuto;
  try {
    contenuto = scheda === 'dati' ? schedaDati()
      : scheda === 'simulazione' ? schedaSimulazione()
        : scheda === 'confronto' ? schedaConfronto()
          : schedaArchivio();
  } catch (e) {
    // Meglio una schermata che spiega il problema di una pagina bianca: i dati inseriti
    // restano in memoria e le altre schede continuano a funzionare.
    contenuto = h('div', { class: 'avviso' },
      h('span', {}, 'Questa scheda non si è potuta aprire: ' + (e && e.message ? e.message : 'errore sconosciuto')
        + '. Le altre schede e i dati inseriti non sono stati toccati.'));
  }

  const main = h('main', {},
    h('div', { id: 'messaggio', hidden: true }),
    contenuto);

  radice.appendChild(nav);
  radice.appendChild(main);
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
  return h('footer', { class: 'barra' },
    h('span', { class: 'pillola p-neutro', id: 'semaforo', testo: '—' }),
    h('div', { class: 'metrica' }, h('div', { class: 'et', testo: 'Ricavo simulato' }), h('div', { class: 'val', 'data-out': 'barra:ricavo', testo: '—' })),
    h('div', { class: 'metrica' }, h('div', { class: 'et', testo: 'Costi diretti' }), h('div', { class: 'val', 'data-out': 'barra:costi', testo: '—' })),
    h('div', { class: 'metrica forte' }, h('div', { class: 'et', testo: 'MdC simulato' }), h('div', { class: 'val', 'data-out': 'barra:mdc', testo: '—' })),
    h('div', { class: 'metrica' }, h('div', { class: 'et', testo: 'Marginalità prev.' }), h('div', { class: 'val', 'data-out': 'barra:mdcpct:preventivo', testo: '—' })),
    h('div', { class: 'metrica' }, h('div', { class: 'et', testo: 'Marginalità KOM' }), h('div', { class: 'val', 'data-out': 'barra:mdcpct:kom', testo: '—' })),
    h('div', { class: 'metrica forte' }, h('div', { class: 'et', testo: 'Marginalità sim.' }), h('div', { class: 'val', 'data-out': 'barra:mdcpct:simulato', testo: '—' })));
}

function datalist() {
  return h('div', { hidden: true },
    ...CATEGORIE.map((c) => h('datalist', { id: 'sugg-' + c },
      ...SUGGERIMENTI[c].map((s) => h('option', { value: s })))));
}

export function avvia() {
  document.body.appendChild(testa());
  document.body.appendChild(h('div', { id: 'radice' }));
  document.body.appendChild(barra());
  document.body.appendChild(datalist());

  const bozza = leggiBozza();
  const bozzaUtile = bozza && (bozza.meta.codice || bozza.linee.some((l) => l.voci.some((v) => v.kom.q || v.preventivo.q)));
  sim = bozzaUtile ? bozza : simulazioneEsempio();

  disegna();
  ripristinaCartella().then(() => ricaricaArchivio());
}
