// Motore di calcolo del simulatore di margine di commessa.
// Modulo puro: nessun accesso al DOM, nessuno stato globale, nessuna dipendenza.
//
// Modello a stadi. Ogni voce parte da un valore di preventivo e attraversa tre riduzioni
// successive, ognuna espressa in percentuale: la trattativa con i fornitori, il budget
// concordato al kick off meeting, e lo scenario simulato. Il valore di uno stadio è il
// valore dello stadio precedente meno la sua percentuale.
//
//   Preventivo --%trattativa--> Dopo trattativa --%kom--> KOM --%simulato--> Simulato
//
// Una percentuale negativa è un aumento, ed è ammessa: succede che un budget salga.

export const STADI = ['preventivo', 'trattativa', 'kom', 'simulato'];

/** Le riduzioni, nell'ordine in cui portano da uno stadio al successivo. */
export const RIDUZIONI = ['trattativa', 'kom', 'simulato'];

export const ETICHETTA_STADIO = {
  preventivo: 'Preventivo',
  trattativa: 'Preventivo dopo trattativa',
  kom: 'KOM',
  simulato: 'Simulato',
};

export const ETICHETTA_STADIO_BREVE = {
  preventivo: 'Preventivo',
  trattativa: 'Dopo trattativa',
  kom: 'KOM',
  simulato: 'Simulato',
};

export const CATEGORIE = ['materiale', 'manodopera', 'altri'];

export const ETICHETTA_CATEGORIA = {
  materiale: 'Materiale',
  manodopera: 'Manodopera',
  altri: 'Altri costi diretti',
};

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// Le percentuali sono memorizzate come numeri leggibili (8 significa 8%).
const frazione = (v) => num(v) / 100;

const rapporto = (a, b) => (b !== 0 ? a / b : null);

/** Indice dello stadio, per sapere quante riduzioni applicare. */
export function indiceStadio(stadio) {
  const i = STADI.indexOf(stadio);
  return i < 0 ? 0 : i;
}

/**
 * Valore di una grandezza a stadi (una voce di costo o il ricavo di un servizio) allo
 * stadio richiesto. `elemento` ha forma { base, rid: { trattativa, kom, simulato } }.
 */
export function valoreAStadio(elemento, stadio) {
  let v = num(elemento && elemento.base);
  const fino = indiceStadio(stadio);
  for (let i = 0; i < fino; i += 1) {
    v *= 1 - frazione((elemento.rid || {})[RIDUZIONI[i]]);
  }
  return v;
}

/**
 * Percentuale da scrivere in una riduzione perché lo stadio assuma il valore voluto.
 * Restituisce null se lo stadio precedente vale zero: da zero nessuna percentuale porta
 * a un numero diverso da zero, e accettare comunque il valore significherebbe mostrare
 * un campo che non rispetta quello che ci scrivi.
 */
export function riduzionePerValore(elemento, stadio, voluto) {
  const i = indiceStadio(stadio);
  if (i === 0) return null;
  const precedente = valoreAStadio(elemento, STADI[i - 1]);
  if (!(Math.abs(precedente) > 1e-9)) return null;
  return (1 - num(voluto) / precedente) * 100;
}

export function costoVoce(voce, stadio) {
  return valoreAStadio(voce, stadio);
}

/** Calcola uno stadio completo: dettaglio per servizio e totali di commessa. */
export function calcolaStadio(sim, stadio) {
  const p = sim.parametri || {};
  const riserva = frazione(p.riservaPct);
  const target = frazione(p.targetPct);

  const servizi = (sim.servizi || []).map((s) => {
    const perCategoria = {};
    for (const cat of CATEGORIE) perCategoria[cat] = 0;
    const voci = {};
    for (const voce of s.voci || []) {
      const c = valoreAStadio(voce, stadio);
      perCategoria[voce.cat] = (perCategoria[voce.cat] || 0) + c;
      voci[voce.id] = c;
    }
    const cd = CATEGORIE.reduce((acc, cat) => acc + perCategoria[cat], 0);
    const ricavo = valoreAStadio(s.ricavo, stadio);
    const mdc = ricavo - cd;
    return { id: s.id, nome: s.nome, perCategoria, voci, cd, ricavo, mdc, mdcPct: rapporto(mdc, ricavo) };
  });

  const cd = servizi.reduce((acc, s) => acc + s.cd, 0);
  const ricavo = servizi.reduce((acc, s) => acc + s.ricavo, 0);
  const mdc = ricavo - cd;
  const imprevisti = cd * riserva;
  const mi = ricavo - cd - imprevisti;

  // Costo massimo compatibile con il margine obiettivo:
  // MI = R - CD(1+riserva) >= target*R  =>  CD <= R(1-target)/(1+riserva)
  const cdMax = (ricavo * (1 - target)) / (1 + riserva);
  const spazio = cdMax - cd;

  return {
    stadio,
    servizi,
    cd,
    ricavo,
    mdc,
    mdcPct: rapporto(mdc, ricavo),
    imprevisti,
    mi,
    miPct: rapporto(mi, ricavo),
    cdMax,
    spazio,
    spazioPct: rapporto(spazio, cd),
  };
}

/** Calcolo completo: i quattro stadi e il passaggio da uno al successivo. */
export function calcola(sim) {
  const stadi = {};
  for (const s of STADI) stadi[s] = calcolaStadio(sim, s);

  const passaggi = RIDUZIONI.map((r, i) => {
    const da = stadi[STADI[i]];
    const a = stadi[STADI[i + 1]];
    const pp = (x, y) => (x === null || y === null ? null : (y - x) * 100);
    return {
      riduzione: r,
      da: da.stadio,
      a: a.stadio,
      dRicavo: a.ricavo - da.ricavo,
      dCd: a.cd - da.cd,
      dMdc: a.mdc - da.mdc,
      dMdcPp: pp(da.mdcPct, a.mdcPct),
      dMi: a.mi - da.mi,
      dMiPp: pp(da.miPct, a.miPct),
      effettoRicavo: a.ricavo - da.ricavo,
      effettoCosto: -(a.cd - da.cd),
    };
  });

  return { stadi, passaggi };
}

/**
 * Quali voci pesano di più: effetto sul margine simulato di una riduzione aggiuntiva,
 * applicata a quella sola voce. Ordinate per impatto decrescente.
 */
export function sensitivita(sim, ampiezzaPct = 10) {
  const partenza = calcolaStadio(sim, 'simulato').mi;
  const righe = [];

  for (const servizio of sim.servizi || []) {
    for (const voce of servizio.voci || []) {
      const attuale = valoreAStadio(voce, 'simulato');
      if (!(attuale > 0)) continue;
      const clone = {
        ...sim,
        servizi: sim.servizi.map((s) => (s.id !== servizio.id ? s : {
          ...s,
          voci: s.voci.map((v) => (v.id !== voce.id ? v : {
            ...v,
            rid: { ...(v.rid || {}), simulato: num((v.rid || {}).simulato) + ampiezzaPct },
          })),
        })),
      };
      const guadagno = calcolaStadio(clone, 'simulato').mi - partenza;
      righe.push({
        idVoce: voce.id,
        idServizio: servizio.id,
        etichetta: (voce.nome || 'senza nome') + (sim.servizi.length > 1 ? ' · ' + servizio.nome : ''),
        attuale,
        guadagno,
        categoria: voce.cat,
      });
    }
  }

  righe.sort((a, b) => b.guadagno - a.guadagno);
  return { base: partenza, ampiezzaPct, righe };
}

/**
 * Riduzione uniforme da applicare allo stadio simulato di tutte le voci perché la
 * commessa raggiunga il margine voluto. Restituisce un motivo, non un numero, quando
 * il margine non è raggiungibile agendo sui costi.
 */
export function riduzionePerMargine(sim, marginePct) {
  const m = frazione(marginePct);
  if (m >= 1) return { possibile: false, motivo: 'Un margine del 100% o più non è raggiungibile.' };

  const riserva = frazione((sim.parametri || {}).riservaPct);
  const attuale = calcolaStadio(sim, 'simulato');
  if (!(attuale.ricavo > 0)) {
    return { possibile: false, motivo: 'Serve un ricavo maggiore di zero per calcolare i costi ammessi.' };
  }

  // Costi allo stadio KOM: sono la base su cui agisce la riduzione simulata.
  const partenza = calcolaStadio(sim, 'kom').cd;
  if (!(partenza > 0)) {
    return { possibile: false, motivo: 'Serve almeno un costo inserito su cui agire.' };
  }

  const richiesto = (attuale.ricavo * (1 - m)) / (1 + riserva);
  if (richiesto < 0) {
    return { possibile: false, motivo: 'Con questo ricavo il margine voluto imporrebbe costi negativi.' };
  }
  return {
    possibile: true,
    riduzionePct: (1 - richiesto / partenza) * 100,
    attuale: attuale.cd,
    richiesto,
    variazione: richiesto - attuale.cd,
  };
}

/** Peso di ogni voce sul totale, stadio per stadio. */
export function incidenze(sim, risultato, riferimento = 'cd') {
  const denom = (st) => (riferimento === 'ricavo' ? st.ricavo : st.cd);
  const quota = (valore, st) => {
    const d = denom(st);
    return d ? valore / d : null;
  };
  const perStadio = (fn) => {
    const o = {};
    for (const s of STADI) o[s] = fn(risultato.stadi[s]);
    return o;
  };

  const righe = [];
  for (const servizio of sim.servizi || []) {
    for (const cat of CATEGORIE) {
      const voci = (servizio.voci || []).filter((v) => v.cat === cat);
      if (!voci.length) continue;
      righe.push({
        livello: 0, tipo: 'categoria', id: servizio.id + '|' + cat, nome: ETICHETTA_CATEGORIA[cat],
        valori: perStadio((st) => {
          const s = st.servizi.find((x) => x.id === servizio.id);
          return s ? quota(s.perCategoria[cat] || 0, st) : null;
        }),
      });
      for (const voce of voci) {
        righe.push({
          livello: 1, tipo: 'voce', id: voce.id, nome: voce.nome || 'senza nome',
          valori: perStadio((st) => {
            const s = st.servizi.find((x) => x.id === servizio.id);
            return s ? quota(s.voci[voce.id] || 0, st) : null;
          }),
        });
      }
    }
  }
  return { riferimento, righe };
}
