// Analisi del grafo delle attivita' di sviluppo (CPM, Critical Path Method).
// Grafo orientato aciclico: nodo = attivita', arco = vincolo di precedenza.
// Calcola ordinamento topologico, passata in avanti, passata all'indietro,
// scorrimento (slack) e cammino critico.

export const ATTIVITA = [
  { id: 'A1', nome: 'Struttura repo, README, scaffolding',            d: 0.25, dep: [] },
  { id: 'A2', nome: 'Modello dati e schema JSON della simulazione',   d: 0.50, dep: ['A1'] },
  { id: 'B1', nome: 'Motore: costo per voce e normalizzazione',       d: 0.50, dep: ['A2'] },
  { id: 'B2', nome: 'Motore: aggregazioni, MdC, MI, break-even',      d: 0.50, dep: ['B1'] },
  { id: 'B3', nome: 'Motore: scostamenti componibili (simulato)',     d: 0.25, dep: ['B2'] },
  { id: 'B4', nome: 'Motore: gap, punti percentuali, scomposizione',  d: 0.50, dep: ['B2'] },
  { id: 'B5', nome: 'Test unitari del motore',                        d: 0.50, dep: ['B3', 'B4'] },
  { id: 'C1', nome: 'Stile e impianto della maschera',                d: 0.50, dep: ['A1'] },
  { id: 'C2', nome: 'Editor righe: aggiungi, rimuovi, rinomina',      d: 0.50, dep: ['C1', 'A2'] },
  { id: 'C3', nome: 'Tre colonne e vista semplice/dettagliata',       d: 0.50, dep: ['C2', 'B1'] },
  { id: 'C4', nome: 'Pannello parametri e tariffe orarie',            d: 0.25, dep: ['C1', 'A2'] },
  { id: 'C5', nome: 'Pannello simulazione',                           d: 0.50, dep: ['C3', 'B3'] },
  { id: 'C6', nome: 'Pannello confronto e barra risultati',           d: 0.50, dep: ['C3', 'B4'] },
  { id: 'D1', nome: 'Archivio: serializzazione, scarica/apri',        d: 0.50, dep: ['A2', 'C3'] },
  { id: 'D2', nome: 'Archivio: cartella di rete ed elenco',           d: 0.50, dep: ['D1'] },
  { id: 'E1', nome: 'Export CSV e stampa',                            d: 0.25, dep: ['C6'] },
  { id: 'E2', nome: 'Assemblaggio in file singolo',                   d: 0.25, dep: ['C5', 'C6', 'D2', 'E1', 'C4', 'B5'] },
  { id: 'E3', nome: 'Istruzioni d uso',                               d: 0.25, dep: ['E2'] },
  { id: 'F1', nome: 'Waterfall e tornado (opzionale)',                d: 0.75, dep: ['C6'], opz: true },
];

export function analizza(att) {
  const m = new Map(att.map(a => [a.id, { ...a, succ: [] }]));
  for (const a of m.values()) for (const p of a.dep) {
    if (!m.has(p)) throw new Error(`dipendenza inesistente: ${p} richiesta da ${a.id}`);
    m.get(p).succ.push(a.id);
  }

  // Ordinamento topologico (Kahn). Rileva anche i cicli.
  const grado = new Map([...m.keys()].map(k => [k, m.get(k).dep.length]));
  const coda = [...grado].filter(([, g]) => g === 0).map(([k]) => k).sort();
  const topo = [];
  while (coda.length) {
    const k = coda.shift();
    topo.push(k);
    for (const s of m.get(k).succ) {
      grado.set(s, grado.get(s) - 1);
      if (grado.get(s) === 0) coda.push(s);
    }
    coda.sort();
  }
  if (topo.length !== m.size) throw new Error('il grafo contiene un ciclo: non e un DAG');

  // Passata in avanti: inizio e fine al piu' presto.
  for (const k of topo) {
    const a = m.get(k);
    a.es = a.dep.length ? Math.max(...a.dep.map(p => m.get(p).ef)) : 0;
    a.ef = a.es + a.d;
  }
  const durataMin = Math.max(...[...m.values()].map(a => a.ef));

  // Passata all'indietro: inizio e fine al piu' tardi, scorrimento.
  for (const k of [...topo].reverse()) {
    const a = m.get(k);
    a.lf = a.succ.length ? Math.min(...a.succ.map(s => m.get(s).ls)) : durataMin;
    a.ls = a.lf - a.d;
    a.slack = Math.round((a.ls - a.es) * 1000) / 1000;
    a.critica = a.slack === 0;
  }

  const sequenziale = att.reduce((s, a) => s + a.d, 0);
  const critico = topo.filter(k => m.get(k).critica);
  return { m, topo, durataMin, sequenziale, critico };
}

function fmt(n) { return n.toFixed(2).replace('.', ','); }

function stampa(r, titolo) {
  console.log('=== ' + titolo + ' ===');
  console.log('Ordinamento topologico: ' + r.topo.join(' -> '));
  console.log('');
  console.log('| Att. | Attivita | Durata | Dipende da | ES | EF | LS | LF | Scorrimento | Critica |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const k of r.topo) {
    const a = r.m.get(k);
    console.log(`| ${a.id} | ${a.nome} | ${fmt(a.d)} | ${a.dep.join(', ') || '-'} | ${fmt(a.es)} | ${fmt(a.ef)} | ${fmt(a.ls)} | ${fmt(a.lf)} | ${fmt(a.slack)} | ${a.critica ? 'si' : ''} |`);
  }
  console.log('');
  console.log('Cammino critico: ' + r.critico.join(' -> '));
  console.log('Durata a parallelismo illimitato: ' + fmt(r.durataMin) + ' gg');
  console.log('Durata a esecutore singolo (somma): ' + fmt(r.sequenziale) + ' gg');
  const conSlack = r.topo.filter(k => !r.m.get(k).critica);
  console.log('Attivita con scorrimento: ' + conSlack.join(', '));
  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const obbl = ATTIVITA.filter(a => !a.opz);
  stampa(analizza(obbl), 'Perimetro obbligatorio');
  stampa(analizza(ATTIVITA), 'Perimetro completo, con le attivita opzionali');
}
