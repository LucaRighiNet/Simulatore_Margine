// Interfaccia del simulatore. Tutto il calcolo sta in calcolo.mjs: qui si disegna e si
// raccoglie input. Il re-render completo avviene solo quando cambia la struttura
// (righe, linee, scheda); digitare un numero aggiorna soltanto i valori derivati, per non
// perdere il fuoco dal campo in cui si sta scrivendo.

import { calcola, calcolaColonna, sensitivita, gap, baseSimulato, incidenze, modoManodopera, scostamentoPerMargine, costoVoceSenzaScostamentoProprio, ricavoSenzaScostamentoProprio, scostamentoPerValore, LEVE, RIFERIMENTI_INCIDENZA, COLONNE, CATEGORIE, ETICHETTA_CATEGORIA, ETICHETTA_COLONNA } from './calcolo.mjs';
import { nuovaSimulazione, simulazioneEsempio, eEsempio, normalizza, nuovaVoce, nuovaLinea, nuovaTariffa, lineaStandard, nomiLineeStandard, SUGGERIMENTI, nomeFile } from './modello.mjs';
import {
  modo, salva, elenca, elimina, scegliCartella, supportaCartella, ripristinaCartella,
  scarica, apriFile, salvaBozza, leggiBozza,
} from './archivio.mjs';

let sim = nuovaSimulazione();
// Tre livelli di dettaglio. Si parte dal più semplice: nove numeri e un margine.
// Il dettaglio si aggiunge quando serve, con pulsanti espliciti, non tutto subito.
const LIVELLI = [
  ['base', 'Base', 'Ricavo, materiale e manodopera per servizio. Nove numeri in tutto.'],
  ['intermedio', 'Intermedio', 'Aggiunge la colonna Preventivo, gli altri costi diretti e le spese generali.'],
  ['completo', 'Completo', 'Righe per marca fornitore e tipo di manodopera, con tariffe orarie.'],
];
let livello = 'base';

const colonneInput = () => (livello === 'base' ? ['kom'] : ['preventivo', 'kom']);

/**
 * Categorie mostrate per una linea. Al livello Base gli altri costi diretti restano fuori,
 * ma solo finché sono a zero: nascondere un costo che sta abbassando il margine a schermo
 * significa far leggere un numero senza mostrarne la causa.
 */
const categorieVisibili = (linea) => {
  if (livello !== 'base') return CATEGORIE;
  const viste = ['materiale', 'manodopera'];
  const valorizzata = ((linea && linea.voci) || []).some((v) => v.cat === 'altri'
    && (Number(v.preventivo && v.preventivo.q) || Number(v.kom && v.kom.q)));
  if (valorizzata) viste.push('altri');
  return viste;
};
const etichettaLivello = (k) => (LIVELLI.find((x) => x[0] === k) || [])[1] || k;

/**
 * I costi di struttura e la riserva per imprevisti esistono solo se qualcuno li usa.
 * Quando sono entrambi a zero il margine industriale coincide con quello di contribuzione,
 * e mostrare due righe identiche con due nomi diversi confonde e basta: spariscono.
 */
const usaStruttura = () => Number(sim.parametri.sgPct || 0) !== 0 || Number(sim.parametri.ctgPct || 0) !== 0;
let scheda = 'dati';
let riferimentoIncidenza = 'cd';
let levaMargine = 'costi';
let livelloSensitivita = 'voce';
let margineVoluto = null;
let elencoArchivio = [];
let messaggio = null;
let ripristino = null;

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
    c.appendChild(h('button', {
      style: 'white-space:nowrap',
      testo: messaggio.azione.testo,
      onclick: messaggio.azione.onclick,
    }));
  }
}

/**
 * Esegue un'azione distruttiva conservando lo stato precedente, e offre di annullarla.
 * Cancellare una linea o una voce senza via di ritorno costringe a riscrivere tutto a mano.
 */
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


function pulsanteEspandi(aLivello, testo) {
  return h('button', {
    class: 'espandi', testo: testo,
    onclick: () => { livello = aLivello; disegna(); avvisa('Livello ' + etichettaLivello(aLivello) + '.'); },
  });
}

function tabellaTariffe() {
  return h('div', {},
    h('div', { class: 'tabellone' },
      h('table', { class: 'tab-dati' },
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Tipo di manodopera' }),
          h('th', { class: 'n', testo: 'Costo orario \u20ac/h' }),
          h('th', { class: 'azione-riga' }))),
        h('tbody', {}, ...sim.tariffe.map((tr, i) => h('tr', {},
          h('td', { 'data-et': 'Tipo' }, h('input', {
            type: 'text', value: tr.nome, 'aria-label': 'Nome del tipo di manodopera',
            oninput: (e) => { tr.nome = e.target.value; },
          })),
          h('td', { class: 'n', 'data-et': '\u20ac/h', style: 'width:130px' },
            inputNumero(`tariffe.${i}.eurOra`, tr.eurOra, { placeholder: 'da impostare' })),
          h('td', { class: 'azione-riga' }, h('button', {
            class: 'muto', title: 'Rimuovi tariffa', 'aria-label': 'Rimuovi tariffa', testo: '\u00d7',
            onclick: () => conAnnulla(`Tariffa "${tr.nome}" rimossa.`, () => sim.tariffe.splice(i, 1)),
          }))))))),
    h('button', {
      style: 'margin-top:8px', testo: '+ tipo di manodopera',
      onclick: () => { sim.tariffe.push(nuovaTariffa('Nuovo tipo', 0)); disegna(); },
    }),
    h('p', { class: 'nota', testo: 'Costo orario aziendale pieno, non prezzo di vendita. Finché resta a zero, il margine delle righe in ore non ha significato.' }));
}


function campoConEuro(etichetta, percorso, valore, chiaveEuro, aiuto) {
  return h('div', { class: 'campo-spiegato' },
    campoNumero(etichetta, percorso, valore),
    h('div', { class: 'valore-vivo' },
      h('span', { testo: 'sulla colonna simulata: ' }),
      h('b', { 'data-out': chiaveEuro, testo: '\u2014' })),
    h('p', { class: 'nota', style: 'margin-top:4px', testo: aiuto }));
}

function pannelloParametri() {
  const struttura = livello !== 'base';
  const campi = [campoNumero('Margine obiettivo %', 'parametri.targetPct', sim.parametri.targetPct)];

  return h('section', { class: 'pannello' },
    h('h2', { testo: livello === 'completo' ? 'Parametri e tariffe orarie' : 'Parametri' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'campi' }, ...campi),
      h('p', { class: 'nota', style: 'margin-top:4px', testo: 'Soglia sotto la quale la commessa non deve scendere. Colora il semaforo in basso e determina la riserva mostrata nel Confronto.' }),

      struttura
        ? h('div', { class: 'blocco-struttura' },
          h('h3', { class: 'sotto-titolo', testo: 'Costi che non stanno dentro la commessa' }),
          h('p', { class: 'nota', style: 'margin-top:0' }, 'Due percentuali applicate ai costi diretti. Se non le usate, lasciatele a zero: spariscono da tutte le tabelle e il margine industriale torna a coincidere con quello di contribuzione.'),
          h('div', { class: 'campi' },
            campoConEuro(
              'Costi di struttura sulla commessa %',
              'parametri.sgPct', sim.parametri.sgPct, 'tot:simulato:speseGenerali:euro',
              'Quota dei costi aziendali che non sono imputati a nessuna commessa \u2014 direzione, amministrazione, acquisti, immobili, mezzi \u2014 attribuita a questa commessa in proporzione ai suoi costi diretti. La percentuale la d\u00e0 il controllo di gestione, non si inventa.'),
            campoConEuro(
              'Riserva per imprevisti %',
              'parametri.ctgPct', sim.parametri.ctgPct, 'tot:simulato:contingency:euro',
              'Margine di sicurezza tenuto sui costi per rischi non ancora emersi: varianti, rilavorazioni, fermi. Non \u00e8 un costo gi\u00e0 sostenuto, \u00e8 un accantonamento.')))
        : h('p', { class: 'nota' },
          'A questo livello non ci sono costi di struttura n\u00e9 riserva per imprevisti: il margine \u00e8 semplicemente ricavo meno costi diretti. ',
          pulsanteEspandi('intermedio', 'Aggiungili')),

      livello === 'completo' ? h('div', { style: 'margin-top:14px' },
        h('h3', { class: 'sotto-titolo', testo: 'Tariffe orarie' }),
        tabellaTariffe(),
        h('div', { class: 'campi', style: 'margin-top:8px' },
          campoTesto('Tariffe valide dal', 'parametri.validitaTariffe', sim.parametri.validitaTariffe, { type: 'date' }))) : null,

      livello === 'intermedio'
        ? h('p', { class: 'nota' }, 'Le tariffe orarie servono solo se inserisci la manodopera in ore. ',
          pulsanteEspandi('completo', 'Vai al dettaglio per voce'))
        : null));
}



/**
 * Larghezze di colonna deterministiche. Senza, ogni tabella si dimensiona sul proprio
 * contenuto e le colonne di due linee di servizio non si allineano fra loro; dentro la
 * stessa colonna, una riga con lo sconto e una senza finiscono con l'input di larghezza
 * diversa e il bordo destro sfalsato.
 */
const L_VOCE = 300;
const L_VALORE = 200;
const L_AZIONE = 48;

function colonneTabella(nValori, conAzione) {
  // Percentuali ricavate dalle larghezze di riferimento: con le percentuali la tabella
  // si restringe insieme alla finestra, con i pixel resterebbe rigida e finirebbe per
  // uscire dallo schermo.
  const totale = larghezzaTabella(nValori, conAzione);
  const q = (px) => ((px / totale) * 100).toFixed(3) + '%';
  return h('colgroup', {},
    h('col', { style: `width:${q(L_VOCE)}` }),
    ...Array.from({ length: nValori + 1 }, () => h('col', { style: `width:${q(L_VALORE)}` })),
    conAzione ? h('col', { style: `width:${q(L_AZIONE)}` }) : null);
}

/** Oltre questa larghezza la tabella smette di allargarsi: le colonne non hanno nulla da
 *  farci con lo spazio in più, e il numero finirebbe lontano dalla voce a cui si riferisce. */
function larghezzaTabella(nValori, conAzione) {
  return L_VOCE + L_VALORE * (nValori + 1) + (conAzione ? L_AZIONE : 0);
}

/**
 * Ogni cella numerica ha la stessa struttura: un campo principale che occupa lo spazio
 * disponibile e uno slot accessorio di larghezza fissa, presente anche quando è vuoto.
 * È lo slot vuoto a tenere allineate fra loro righe che hanno contenuti diversi.
 */
/**
 * Cella della colonna Simulato, scrivibile. È qui che si simula: si scrive quanto si vuole
 * che quella voce costi e lo strumento ricava da sé lo scostamento che produce quel
 * numero. Prima questa colonna era di sola lettura e l'unico modo di simulare erano i
 * cursori in un'altra scheda, che è il motivo per cui non si capiva dove mettere i valori.
 */
function cellaSimulataVoce(linea, voce) {
  const campo = h('input', {
    type: 'text', inputmode: 'decimal', class: 'num principale simulato',
    'data-out': 'voce:' + voce.id,
    placeholder: '\u2014',
    'aria-label': 'Costo simulato di ' + (voce.nome || 'questa voce'),
    oninput: (e) => {
      if (!sim.delta.voce) sim.delta.voce = {};
      const testo = e.target.value.trim();
      if (testo === '') { delete sim.delta.voce[voce.id]; aggiornaDerivati(); return; }
      const partenza = costoVoceSenzaScostamentoProprio(sim, linea, voce);
      const d = scostamentoPerValore(partenza, leggiNumero(testo));
      if (d === null) {
        avvisa('Questa voce parte da zero: inserisci prima un valore nella colonna ' + ETICHETTA_COLONNA[baseSimulato(sim)] + '.');
        return;
      }
      sim.delta.voce[voce.id] = d;
      aggiornaDerivati();
    },
  });
  return h('td', { class: 'n', 'data-et': 'Simulato' },
    h('div', { class: 'coppia coppia-valore' },
      campo,
      h('span', { class: 'accessorio' },
        h('span', { class: 'direzione' }),
        h('span', { class: 'suff', testo: '\u20ac' }))));
}

/** Stessa logica per il ricavo del servizio. */
function cellaSimulataRicavo(linea) {
  const campo = h('input', {
    type: 'text', inputmode: 'decimal', class: 'num principale simulato',
    'data-out': 'ricavo:' + linea.id,
    placeholder: '\u2014',
    'aria-label': 'Ricavo simulato di ' + (linea.nome || 'questo servizio'),
    oninput: (e) => {
      if (!sim.delta.ricavoLinea) sim.delta.ricavoLinea = {};
      const testo = e.target.value.trim();
      if (testo === '') { delete sim.delta.ricavoLinea[linea.id]; aggiornaDerivati(); return; }
      const partenza = ricavoSenzaScostamentoProprio(sim, linea);
      const d = scostamentoPerValore(partenza, leggiNumero(testo));
      if (d === null) {
        avvisa('Questo servizio parte da ricavo zero: inseriscilo prima nella colonna ' + ETICHETTA_COLONNA[baseSimulato(sim)] + '.');
        return;
      }
      sim.delta.ricavoLinea[linea.id] = d;
      aggiornaDerivati();
    },
  });
  return h('td', { class: 'n', 'data-et': 'Simulato' },
    h('div', { class: 'coppia coppia-valore' },
      campo,
      h('span', { class: 'accessorio' },
        h('span', { class: 'direzione' }),
        h('span', { class: 'suff', testo: '\u20ac' }))));
}

function cellaValore(voce, colonna, percorsoBase) {
  const accessorio = (...figli) => h('span', { class: 'accessorio' }, ...figli);
  let dentro;

  if (voce.cat === 'manodopera') {
    const ore = modoManodopera(voce) === 'ore';
    dentro = [
      inputNumero(`${percorsoBase}.${colonna}.q`, voce[colonna].q, { class: 'num principale', placeholder: '0' }),
      accessorio(h('span', { class: 'suff', testo: ore ? 'h' : '\u20ac' })),
    ];
  } else if (voce.cat === 'materiale') {
    dentro = [
      inputNumero(`${percorsoBase}.${colonna}.q`, voce[colonna].q, { class: 'num principale', placeholder: 'listino', title: 'Importo di listino' }),
      accessorio(
        inputNumero(`${percorsoBase}.${colonna}.sconto`, voce[colonna].sconto, { class: 'num sconto', placeholder: '0', title: 'Sconto percentuale sul listino' }),
        h('span', { class: 'suff', testo: '%' })),
    ];
  } else {
    dentro = [
      inputNumero(`${percorsoBase}.${colonna}.q`, voce[colonna].q, { class: 'num principale', placeholder: '0' }),
      accessorio(h('span', { class: 'suff', testo: '\u20ac' })),
    ];
  }

  return h('td', { class: 'n', 'data-et': ETICHETTA_COLONNA[colonna] },
    h('div', { class: 'coppia coppia-valore' }, ...dentro));
}

/** Cella di sola lettura con lo stesso impianto, per restare allineata alle celle editabili. */
function cellaRicavo(percorso, valore, colonna) {
  return h('td', { class: 'n', 'data-et': ETICHETTA_COLONNA[colonna] },
    h('div', { class: 'coppia coppia-valore' },
      inputNumero(percorso, valore, { class: 'num principale', placeholder: '0' }),
      h('span', { class: 'accessorio' }, h('span', { class: 'suff', testo: '\u20ac' }))));
}


function rigaVoce(linea, iL, voce, iV) {
  const base = `linee.${iL}.voci.${iV}`;
  const celleNome = [h('input', {
    type: 'text', value: voce.nome, list: 'sugg-' + voce.cat,
    'aria-label': 'Nome della voce',
    oninput: (e) => { voce.nome = e.target.value; },
  })];

  if (voce.cat === 'manodopera') {
    const ore = modoManodopera(voce) === 'ore';
    celleNome.push(h('div', { class: 'riga-tariffa' },
      h('button', {
        class: 'muto commuta', testo: ore ? 'ore' : '\u20ac',
        title: ore
          ? 'Inserita in ore per tariffa oraria. Premi per passare a importo diretto in euro.'
          : 'Inserita come importo in euro. Premi per passare a ore per tariffa oraria.',
        'aria-label': ore ? 'Manodopera in ore per tariffa' : 'Manodopera come importo',
        onclick: () => {
          voce.modo = ore ? 'importo' : 'ore';
          if (voce.modo === 'ore' && !voce.tariffaId && sim.tariffe.length) voce.tariffaId = sim.tariffe[0].id;
          disegna();
        },
      }),
      ore ? h('select', {
        'aria-label': 'Tariffa oraria applicata',
        onchange: (e) => { voce.tariffaId = e.target.value || null; aggiornaDerivati(); },
      },
      h('option', { value: '', testo: '\u2014 nessuna tariffa \u2014' }),
      ...sim.tariffe.map((tr) => h('option', {
        value: tr.id, selected: tr.id === voce.tariffaId,
        testo: `${tr.nome} \u00b7 ${tr.eurOra ? numero(tr.eurOra) + ' \u20ac/h' : 'da impostare'}`,
      }))) : null));
  }

  return h('tr', {},
    h('td', { 'data-et': 'Voce' }, ...celleNome),
    ...colonneInput().map((c) => cellaValore(voce, c, base)),
    cellaSimulataVoce(linea, voce),
    h('td', { class: 'azione-riga' }, h('button', {
      class: 'muto', title: 'Rimuovi voce', 'aria-label': 'Rimuovi voce', testo: '\u00d7',
      onclick: () => conAnnulla(`Voce "${voce.nome || 'senza nome'}" rimossa.`, () => linea.voci.splice(iV, 1)),
    })));
}


function tabellaLineaDettagliata(linea, iL) {
  const cols = colonneInput();
  const corpo = h('tbody', {});
  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { 'data-et': 'Voce', testo: 'Ricavo del servizio' }),
    ...cols.map((c) => cellaRicavo(`linee.${iL}.ricavo.${c}`, linea.ricavo[c], c)),
    cellaSimulataRicavo(linea),
    h('td', { class: 'azione-riga' })));

  for (const cat of categorieVisibili(linea)) {
    const voci = linea.voci.filter((v) => v.cat === cat);
    corpo.appendChild(h('tr', { class: 'cat' }, h('td', { colspan: cols.length + 3 }, ETICHETTA_CATEGORIA[cat])));
    for (const voce of voci) corpo.appendChild(rigaVoce(linea, iL, voce, linea.voci.indexOf(voce)));
    corpo.appendChild(h('tr', {},
      h('td', { 'data-et': 'Voce' }, h('button', {
        class: 'muto', testo: '+ voce',
        onclick: () => { linea.voci.push(nuovaVoce(cat, '', sim.tariffe)); disegna(); },
      })),
      ...cols.map(() => h('td', { class: 'n' })),
      h('td', { class: 'n derivato', 'data-et': 'Totale ' + ETICHETTA_CATEGORIA[cat], 'data-out': `cat:${linea.id}:${cat}`, testo: '\u2014' }),
      h('td', { class: 'azione-riga' })));
  }

  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { 'data-et': 'Voce', testo: 'Totale costi diretti' }),
    ...cols.map((c) => h('td', { class: 'n', 'data-et': ETICHETTA_COLONNA[c], 'data-out': `cdcol:${linea.id}:${c}`, testo: '\u2014' })),
    h('td', { class: 'n', 'data-et': 'Simulato', 'data-out': `cdcol:${linea.id}:simulato`, testo: '\u2014' }),
    h('td', { class: 'azione-riga' })));
  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { 'data-et': 'Voce', testo: 'Margine di contribuzione' }),
    ...[...cols, 'simulato'].map((c) => h('td', { class: 'n', 'data-et': ETICHETTA_COLONNA[c], 'data-out': `mdclinea:${linea.id}:${c}`, testo: '\u2014' })),
    h('td', { class: 'azione-riga' })));

  return h('div', { class: 'tabellone' }, h('table', {
    class: 'tab-dati tab-fissa',
    style: `max-width:${larghezzaTabella(cols.length, true)}px`,
  },
    colonneTabella(cols.length, true),
    h('thead', {}, h('tr', {},
      h('th', { testo: 'Voce' }),
      ...cols.map((c) => h('th', { class: 'n', testo: ETICHETTA_COLONNA[c] })),
      h('th', { class: 'n', testo: 'Simulato' }),
      h('th', { class: 'azione-riga' }))),
    corpo));
}


function tabellaLineaSemplice(linea, iL) {
  const cols = colonneInput();
  const corpo = h('tbody', {});
  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { 'data-et': 'Voce', testo: 'Ricavo del servizio' }),
    ...cols.map((c) => cellaRicavo(`linee.${iL}.ricavo.${c}`, linea.ricavo[c], c)),
    cellaSimulataRicavo(linea)));

  for (const cat of categorieVisibili(linea)) {
    const voci = linea.voci.filter((v) => v.cat === cat);
    const unica = voci.length === 1 ? voci[0] : null;
    const iV = unica ? linea.voci.indexOf(unica) : -1;
    const suffisso = unica && unica.cat === 'manodopera' && modoManodopera(unica) === 'ore' ? ' (ore)' : '';
    const suff = unica && unica.cat === 'manodopera' && modoManodopera(unica) === 'ore' ? 'h' : '\u20ac';
    const celle = cols.map((c) => (unica
      ? h('td', { class: 'n', 'data-et': ETICHETTA_COLONNA[c] },
        h('div', { class: 'coppia coppia-valore' },
          inputNumero(`linee.${iL}.voci.${iV}.${c}.q`, unica[c].q, { class: 'num principale', placeholder: '0' }),
          h('span', { class: 'accessorio' }, h('span', { class: 'suff', testo: suff }))))
      : h('td', { class: 'n derivato', 'data-et': ETICHETTA_COLONNA[c], 'data-out': `catcol:${linea.id}:${cat}:${c}`, testo: '\u2014' })));

    corpo.appendChild(h('tr', {},
      h('td', { 'data-et': 'Voce' },
        h('strong', { testo: ETICHETTA_CATEGORIA[cat] + suffisso }),
        voci.length > 1
          ? h('div', { class: 'nota', style: 'margin:0' },
            `somma di ${voci.length} voci. `,
            h('button', {
              class: 'muto commuta',
              testo: 'modifica nel dettaglio',
              onclick: () => { livello = 'completo'; disegna(); avvisa('Livello Completo: ora le singole voci sono modificabili.'); },
            }))
          : null,
        voci.length === 0
          ? h('button', {
            class: 'muto', testo: '+ aggiungi',
            onclick: () => { linea.voci.push(nuovaVoce(cat, ETICHETTA_CATEGORIA[cat], sim.tariffe)); disegna(); },
          })
          : null),
      ...celle,
      h('td', { class: 'n derivato', 'data-et': 'Simulato', 'data-out': `cat:${linea.id}:${cat}`, testo: '\u2014' })));
  }

  corpo.appendChild(h('tr', { class: 'somma' },
    h('td', { 'data-et': 'Voce', testo: 'Margine di contribuzione' }),
    ...[...cols, 'simulato'].map((c) => h('td', { class: 'n', 'data-et': ETICHETTA_COLONNA[c], 'data-out': `mdclinea:${linea.id}:${c}`, testo: '\u2014' }))));

  return h('div', { class: 'tabellone' }, h('table', {
    class: 'tab-dati tab-fissa',
    style: `max-width:${larghezzaTabella(cols.length, false)}px`,
  },
    colonneTabella(cols.length, false),
    h('thead', {}, h('tr', {},
      h('th', { testo: 'Categoria' }),
      ...cols.map((c) => h('th', { class: 'n', testo: ETICHETTA_COLONNA[c] })),
      h('th', { class: 'n', testo: 'Simulato' }))),
    corpo));
}


function pannelloLinea(linea, iL) {
  return h('section', { class: 'pannello' },
    h('div', { class: 'linea-titolo' },
      h('input', {
        type: 'text', value: linea.nome, 'aria-label': 'Nome del servizio',
        oninput: (e) => { linea.nome = e.target.value; aggiornaDerivati(); },
      }),
      h('button', {
        class: 'muto', title: 'Rimuovi il servizio', 'aria-label': 'Rimuovi il servizio', testo: '\u00d7',
        onclick: () => conAnnulla(`Servizio "${linea.nome}" rimossa con le sue ${linea.voci.length} voci.`, () => sim.linee.splice(iL, 1)),
      })),
    livello === 'completo' ? tabellaLineaDettagliata(linea, iL) : tabellaLineaSemplice(linea, iL));
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


function pannelloLivello() {
  const corrente = LIVELLI.find((x) => x[0] === livello);
  return h('section', { class: 'pannello pannello-livello' },
    h('div', { class: 'corpo' },
      h('div', { class: 'scelta-livello' },
        h('span', { class: 'et-livello', testo: 'Livello di dettaglio' }),
        h('div', { class: 'gruppo-bottoni' },
          ...LIVELLI.map(([k, et]) => h('button', {
            class: livello === k ? 'selezionato' : '', testo: et,
            'aria-pressed': livello === k ? 'true' : 'false',
            onclick: () => { livello = k; disegna(); },
          })))),
      h('p', { class: 'nota', style: 'margin-top:6px', testo: corrente ? corrente[2] : '' })));
}

function guidaColonne() {
  const base = ETICHETTA_COLONNA[baseSimulato(sim)];
  const voci = [];
  if (colonneInput().includes('preventivo')) voci.push(['Preventivo', 'i numeri dell\u2019offerta. Si scrivono una volta e restano come riferimento.']);
  voci.push(['KOM', 'il budget concordato al kick off meeting. È la base su cui poggia la simulazione.']);
  voci.push(['Simulato', `si scrive qui. Metti quanto pensi che quella voce costerà davvero e il margine si aggiorna subito. Svuotando la casella torna al valore ${base}.`]);

  return h('section', { class: 'pannello pannello-guida-colonne' },
    h('div', { class: 'corpo' },
      h('h3', { class: 'sotto-titolo', testo: 'Dove si scrivono i valori' }),
      h('dl', { class: 'guida-elenco' },
        ...voci.flatMap(([et, testo]) => [h('dt', { testo: et }), h('dd', { testo })])),
      h('p', { class: 'nota legenda-colori' },
        h('span', { class: 'v-buono', testo: '\u25bc verde' }), ' il margine ci guadagna, ',
        h('span', { class: 'v-critico', testo: '\u25b2 rosso' }), ' ci perde. Su un costo guadagna quando scende, su ricavo e margine quando salgono.'),
      h('p', { class: 'nota' }, 'Per variare più voci insieme, o per partire dal margine che vuoi ottenere, usa la scheda ',
        h('button', {
          class: 'muto commuta', testo: 'Simulazione',
          onclick: () => { scheda = 'simulazione'; disegna(); },
        }), '.')));
}

function schedaDati() {
  const espansioni = [];
  if (livello === 'base') {
    espansioni.push(pulsanteEspandi('intermedio', '+ Confronta con il preventivo'));
    espansioni.push(pulsanteEspandi('intermedio', '+ Altri costi diretti: trasferte, noleggi, subappalti'));
  }
  if (livello === 'intermedio') {
    espansioni.push(pulsanteEspandi('completo', '+ Dettaglio per marca fornitore e tipo di manodopera'));
  }

  return h('div', {},
    bannerEsempio(),
    pannelloLivello(),
    guidaColonne(),
    pannelloCommessa(),
    pannelloParametri(),
    ...sim.linee.map((l, i) => pannelloLinea(l, i)),
    espansioni.length
      ? h('section', { class: 'pannello' },
        h('h2', { testo: 'Serve più dettaglio?' }),
        h('div', { class: 'corpo' },
          h('div', { class: 'azioni' }, ...espansioni),
          h('p', { class: 'nota', testo: 'Nulla di quello che hai inserito viene perso: il livello cambia solo cosa è visibile.' })))
      : null,
    pannelloAggiungiLinea());
}

function pannelloAggiungiLinea() {
  const presenti = new Set(sim.linee.map((l) => l.nome.trim().toLowerCase()));
  const mancanti = nomiLineeStandard().filter((n) => !presenti.has(n.trim().toLowerCase()));
  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Aggiungi un servizio' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'azioni' },
        ...mancanti.map((n) => h('button', {
          class: 'primario', testo: '+ ' + n,
          onclick: () => {
            sim.linee.push(lineaStandard(n, sim.tariffe));
            disegna();
            avvisa(`Servizio "${n}" aggiunto con le sue voci di default.`);
          },
        })),
        h('button', {
          testo: '+ servizio personalizzato',
          onclick: () => { sim.linee.push(nuovaLinea('Nuovo servizio')); disegna(); },
        })),
      mancanti.length
        ? h('p', { class: 'nota', testo: 'I servizi standard tornano completi delle loro voci di default. I valori vanno reinseriti.' })
        : h('p', { class: 'nota', testo: 'Tutti e tre i servizi standard sono presenti.' })));
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

/** Effetto della simulazione, mostrato dove si agisce: senza questo riquadro si muovono i
 *  cursori e il risultato si vede solo cambiando scheda. */
function riepilogoSimulazione() {
  const righe = [
    ['ricavo', 'euro', 'Ricavo'],
    ['cd', 'euro', 'Costi diretti'],
    ['mdc', 'euro', 'Margine di contribuzione'],
    ['mdcPct', 'perc', 'Marginalità'],
    ...(usaStruttura() ? [
      ['mi', 'euro', 'Margine industriale'],
      ['miPct', 'perc', 'Margine industriale %'],
    ] : []),
  ];
  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Effetto della simulazione' }),
    h('div', { class: 'corpo' },
      h('p', { class: 'nota', style: 'margin-top:0', id: 'base-simulazione', testo: '' }),
      h('div', { class: 'tabellone' }, h('table', { class: 'tab-confronto' },
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Grandezza' }),
          h('th', { class: 'n', 'data-out': 'cmp:intestazione', testo: 'Base' }),
          h('th', { class: 'n', testo: 'Simulato' }),
          h('th', { class: 'n', testo: 'Variazione' }))),
        h('tbody', {}, ...righe.map(([k, f, et]) => h('tr', k === 'mdc' || k === 'miPct' ? { class: 'somma' } : {},
          h('td', { 'data-et': 'Grandezza', testo: et }),
          h('td', { class: 'n', 'data-et': 'Base', 'data-out': `cmp:${k}:base:${f}`, testo: '\u2014' }),
          h('td', { class: 'n', 'data-et': 'Simulato', 'data-out': `cmp:${k}:sim:${f}`, testo: '\u2014' }),
          h('td', { class: 'n', 'data-et': 'Variazione', 'data-out': `cmp:${k}:delta:${f}`, testo: '\u2014' })))))))); 
}

/**
 * Terza via di simulazione, oltre a costi e ricavi: si parte dal margine che si vuole
 * ottenere e lo strumento dice quale scostamento serve. Il risultato non è una risposta
 * chiusa: diventa uno scostamento normale, visibile nei cursori, modificabile e
 * annullabile come se fosse stato inserito a mano.
 */
function pannelloMargine() {
  const valore = margineVoluto === null ? (sim.parametri.targetPct || 0) : margineVoluto;

  const applica = () => {
    const r = scostamentoPerMargine(sim, valore, levaMargine);
    if (!r.possibile) { avvisa(r.motivo); return; }
    const campo = levaMargine === 'costi' ? 'globale' : 'ricavo';
    // Arrotondato al centesimo di punto: un cursore con quindici decimali non si legge e
    // non si ritocca, e sul margine la differenza è sotto il decimo di punto.
    const scostamento = Math.round(r.deltaPct * 100) / 100;
    conAnnulla(
      `Applicato ${percRel(scostamento)} su ${levaMargine === 'costi' ? 'tutti i costi' : 'tutti i ricavi'} per raggiungere il ${perc(valore / 100)}.`,
      () => { sim.delta = { ...(sim.delta || {}), [campo]: scostamento }; },
    );
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
        h('div', { class: 'scelta-leva' },
          h('span', { class: 'et-livello', testo: 'Agendo su' }),
          h('div', { class: 'gruppo-bottoni' },
            ...Object.entries(LEVE).map(([k, et]) => h('button', {
              class: levaMargine === k ? 'selezionato' : '', testo: et,
              'aria-pressed': levaMargine === k ? 'true' : 'false',
              onclick: () => { levaMargine = k; disegna(); },
            }))))),
      h('p', { class: 'esito-margine', id: 'esito-margine', testo: '' }),
      h('div', { class: 'azioni' },
        h('button', { class: 'primario', testo: 'Applica lo scostamento', onclick: applica }),
        h('button', {
          testo: 'Azzera gli scostamenti',
          onclick: () => { sim.delta = { ricavo: 0, ricavoLinea: {}, globale: 0, linea: {}, catLinea: {}, voce: {} }; disegna(); },
        })),
      h('p', { class: 'nota', testo: 'Lo scostamento calcolato finisce nei cursori qui sotto: da lì lo puoi ritoccare, distribuire su un singolo servizio o annullare.' })));
}

function schedaSimulazione() {
  const globali = h('div', { class: 'cursori' },
    cursore('Tutti i costi', 'delta.globale', sim.delta.globale),
    cursore('Tutti i ricavi', 'delta.ricavo', sim.delta.ricavo));

  const perLinea = sim.linee.map((l) => h('section', { class: 'pannello' },
    h('h2', { testo: l.nome || 'Servizio' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'cursori' },
        cursore('Ricavo del servizio', `delta.ricavoLinea.${l.id}`, sim.delta.ricavoLinea?.[l.id] ?? 0),
        cursore('Tutti i costi del servizio', `delta.linea.${l.id}`, sim.delta.linea?.[l.id] ?? 0),
        ...CATEGORIE.filter((c) => l.voci.some((v) => v.cat === c)).map((c) =>
          cursore(ETICHETTA_CATEGORIA[c], `delta.catLinea.${l.id}|${c}`, sim.delta.catLinea?.[`${l.id}|${c}`] ?? 0, `catsim:${l.id}:${c}`))))));

  return h('div', {},
    riepilogoSimulazione(),
    pannelloMargine(),
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Scostamenti complessivi' }),
      h('div', { class: 'corpo' }, globali,
        h('p', { class: 'nota' }, 'Gli scostamenti si applicano alla colonna KOM e si compongono moltiplicativamente: complessivo, poi servizio, poi categoria. Il KOM non viene modificato.'),
        h('button', {
          style: 'margin-top:8px', testo: 'Azzera tutti gli scostamenti',
          onclick: () => { sim.delta = { ricavo: 0, ricavoLinea: {}, globale: 0, linea: {}, catLinea: {}, voce: {} }; disegna(); },
        }))),
    ...perLinea,
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Dove conviene intervenire' }),
      h('div', { class: 'corpo' },
        h('div', { class: 'azioni', style: 'margin-bottom:8px;align-items:center' },
          h('span', { class: 'et-livello', testo: 'Dettaglio' }),
          ...[['voce', 'Per voce'], ['categoria', 'Per categoria']].map(([k, et]) => h('button', {
            class: livelloSensitivita === k ? 'selezionato' : '', testo: et,
            'aria-pressed': livelloSensitivita === k ? 'true' : 'false',
            onclick: () => { livelloSensitivita = k; disegna(); },
          }))),
        h('div', { id: 'tornado' }),
        h('p', { class: 'nota', testo: 'Effetto sul margine di una variazione di più o meno 10%, tenendo fermo tutto il resto. In cima c\u2019è la voce dove un punto guadagnato vale di più.' }))));
}

// --- scheda confronto --------------------------------------------------------------


function rigaConfronto(etichetta, chiave, formato = 'euro', forte = false) {
  return h('tr', forte ? { class: 'somma' } : {},
    h('td', { 'data-et': 'Voce', testo: etichetta }),
    ...COLONNE.map((c) => h('td', {
      class: 'n', 'data-et': ETICHETTA_COLONNA[c],
      'data-out': `tot:${c}:${chiave}:${formato}`, testo: '\u2014',
    })));
}


function tabellaGap(titolo, chiave, sottotitolo) {
  const conMi = usaStruttura();
  const riga = (et, k) => h('tr', k === 'effettoRicavo' || k === 'effettoCosto' ? { class: 'somma' } : {},
    h('td', { 'data-et': 'Grandezza', testo: et }),
    h('td', { class: 'n', 'data-et': 'Margine di contribuzione', 'data-out': `gap:${chiave}:${k}:${k.includes('Pp') ? 'punti' : k.includes('Rel') ? 'rel' : 'euro'}`, testo: '\u2014' }),
    !conMi ? null
      : (k === 'effettoRicavo' || k === 'effettoCosto')
        ? h('td', { class: 'n', 'data-et': 'Margine industriale' })
        : h('td', { class: 'n', 'data-et': 'Margine industriale', 'data-out': `gap:${chiave}:${k.replace('Mdc', 'Mi')}:${k.includes('Pp') ? 'punti' : k.includes('Rel') ? 'rel' : 'euro'}`, testo: '\u2014' }));

  return h('section', { class: 'pannello' },
    h('h2', { testo: titolo }),
    h('div', { class: 'corpo' },
      h('p', { class: 'nota', style: 'margin-top:0', testo: sottotitolo }),
      h('div', { class: 'tabellone' }, h('table', { class: 'tab-confronto' },
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Grandezza' }),
          h('th', { class: 'n', testo: 'Margine di contribuzione' }),
          conMi ? h('th', { class: 'n', testo: 'Margine industriale' }) : null)),
        h('tbody', {},
          riga('Variazione assoluta', 'dMdc'),
          riga('Variazione della marginalità', 'dMdcPp'),
          riga('Variazione relativa del margine', 'dMdcRel'),
          riga('di cui effetto ricavo', 'effettoRicavo'),
          riga('di cui effetto costo', 'effettoCosto')))),
      h('div', { class: 'tabellone', style: 'margin-top:10px' }, h('table', { class: 'tab-confronto' },
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Per servizio' }),
          h('th', { class: 'n', testo: 'Effetto ricavo' }),
          ...CATEGORIE.map((c) => h('th', { class: 'n', testo: ETICHETTA_CATEGORIA[c] })),
          h('th', { class: 'n', testo: 'Totale' }))),
        h('tbody', { 'data-lista': 'perlinea:' + chiave })))));
}

function pannelloIncidenze() {
  const spiegazione = riferimentoIncidenza === 'cd'
    ? 'Quanto pesa ogni voce sui costi diretti: descrive la composizione del costo. Attenzione: uno scostamento applicato a tutte le voci nella stessa misura non muove queste percentuali, perché le proporzioni restano identiche.'
    : 'Quanto pesa ogni voce sul ricavo: descrive quanta parte della commessa se ne va in quella voce. Si muove per qualunque scostamento. Le voci più il margine di contribuzione fanno 100%.';

  return h('section', { class: 'pannello' },
    h('h2', { testo: 'Incidenza delle voci e come si sposta' }),
    h('div', { class: 'corpo' },
      h('div', { class: 'azioni', style: 'margin-bottom:8px;align-items:center' },
        h('strong', { style: 'font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3)', testo: 'Incidenza su' }),
        ...Object.entries(RIFERIMENTI_INCIDENZA).map(([k, et]) => h('button', {
          class: riferimentoIncidenza === k ? 'selezionato' : '', testo: et,
          onclick: () => { riferimentoIncidenza = k; disegna(); },
        }))),
      h('p', { class: 'nota', style: 'margin-top:0', testo: spiegazione }),
      h('div', { class: 'tabellone' }, h('table', { class: 'tab-confronto tab-incidenze' },
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Voce' }),
          ...COLONNE.map((c) => h('th', { class: 'n', testo: ETICHETTA_COLONNA[c] })),
          h('th', { class: 'n', testo: 'Prev \u2192 KOM' }),
          h('th', { class: 'n', testo: 'KOM \u2192 Sim' }))),
        h('tbody', { 'data-lista': 'incidenze' })))));
}

function schedaConfronto() {
  return h('div', {},
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Le tre colonne a confronto' }),
      h('div', { class: 'tabellone' }, h('table', { class: 'tab-confronto' },
        h('thead', {}, h('tr', {},
          h('th', { testo: 'Voce' }),
          ...COLONNE.map((c) => h('th', { class: 'n', testo: ETICHETTA_COLONNA[c] })))),
        h('tbody', {},
          rigaConfronto('Ricavo', 'ricavo'),
          rigaConfronto('Costi diretti', 'cd'),
          rigaConfronto('Margine di contribuzione', 'mdc', 'euro', true),
          rigaConfronto('Marginalità', 'mdcPct', 'perc', true),
          ...(usaStruttura() ? [
            rigaConfronto('Costi di struttura', 'speseGenerali'),
            rigaConfronto('Riserva per imprevisti', 'contingency'),
            rigaConfronto('Margine industriale', 'mi', 'euro', true),
            rigaConfronto('Margine industriale %', 'miPct', 'perc', true),
          ] : []))),
      usaStruttura()
        ? h('p', { class: 'nota', style: 'padding:0 14px 12px' }, 'Margine di contribuzione: ricavo meno costi diretti. Margine industriale: dopo aver tolto anche i costi di struttura e la riserva per imprevisti.')
        : h('p', { class: 'nota', style: 'padding:0 14px 12px' }, 'Costi di struttura e riserva per imprevisti sono a zero, quindi non compaiono: qui il margine è ricavo meno costi diretti.'))),
    h('section', { class: 'pannello' },
      h('h2', { testo: 'Dal preventivo al simulato' }),
      h('div', { class: 'corpo' },
        h('div', { id: 'cascata' }),
        h('p', { class: 'nota', testo: 'Margine di contribuzione. Le barre intermedie scompongono ogni scostamento in effetto ricavo ed effetto costo.' }))),
    pannelloIncidenze(),
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


function vociGuida(righe) {
  return h('dl', { class: 'guida-elenco' },
    ...righe.flatMap(([et, testo]) => [h('dt', { testo: et }), h('dd', { testo })]));
}

function schedaGuida() {
  const suTouch = matchMedia('(hover: none)').matches;
  const cartella = supportaCartella();

  return h('div', { class: 'guida' },
    h('section', { class: 'pannello' },
      h('h2', { testo: 'A cosa serve' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Simula come si muove il margine di una commessa al variare dei costi, divisi per servizio. Non è un consuntivo e non tiene lo storico: ogni simulazione è una fotografia del momento in cui la fai. Quando serve, la salvi in archivio e non ci torni più sopra.'),
        h('p', {}, 'Tre colonne sulla stessa struttura: ',
          h('b', { testo: 'Preventivo' }), ' (l’offerta), ',
          h('b', { testo: 'KOM' }), ' (il budget concordato al kick off meeting) e ',
          h('b', { testo: 'Simulato' }), ' (lo scenario che stai provando). La colonna Simulato si scrive: metti quanto pensi che una voce costerà davvero e il margine si aggiorna subito. Svuotando la casella torna al valore di partenza.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Inizia semplice, aggiungi dettaglio dopo' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Lo strumento si apre al livello Base: per ogni servizio inserisci ricavo, materiale e manodopera. Nove numeri e hai un margine. Quando ti serve di più, i pulsanti nella scheda Dati espandono la maschera senza perdere nulla di quanto inserito.'),
        h('p', {}, 'Dove si scrivono i valori: Preventivo e KOM sono i numeri di partenza, la colonna Simulato è quella su cui si lavora. Si scrive direttamente lì, voce per voce, ed è anche il modo per capire dove conviene ottimizzare: cambi una voce alla volta e guardi il margine.'),
        vociGuida([
          ['Base', 'Ricavo, materiale e manodopera per servizio, una colonna sola. Per una stima rapida, anche dal telefono.'],
          ['Intermedio', 'Aggiunge la colonna Preventivo per il confronto con l’offerta, gli altri costi diretti (trasferte, noleggi, subappalti) e le spese generali.'],
          ['Completo', 'Righe per marca fornitore e tipo di manodopera, con tariffe orarie. È il livello per il budget esecutivo.'],
        ]),
        h('p', { class: 'nota' }, 'Scendere di livello non cancella niente: nasconde soltanto. Una categoria con più voci compare come somma non modificabile finché non torni al livello Completo.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Tre modi di simulare' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Nella scheda Simulazione puoi partire da qualunque delle tre grandezze, a seconda della domanda che ti stai facendo. Non sono modalità che si escludono: agiscono tutte sugli stessi cursori.'),
        vociGuida([
          ['Dai costi', 'Scrivi il costo che ti aspetti nella colonna Simulato, oppure muovi i cursori per servizio o per categoria. È la domanda "se sforo, cosa succede".'],
          ['Dai ricavi', 'Muovi i cursori dei ricavi per simulare uno sconto in trattativa o una variante riconosciuta. È la domanda "quanto posso concedere".'],
          ['Dal margine', 'Scrivi il margine che vuoi ottenere e scegli se agire sui costi o sui ricavi: lo strumento calcola lo scostamento necessario e te lo mostra prima di applicarlo. È la domanda "cosa servirebbe per arrivarci".'],
        ]),
        h('p', { class: 'nota' }, 'Il calcolo che parte dal margine non dà una risposta chiusa: produce uno scostamento normale, che finisce nei cursori e da lì si ritocca, si distribuisce su un singolo servizio o si annulla.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Come vedere da dove arriva un numero' }),
      h('div', { class: 'corpo' },
        h('p', {}, suTouch
          ? 'Tocca una cella calcolata (quelle con il bordino tratteggiato sotto) e compare il calcolo che l’ha prodotta: listino meno sconto, ore per tariffa, ricavo meno costi, e quali scostamenti sono stati applicati.'
          : 'Clicca una cella calcolata, quelle con il bordino tratteggiato sotto, e compare il calcolo che l’ha prodotta. Fermando il puntatore sopra, lo stesso testo appare come suggerimento del browser.'),
        h('p', { class: 'nota' }, 'Sul telefono non esiste il passaggio del dito sopra una cella: il browser non ha un evento di hover sul touch, quindi la spiegazione si apre al tocco. Si chiude toccando fuori, o con Esc da tastiera.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Leggere il confronto senza sbagliare' }),
      h('div', { class: 'corpo' },
        vociGuida([
          ['Margine di contribuzione', 'Ricavo meno costi diretti della commessa: materiale, manodopera, trasferte, subappalti. È la leva che il PM controlla.'],
          ['Costi di struttura', 'Quota dei costi aziendali che non sono imputati a nessuna commessa — direzione, amministrazione, acquisti, immobili, mezzi — attribuita a questa commessa in proporzione ai suoi costi diretti. La percentuale la dà il controllo di gestione. A zero sparisce da tutte le tabelle.'],
          ['Riserva per imprevisti', 'Accantonamento sui costi per rischi non ancora emersi: varianti, rilavorazioni, fermi. Non è un costo già sostenuto. A zero sparisce.'],
          ['Margine industriale', 'Margine di contribuzione meno costi di struttura e riserva. È quello che si confronta con il budget aziendale. Se entrambi sono a zero coincide con il margine di contribuzione, e infatti non viene mostrato.'],
          ['Variazione assoluta', 'Quanti euro di margine si sono persi o guadagnati.'],
          ['Punti percentuali (p.p.)', 'Differenza fra due percentuali. Da 18% a 14% sono meno 4 punti percentuali.'],
          ['Variazione relativa', 'Quanta parte del margine si è bruciata. Da 18% a 14% è meno 25,3%: stesso fatto, numero diverso. Confonderla con i punti percentuali è l’errore più comune.'],
          ['Effetto ricavo ed effetto costo', 'Da dove nasce lo scostamento: una concessione di prezzo o un costo che è cresciuto. Sommati danno la variazione totale.'],
          ['Verde e rosso', 'Una regola sola in tutto lo strumento: verde quando il margine ci guadagna, rosso quando ci perde. Su un costo vuol dire scendere, su ricavo e margine salire. Il colore non è mai l\u2019unico segnale: c\u2019è sempre il segno davanti al numero, e sui valori assoluti anche una freccia.'],
        ]),
        h('p', {}, 'Nel pannello Incidenza puoi scegliere il riferimento, e le due letture non sono intercambiabili: sui costi diretti descrive la composizione del costo e ',
          h('b', { testo: 'non si muove' }),
          ' se aumenti tutte le voci nella stessa misura; sul ricavo descrive quanta parte della commessa se ne va in quella voce e si muove sempre.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Dal telefono' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Tutte le schede funzionano a larghezza telefono. Nella scheda Confronto le tabelle si ricompongono in blocchi verticali: ogni riga diventa un piccolo riquadro con la sua etichetta accanto al numero, quindi non serve scorrere di lato per leggere una cifra.'),
        vociGuida([
          ['Su iPhone e iPad', 'Funziona tutto tranne il collegamento a una cartella di rete: Safari non espone il selettore di cartelle, e su iOS tutti i browser usano lo stesso motore, quindi il limite vale anche per Chrome ed Edge sul telefono. Dal telefono l’archivio resta nella memoria del browser, oppure usi Apri e salva file.'],
          ['Consiglio d’uso', 'Il telefono è comodo per il livello Base e per rivedere il confronto. Il budget esecutivo al livello Completo si compila meglio da computer.'],
          ['Archivio condiviso', 'La cartella di rete richiede Chrome o Edge su computer. È l’unico modo per avere un archivio che sopravvive alla pulizia del browser e che altri PM possono vedere.'],
        ]),
        cartella
          ? h('p', { class: 'nota', testo: 'Su questo dispositivo il collegamento a una cartella è disponibile.' })
          : h('p', { class: 'nota', testo: 'Su questo dispositivo il collegamento a una cartella non è disponibile: usa Scarica e Apri file, oppure la memoria del browser.' }))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Prima di usarlo sul serio' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Se inserisci la manodopera in ore, le tariffe orarie devono essere il costo orario aziendale pieno, non il prezzo di vendita. Finché restano a zero, il margine delle righe in ore non ha significato. Le imposti nel livello Completo, nel pannello Parametri.'),
        h('p', { class: 'nota' }, 'In alternativa, al livello Base la manodopera si inserisce direttamente in euro: nessuna tariffa da impostare, nessuno zero nascosto.'))),

    h('section', { class: 'pannello' },
      h('h2', { testo: 'Cosa non fa' }),
      h('div', { class: 'corpo' },
        h('p', {}, 'Niente consuntivazione ore, niente avanzamento lavori, niente storico da aggiornare, nessuna approvazione, nessun collegamento al gestionale. È voluto: serve a ragionare in fretta su uno scenario, non a sostituire il controllo di gestione.'))));
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
  const s = sensitivita(sim, 10, livelloSensitivita);
  const righe = s.righe.slice(0, 10).filter((r) => r.ampiezza > 0);
  if (righe.length === 0) {
    c.appendChild(h('p', { class: 'nota', testo: 'Inserisci dei costi per vedere dove conviene intervenire.' }));
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
  nodi.push(testoSvg(cx, A - 6, 'a sinistra il guadagno da una riduzione del 10%, a destra la perdita da un aumento', { 'text-anchor': 'middle', 'font-size': 9.5 }));
  c.appendChild(h('div', { class: 'tabellone' },
    svg('svg', { viewBox: `0 0 ${L} ${A}`, width: '100%', role: 'img', 'aria-label': 'Sensitività del margine ai driver di costo' }, ...nodi)));
}

// --- aggiornamento dei valori derivati ---------------------------------------------


// Spiegazione del calcolo dietro ogni cella derivata, indicizzata per chiave di uscita.
const spiegazioni = new Map();

/**
 * Regola unica del colore: verde quando il margine ne guadagna, rosso quando ci perde.
 * Su un costo questo vuol dire scendere, su ricavo e margine salire. Senza una regola
 * sola, due rossi nella stessa schermata finirebbero per significare cose opposte.
 *
 * Il colore non è mai l'unico segnale: accanto c'è sempre il segno, e dove il numero è
 * assoluto anche una freccia. Circa un uomo su dodici non distingue rosso e verde.
 */
function versoScostamento(valore, partenza, piuEMeglio) {
  if (!(Math.abs(partenza) > 1e-9)) return { nullo: true };
  const scarto = valore - partenza;
  if (Math.abs(scarto) < 0.005) return { nullo: true, scarto: 0 };
  const bene = piuEMeglio ? scarto > 0 : scarto < 0;
  return { nullo: false, scarto, bene, classe: bene ? 'v-buono' : 'v-critico' };
}

/** Freccia accanto a un valore assoluto, perché la direzione si veda anche senza colore. */
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
    freccia.textContent = verso.scarto > 0 ? '\u25b2' : '\u25bc';
    freccia.className = 'direzione ' + verso.classe;
    freccia.setAttribute('title', `${verso.scarto > 0 ? 'più' : 'meno'} ${euro(Math.abs(verso.scarto))} rispetto al valore di partenza`);
  }
}

function scrivi(sel, testo, classe, spiegazione, grezzo) {
  if (spiegazione !== undefined && spiegazione !== null) spiegazioni.set(sel, spiegazione);
  for (const n of $$(`[data-out="${sel}"]`)) {
    if (n.tagName === 'INPUT') {
      // Non si riscrive il campo mentre ci si sta digitando dentro.
      if (document.activeElement !== n && grezzo !== undefined) n.value = grezzo ? numero(grezzo) : '';
      n.classList.remove('v-buono', 'v-critico');
      if (classe) n.classList.add(classe);
      const s2 = spiegazioni.get(sel);
      if (s2) n.setAttribute('title', s2);
      continue;
    }
    n.textContent = testo;
    n.classList.remove('v-buono', 'v-critico');
    if (classe) n.classList.add(classe);
    const s = spiegazioni.get(sel);
    if (s) {
      n.classList.add('spiegabile');
      n.setAttribute('title', s);
      n.setAttribute('tabindex', '0');
      n.setAttribute('role', 'button');
    }
  }
}

/**
 * Mostra come è stato ottenuto un numero. Sul telefono non esiste il passaggio del dito
 * sopra una cella: il browser non ha un evento di hover sul touch, e il primo tocco su un
 * elemento con stile hover lo attiva soltanto. Quindi la funzione è costruita sul tocco,
 * e sul desktop resta disponibile anche come suggerimento del browser.
 */
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
  const et = cella.getAttribute('data-et') || cella.closest('tr')?.firstElementChild?.textContent?.trim() || '';
  p.textContent = '';
  p.appendChild(h('div', { class: 'titolo-spiega' },
    h('span', { testo: et ? et + ' \u00b7 ' + cella.textContent.trim() : cella.textContent.trim() }),
    h('button', { class: 'muto', 'aria-label': 'Chiudi', testo: '\u00d7', onclick: chiudiSpiegazione })));
  p.appendChild(h('div', { class: 'corpo-spiega', testo }));
  p.hidden = false;
}

function collegaSpiegazioni() {
  document.addEventListener('click', (e) => {
    const t2 = e.target;
    if (!t2 || !t2.closest) return;
    if (t2.closest('#spiegazione')) return;
    const cella = t2.closest('[data-out].spiegabile');
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

function formatta(v, formato) {
  if (formato === 'perc') return perc(v);
  if (formato === 'punti') return punti(v);
  if (formato === 'rel') return percRel(v);
  return euro(v);
}


const pctTesto = (v) => (Number(v) || 0).toFixed(Number.isInteger(Number(v)) ? 0 : 1).replace('.', ',') + '%';

/** Testo che spiega come nasce il costo di una voce nella colonna indicata. */
function spiegaVoce(voce, colonna, costo) {
  const d = voce[colonna] || {};
  if (voce.cat === 'manodopera') {
    if (modoManodopera(voce) === 'importo') return `Importo inserito: ${euro(costo)}.`;
    const tr = sim.tariffe.find((x) => x.id === voce.tariffaId);
    if (!tr || !tr.eurOra) {
      return `${numero(d.q)} h senza tariffa oraria impostata, quindi ${euro(0)}. Imposta la tariffa nel livello Completo.`;
    }
    return `${numero(d.q)} h \u00d7 ${numero(tr.eurOra)} \u20ac/h (${tr.nome}) = ${euro(costo)}.`;
  }
  if (voce.cat === 'materiale' && Number(d.sconto)) {
    return `Listino ${euro(d.q)} meno sconto ${pctTesto(d.sconto)} = ${euro(costo)}.`;
  }
  return `Importo inserito: ${euro(costo)}.`;
}

function spiegaFattore(linea, voce) {
  const dd = sim.delta || {};
  const pezzi = [];
  const aggiungi = (v, et) => { if (Number(v)) pezzi.push(`${et} ${Number(v) > 0 ? '+' : ''}${pctTesto(v)}`); };
  aggiungi(dd.globale, 'tutti i costi');
  aggiungi((dd.linea || {})[linea.id], linea.nome);
  aggiungi((dd.catLinea || {})[linea.id + '|' + voce.cat], ETICHETTA_CATEGORIA[voce.cat]);
  aggiungi((dd.voce || {})[voce.id], voce.nome || 'voce');
  return pezzi;
}

function aggiornaDerivati() {
  const r = calcola(sim);
  const target = (sim.parametri.targetPct || 0) / 100;
  const sg = sim.parametri.sgPct || 0;
  const ctg = sim.parametri.ctgPct || 0;

  for (const c of COLONNE) {
    const col = r.colonne[c];
    const et = ETICHETTA_COLONNA[c];
    for (const [k, v] of Object.entries(col)) {
      if (typeof v === 'number' || v === null) {
        scrivi(`tot:${c}:${k}:euro`, formatta(v, 'euro'));
        scrivi(`tot:${c}:${k}:perc`, formatta(v, 'perc'));
      }
    }
    scrivi(`tot:${c}:mdc:euro`, formatta(col.mdc, 'euro'), null,
      `${et}: ricavo ${euro(col.ricavo)} meno costi diretti ${euro(col.cd)} = ${euro(col.mdc)}.`);
    scrivi(`tot:${c}:mdcPct:perc`, formatta(col.mdcPct, 'perc'), null,
      `${euro(col.mdc)} diviso ricavo ${euro(col.ricavo)} = ${perc(col.mdcPct)}.`);
    scrivi(`tot:${c}:speseGenerali:euro`, formatta(col.speseGenerali, 'euro'), null,
      `Quota dei costi aziendali non imputati a commessa, attribuita a questa in proporzione ai suoi costi diretti: ${euro(col.cd)} \u00d7 ${pctTesto(sg)} = ${euro(col.speseGenerali)}.`);
    scrivi(`tot:${c}:contingency:euro`, formatta(col.contingency, 'euro'), null,
      `Accantonamento per rischi non ancora emersi: costi diretti ${euro(col.cd)} \u00d7 ${pctTesto(ctg)} = ${euro(col.contingency)}.`);
    scrivi(`tot:${c}:mi:euro`, formatta(col.mi, 'euro'), null,
      `${euro(col.ricavo)} meno costi diretti ${euro(col.cd)} meno costi di struttura ${euro(col.speseGenerali)} meno riserva per imprevisti ${euro(col.contingency)} = ${euro(col.mi)}.`);
    scrivi(`tot:${c}:miPct:perc`, formatta(col.miPct, 'perc'), null,
      `${euro(col.mi)} diviso ricavo ${euro(col.ricavo)} = ${perc(col.miPct)}.`);
    scrivi(`tot:${c}:cd:euro`, formatta(col.cd, 'euro'), null,
      `Somma dei costi diretti delle ${col.linee.length} linee di servizio: ${euro(col.cd)}.`);

    for (const l of col.linee) {
      scrivi(`cdcol:${l.id}:${c}`, euro(l.cd), null,
        CATEGORIE.map((cat) => `${ETICHETTA_CATEGORIA[cat]} ${euro(l.perCategoria[cat] || 0)}`).join(' + ') + ` = ${euro(l.cd)}.`);
      scrivi(`mdclinea:${l.id}:${c}`, `${euro(l.mdc)}  \u00b7  ${perc(l.mdcPct)}`, null,
        `${l.nome}, ${et}: ricavo ${euro(l.ricavo)} meno costi ${euro(l.cd)} = ${euro(l.mdc)}, pari al ${perc(l.mdcPct)} del ricavo di linea.`);
      for (const cat of CATEGORIE) {
        scrivi(`catcol:${l.id}:${cat}:${c}`, euro(l.perCategoria[cat]), null,
          `Somma delle voci di ${ETICHETTA_CATEGORIA[cat]} in ${l.nome}, colonna ${et}: ${euro(l.perCategoria[cat])}.`);
      }
    }
  }

  const s = r.colonne.simulato;
  const baseEt = ETICHETTA_COLONNA[r.baseSimulazione];
  for (const linea of sim.linee) {
    const l = s.linee.find((x) => x.id === linea.id);
    if (!l) continue;
    const dRic = [];
    if (Number((sim.delta || {}).ricavo)) dRic.push(`tutti i ricavi ${pctTesto(sim.delta.ricavo)}`);
    if (Number(((sim.delta || {}).ricavoLinea || {})[linea.id])) dRic.push(`${linea.nome} ${pctTesto(sim.delta.ricavoLinea[linea.id])}`);
    scrivi('ricavo:' + linea.id, euro(l.ricavo), null,
      `Ricavo ${baseEt} ${euro(linea.ricavo[r.baseSimulazione])}`
      + (dRic.length ? `, con gli scostamenti ${dRic.join(' e ')}` : ', nessuno scostamento sui ricavi')
      + ` = ${euro(l.ricavo)}.`, l.ricavo);
    const versoRicavo = versoScostamento(l.ricavo, num(linea.ricavo[r.baseSimulazione]), true);
    scrivi('ricavo:' + linea.id, euro(l.ricavo), versoRicavo.classe || null, undefined, l.ricavo);
    segnalaDirezione('ricavo:' + linea.id, versoRicavo);

    for (const cat of CATEGORIE) {
      const n = linea.voci.filter((v) => v.cat === cat).length;
      scrivi(`cat:${linea.id}:${cat}`, euro(l.perCategoria[cat]), null,
        `Somma di ${n} ${n === 1 ? 'voce' : 'voci'} di ${ETICHETTA_CATEGORIA[cat]} nella colonna Simulato: ${euro(l.perCategoria[cat])}.`);
    }

    for (const voce of linea.voci) {
      const costo = l.voci[voce.id] || 0;
      const baseCosto = r.colonne[r.baseSimulazione].linee.find((x) => x.id === linea.id)?.voci[voce.id] || 0;
      const fattori = spiegaFattore(linea, voce);
      const parti = [`Base ${baseEt}: ` + spiegaVoce(voce, r.baseSimulazione, baseCosto)];
      parti.push(fattori.length
        ? `Scostamenti applicati: ${fattori.join(', ')}. Risultato simulato ${euro(costo)}.`
        : 'Nessuno scostamento applicato a questa voce.');
      const verso = versoScostamento(costo, baseCosto, false);
      scrivi('voce:' + voce.id, euro(costo), verso.classe || null, parti.join(' '), costo);
      segnalaDirezione('voce:' + voce.id, verso);
    }
  }

  const kom = r.colonne.kom;
  for (const l of kom.linee) {
    for (const cat of CATEGORIE) {
      const base = l.perCategoria[cat];
      const simCat = s.linee.find((x) => x.id === l.id)?.perCategoria[cat] ?? 0;
      const v = versoScostamento(simCat, base, false);
      scrivi(`catsim:${l.id}:${cat}`, base ? euroSegnato(simCat - base) : '\u2014', v.classe || null);
    }
  }

  for (const [chiave, g] of [['gapPreventivoKom', r.gapPreventivoKom], ['gapKomSimulato', r.gapKomSimulato]]) {
    const da = ETICHETTA_COLONNA[g.da];
    const a = ETICHETTA_COLONNA[g.a];
    const spiega = {
      dMdc: `Margine di contribuzione ${a} meno ${da}: ${euro(r.colonne[g.a].mdc)} meno ${euro(r.colonne[g.da].mdc)} = ${euroSegnato(g.dMdc)}.`,
      dMi: `Margine industriale ${a} meno ${da}: ${euroSegnato(g.dMi)}.`,
      dMdcPp: `Marginalità ${a} ${perc(r.colonne[g.a].mdcPct)} meno marginalità ${da} ${perc(r.colonne[g.da].mdcPct)} = ${punti(g.dMdcPp)}. È una differenza fra due percentuali, quindi si misura in punti percentuali.`,
      dMiPp: `Margine industriale ${a} ${perc(r.colonne[g.a].miPct)} meno ${da} ${perc(r.colonne[g.da].miPct)} = ${punti(g.dMiPp)}.`,
      dMdcRel: `Quanta parte del margine di ${da} si è persa: ${euroSegnato(g.dMdc)} diviso ${euro(r.colonne[g.da].mdc)} = ${percRel(g.dMdcRel)}. Non confonderla con i punti percentuali.`,
      dMiRel: `Variazione relativa del margine industriale rispetto a ${da}: ${percRel(g.dMiRel)}.`,
      effettoRicavo: `Ricavo ${a} ${euro(r.colonne[g.a].ricavo)} meno ricavo ${da} ${euro(r.colonne[g.da].ricavo)} = ${euroSegnato(g.effettoRicavo)}. È la parte di scostamento dovuta al prezzo, non ai costi.`,
      effettoCosto: `Costi ${da} ${euro(r.colonne[g.da].cd)} meno costi ${a} ${euro(r.colonne[g.a].cd)} = ${euroSegnato(g.effettoCosto)}. Sommato all'effetto ricavo dà ${euroSegnato(g.dMdc)}.`,
    };
    for (const [k, formato] of [['dMdc', 'euro'], ['dMi', 'euro'], ['dMdcPp', 'punti'], ['dMiPp', 'punti'], ['dMdcRel', 'rel'], ['dMiRel', 'rel'], ['effettoRicavo', 'euro'], ['effettoCosto', 'euro']]) {
      const v = g[k];
      scrivi(`gap:${chiave}:${k}:${formato}`, formatta(v, formato),
        v === null ? null : (v >= 0 ? 'v-buono' : 'v-critico'), spiega[k]);
    }
    const tb = $(`[data-lista="perlinea:${chiave}"]`);
    if (tb) {
      tb.textContent = '';
      for (const l of g.perLinea) {
        tb.appendChild(h('tr', {},
          h('td', { 'data-et': 'Servizio', testo: l.nome }),
          h('td', { class: 'n ' + (l.effettoRicavo >= 0 ? 'v-buono' : 'v-critico'), 'data-et': 'Effetto ricavo', testo: euroSegnato(l.effettoRicavo) }),
          ...CATEGORIE.map((c) => h('td', { class: 'n ' + (l.perCategoria[c] >= 0 ? 'v-buono' : 'v-critico'), 'data-et': ETICHETTA_CATEGORIA[c], testo: euroSegnato(l.perCategoria[c]) })),
          h('td', { class: 'n', 'data-et': 'Totale', style: 'font-weight:600', testo: euroSegnato(l.dMdc) })));
      }
    }
  }

  const corpoInc = $('[data-lista="incidenze"]');
  if (corpoInc) {
    corpoInc.textContent = '';
    const { righe } = incidenze(sim, r, riferimentoIncidenza);
    const denomEt = riferimentoIncidenza === 'ricavo' ? 'ricavo' : 'costi diretti';
    for (const riga of righe) {
      const classeRiga = riga.tipo === 'totale' ? 'riga-totale' : riga.tipo === 'margine' ? 'riga-margine' : '';
      const cellaDelta = (v, et) => {
        if (v === null || !Number.isFinite(v)) return h('td', { class: 'n', 'data-et': et, testo: 'n.d.' });
        if (Math.abs(v) < 0.05) return h('td', { class: 'n fermo', 'data-et': et, testo: 'invariata' });
        const bene = riga.tipo === 'margine' ? v > 0 : v < 0;
        return h('td', { class: 'n ' + (bene ? 'v-buono' : 'v-critico'), 'data-et': et, testo: punti(v) });
      };
      corpoInc.appendChild(h('tr', classeRiga ? { class: classeRiga } : {},
        h('td', { class: 'liv' + riga.livello, 'data-et': 'Voce', testo: riga.nome }),
        ...COLONNE.map((c) => h('td', {
          class: 'n', 'data-et': ETICHETTA_COLONNA[c],
          title: `Peso di "${riga.nome}" sui ${denomEt} della colonna ${ETICHETTA_COLONNA[c]}.`,
          testo: perc(riga.valori[c]),
        })),
        cellaDelta(riga.dPreventivoKom, 'Prev \u2192 KOM'),
        cellaDelta(riga.dKomSimulato, 'KOM \u2192 Sim')));
    }
  }

  const rif = r.colonne[r.baseSimulazione];
  const etRif = ETICHETTA_COLONNA[r.baseSimulazione];
  const cls = (valore, partenza, piuEMeglio) => versoScostamento(valore, partenza, piuEMeglio).classe || null;
  scrivi('barra:ricavo', euro(s.ricavo), cls(s.ricavo, rif.ricavo, true));
  scrivi('barra:costi', euro(s.cd), cls(s.cd, rif.cd, false));
  scrivi('barra:mdc', euro(s.mdc), cls(s.mdc, rif.mdc, true),
    `Ricavo ${euro(s.ricavo)} meno costi diretti ${euro(s.cd)} = ${euro(s.mdc)}. Rispetto a ${etRif}: ${euroSegnato(s.mdc - rif.mdc)}.`);
  for (const c of COLONNE) {
    scrivi(`barra:mdcpct:${c}`, perc(r.colonne[c].mdcPct),
      c === 'simulato' ? cls(s.mdcPct, rif.mdcPct, true) : null);
  }
  scrivi('barra:mi', euro(s.mi), cls(s.mi, rif.mi, true));

  const colBase = r.colonne[r.baseSimulazione];
  scrivi('cmp:intestazione', ETICHETTA_COLONNA[r.baseSimulazione]);
  for (const [k, formato] of [['ricavo', 'euro'], ['cd', 'euro'], ['mdc', 'euro'], ['mdcPct', 'perc'], ['mi', 'euro'], ['miPct', 'perc']]) {
    scrivi(`cmp:${k}:base:${formato}`, formatta(colBase[k], formato));
    scrivi(`cmp:${k}:sim:${formato}`, formatta(s[k], formato));
    if (formato === 'perc') {
      const pp = (colBase[k] === null || s[k] === null) ? null : (s[k] - colBase[k]) * 100;
      scrivi(`cmp:${k}:delta:${formato}`, punti(pp), pp === null ? null : (pp >= 0 ? 'v-buono' : 'v-critico'));
    } else {
      const d = s[k] - colBase[k];
      const positivo = k === 'cd' ? d <= 0 : d >= 0;
      scrivi(`cmp:${k}:delta:${formato}`, euroSegnato(d), positivo ? 'v-buono' : 'v-critico');
    }
  }
  const esito = $('#esito-margine');
  if (esito) {
    const voluto = margineVoluto === null ? (sim.parametri.targetPct || 0) : margineVoluto;
    const res = scostamentoPerMargine(sim, voluto, levaMargine);
    esito.className = 'esito-margine';
    if (!res.possibile) {
      esito.textContent = res.motivo;
      esito.classList.add('esito-nulla');
    } else if (res.negativo) {
      esito.textContent = `Con questi ricavi il ${perc(voluto / 100)} non è raggiungibile agendo sui costi: servirebbero costi negativi. Prova con i ricavi.`;
      esito.classList.add('esito-nulla');
    } else {
      const su = res.leva === 'costi' ? 'tutti i costi' : 'tutti i ricavi';
      esito.textContent = `Per arrivare al ${perc(voluto / 100)} serve ${percRel(res.deltaPct)} su ${su}: `
        + `da ${euro(res.attuale)} a ${euro(res.richiesto)}, ${euroSegnato(res.variazione)}.`;
      esito.classList.add(res.deltaPct === 0 ? 'esito-nulla' : (res.leva === 'costi' ? (res.deltaPct < 0 ? 'esito-sforzo' : 'esito-agio') : (res.deltaPct > 0 ? 'esito-sforzo' : 'esito-agio')));
    }
  }

  const nb = $('#base-simulazione');
  if (nb) {
    nb.textContent = r.baseSimulazione === 'kom'
      ? 'La simulazione parte dalla colonna KOM. Gli scostamenti non modificano il KOM: creano una terza colonna.'
      : 'La colonna KOM è ancora vuota, quindi la simulazione parte dal Preventivo. Compilando il KOM la base passa automaticamente a quello.';
  }

  const pil = $('#semaforo');
  if (pil) {
    pil.className = 'pillola ' + classeMargine(s.miPct, target);
    const nome = usaStruttura() ? 'Margine industriale' : 'Margine';
    pil.textContent = nome + ' simulato ' + perc(s.miPct) + (target > 0 ? ' \u00b7 obiettivo ' + perc(target) : '');
  }

  scrivi('tot:simulato:cdMax:euro', euro(s.cdMax), null,
    `Ricavo ${euro(s.ricavo)} \u00d7 (100% meno obiettivo ${perc(target)}) diviso (1 + costi di struttura ${pctTesto(sg)} + riserva ${pctTesto(ctg)}) = ${euro(s.cdMax)}.`);
  scrivi('tot:simulato:riserva:euro', euro(s.riserva), null,
    `Costo massimo ammissibile ${euro(s.cdMax)} meno costi simulati ${euro(s.cd)} = ${euro(s.riserva)}.`);
  scrivi('tot:simulato:riservaPct:perc', perc(s.riservaPct), null,
    `${euro(s.riserva)} diviso costi simulati ${euro(s.cd)} = ${perc(s.riservaPct)}.`);

  const lettura = $('#lettura-riserva');
  if (lettura) {
    if (!(s.ricavo > 0)) lettura.textContent = 'Inserisci i ricavi dei servizi per calcolare la riserva.';
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
  ['guida', 'Guida'],
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
  main.insertBefore(pannello, main.firstChild || null);
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
  righe.push(['Servizio', 'Categoria', 'Voce', 'Preventivo', 'KOM', 'Simulato']);
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
    contenuto = scheda === 'dati' ? schedaDati()
      : scheda === 'simulazione' ? schedaSimulazione()
        : scheda === 'confronto' ? schedaConfronto()
          : scheda === 'guida' ? schedaGuida()
            : schedaArchivio();
  } catch (e) {
    // Meglio una schermata che spiega il problema di una pagina bianca: i dati inseriti
    // restano in memoria e le altre schede continuano a funzionare.
    contenuto = h('div', { class: 'avviso' },
      h('span', {}, 'Questa scheda non si è potuta aprire: ' + (e && e.message ? e.message : 'errore sconosciuto')
        + '. Le altre schede e i dati inseriti non sono stati toccati.'));
  }

  const main = h('main', {}, contenuto);

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
  const metrica = (et, chiave, classe = '') => h('div', { class: 'metrica ' + classe },
    h('div', { class: 'et', testo: et }),
    h('div', { class: 'val', 'data-out': chiave, testo: '\u2014' }));

  // Su schermo stretto restano solo semaforo, margine e marginalità simulata: le altre
  // metriche sono marcate secondarie e si nascondono, altrimenti la barra mangia lo schermo.
  return h('footer', { class: 'barra' },
    h('span', { class: 'pillola p-neutro', id: 'semaforo', testo: '\u2014' }),
    metrica('Ricavo simulato', 'barra:ricavo', 'secondaria'),
    metrica('Costi diretti', 'barra:costi', 'secondaria'),
    metrica('MdC simulato', 'barra:mdc', 'forte'),
    metrica('Marginalità prev.', 'barra:mdcpct:preventivo', 'secondaria'),
    metrica('Marginalità KOM', 'barra:mdcpct:kom', 'secondaria'),
    metrica('Marginalità sim.', 'barra:mdcpct:simulato', 'forte'));
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
  collegaSpiegazioni();
  document.body.appendChild(datalist());

  const bozza = leggiBozza();
  const bozzaUtile = bozza && (bozza.meta.codice || bozza.linee.some((l) => l.voci.some((v) => v.kom.q || v.preventivo.q)));
  sim = bozzaUtile ? bozza : simulazioneEsempio();

  disegna();
  ripristinaCartella().then(() => ricaricaArchivio());
}
