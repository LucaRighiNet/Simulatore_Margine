// Persistenza dell'archivio delle simulazioni.
//
// Tre livelli, in ordine di robustezza:
//   1. cartella di rete scelta dall'utente (File System Access API, Chrome ed Edge)
//   2. memoria del browser, come ripiego dichiarato all'utente
//   3. file singolo scaricato o aperto a mano, sempre disponibile
//
// La memoria del browser non è un archivio: è agganciata al browser e al percorso della
// pagina, e sparisce con la pulizia dei dati di navigazione. L'interfaccia lo dice.

import { normalizza, nomeFile } from './modello.mjs';

const CHIAVE_ARCHIVIO = 'sm.archivio.v1';
const CHIAVE_BOZZA = 'sm.bozza.v1';
const DB = 'simulatore-margine';
const STORE = 'handle';

export function supportaCartella() {
  return typeof globalThis.showDirectoryPicker === 'function';
}

/** I download partono solo se la pagina non è in un contenitore che li blocca. */
export function supportaDownload() {
  try {
    const a = document.createElement('a');
    return typeof a.download === 'string' && typeof URL.createObjectURL === 'function';
  } catch { return false; }
}

function conMemoria(fn, ripiego = null) {
  try { return fn(); } catch { return ripiego; }
}

// --- memoria del browser -----------------------------------------------------------

function leggiMappa() {
  return conMemoria(() => JSON.parse(localStorage.getItem(CHIAVE_ARCHIVIO) || '{}'), {}) || {};
}
function scriviMappa(m) {
  return conMemoria(() => { localStorage.setItem(CHIAVE_ARCHIVIO, JSON.stringify(m)); return true; }, false);
}

export function salvaBozza(sim) {
  conMemoria(() => localStorage.setItem(CHIAVE_BOZZA, JSON.stringify(sim)));
}
export function leggiBozza() {
  const raw = conMemoria(() => localStorage.getItem(CHIAVE_BOZZA), null);
  if (!raw) return null;
  try { return normalizza(JSON.parse(raw)); } catch { return null; }
}
export function scartaBozza() {
  conMemoria(() => localStorage.removeItem(CHIAVE_BOZZA));
}

// --- cartella ----------------------------------------------------------------------

function apriDb() {
  return new Promise((ris, rif) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ris(r.result);
    r.onerror = () => rif(r.error);
  });
}

async function scriviHandle(h) {
  const db = await apriDb();
  return new Promise((ris, rif) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(h, 'cartella');
    tx.oncomplete = () => ris(true);
    tx.onerror = () => rif(tx.error);
  });
}

async function leggiHandle() {
  const db = await apriDb();
  return new Promise((ris) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get('cartella');
    r.onsuccess = () => ris(r.result || null);
    r.onerror = () => ris(null);
  });
}

let cartella = null;

export function cartellaAttiva() { return cartella; }

/** Ricollega la cartella già scelta, se il permesso è ancora concesso senza chiedere nulla. */
export async function ripristinaCartella() {
  if (!supportaCartella()) return null;
  const h = await conMemoria(() => leggiHandle(), null);
  if (!h) return null;
  try {
    const stato = await h.queryPermission({ mode: 'readwrite' });
    if (stato === 'granted') { cartella = h; return h; }
  } catch { /* handle non più valido */ }
  return null;
}

export async function scegliCartella() {
  const h = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: 'archivio-margine' });
  const stato = await h.requestPermission({ mode: 'readwrite' });
  if (stato !== 'granted') throw new Error('Permesso di scrittura non concesso sulla cartella.');
  cartella = h;
  await conMemoria(() => scriviHandle(h));
  return h;
}

export function staccaCartella() { cartella = null; }

// --- API unica dell'archivio -------------------------------------------------------

export function modo() { return cartella ? 'cartella' : 'browser'; }

function sintesi(nome, sim) {
  return {
    nome,
    codice: sim.meta?.codice || '(senza codice)',
    cliente: sim.meta?.cliente || '',
    data: sim.meta?.data || '',
    descrizione: sim.meta?.descrizione || '',
    sim,
  };
}

export async function elenca() {
  if (cartella) {
    const voci = [];
    for await (const [nome, h] of cartella.entries()) {
      if (!nome.toLowerCase().endsWith('.json') || h.kind !== 'file') continue;
      try {
        const testo = await (await h.getFile()).text();
        voci.push(sintesi(nome, normalizza(JSON.parse(testo))));
      } catch { /* file non leggibile: si ignora senza interrompere l'elenco */ }
    }
    return voci.sort((a, b) => b.nome.localeCompare(a.nome));
  }
  const m = leggiMappa();
  return Object.entries(m)
    .map(([nome, sim]) => sintesi(nome, normalizza(sim)))
    .sort((a, b) => b.nome.localeCompare(a.nome));
}

export async function salva(sim) {
  const nome = nomeFile(sim);
  const testo = JSON.stringify(sim, null, 2);
  if (cartella) {
    const h = await cartella.getFileHandle(nome, { create: true });
    const w = await h.createWritable();
    await w.write(testo);
    await w.close();
    return { nome, modo: 'cartella' };
  }
  const m = leggiMappa();
  m[nome] = sim;
  if (!scriviMappa(m)) throw new Error('La memoria del browser non è disponibile o è piena.');
  return { nome, modo: 'browser' };
}

export async function elimina(nome) {
  if (cartella) { await cartella.removeEntry(nome); return; }
  const m = leggiMappa();
  delete m[nome];
  scriviMappa(m);
}

// --- file singolo ------------------------------------------------------------------

export function testoDi(sim) { return JSON.stringify(sim, null, 2); }

export function scarica(sim) {
  const testo = testoDi(sim);
  const blob = new Blob([testo], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFile(sim);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function apriFile() {
  return new Promise((ris, rif) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return rif(new Error('Nessun file selezionato.'));
      const fr = new FileReader();
      fr.onload = () => {
        try { ris(normalizza(JSON.parse(String(fr.result)))); }
        catch { rif(new Error('Il file non contiene una simulazione valida.')); }
      };
      fr.onerror = () => rif(new Error('Lettura del file non riuscita.'));
      fr.readAsText(f);
    };
    inp.click();
  });
}
