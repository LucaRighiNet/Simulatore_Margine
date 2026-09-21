// Motore di calcolo del simulatore di margine di commessa.
// Modulo puro: nessun accesso al DOM, nessuno stato globale, nessuna dipendenza.
// È il punto del sistema dove un errore costa di più, quindi vive separato ed è testato.

export const COLONNE = ['preventivo', 'kom', 'simulato'];
export const CATEGORIE = ['materiale', 'manodopera', 'altri'];

export const ETICHETTA_COLONNA = {
  preventivo: 'Preventivo',
  kom: 'KOM',
  simulato: 'Simulato',
};

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
// Internamente si lavora in frazioni.
const frazione = (v) => num(v) / 100;

/**
 * Come si inserisce una voce di manodopera. In ore per tariffa oraria quando la tariffa
 * aziendale è nota, ed è la forma che permette di simulare uno sforo di ore; a importo
 * quando si sta facendo una stima rapida e le tariffe non sono ancora state impostate.
 * Senza questa distinzione una riga di manodopera priva di tariffa costerebbe zero in
 * silenzio, che è il modo peggiore di sbagliare un margine.
 */
export function modoManodopera(voce) {
  if (voce.modo === 'ore' || voce.modo === 'importo') return voce.modo;
  return voce.tariffaId ? 'ore' : 'importo';
}

/** Costo di una singola voce nella colonna indicata, prima degli scostamenti. */
export function costoVoce(voce, colonna, tariffe) {
  const d = voce[colonna] || {};
  if (voce.cat === 'manodopera') {
    if (modoManodopera(voce) === 'importo') return num(d.q);
    const t = (tariffe || []).find((x) => x.id === voce.tariffaId);
    return num(d.q) * num(t && t.eurOra);
  }
  return num(d.q) * (1 - frazione(d.sconto));
}

/** Fattore moltiplicativo degli scostamenti applicabili a una voce. */
export function fattoreVoce(sim, linea, voce) {
  const d = sim.delta || {};
  return (
    (1 + frazione(d.globale)) *
    (1 + frazione((d.linea || {})[linea.id])) *
    (1 + frazione((d.catLinea || {})[linea.id + '|' + voce.cat])) *
    (1 + frazione((d.voce || {})[voce.id]))
  );
}

/**
 * Su quale colonna poggia la simulazione. Normalmente il KOM, che è il budget di cui il PM
 * risponde. Se il KOM non è ancora stato compilato la simulazione poggia sul preventivo:
 * senza questo ripiego, chi compila solo il preventivo muove i cursori e non vede nulla,
 * perché moltiplicare zero per qualunque scostamento dà zero.
 */
export function baseSimulato(sim) {
  const haKom = (sim.linee || []).some((l) => (
    num((l.ricavo || {}).kom) !== 0
    || (l.voci || []).some((v) => num((v.kom || {}).q) !== 0)
  ));
  return haKom ? 'kom' : 'preventivo';
}

/** Costo di una voce nella colonna simulato: colonna base moltiplicata per gli scostamenti. */
export function costoVoceSimulato(sim, linea, voce, base) {
  return costoVoce(voce, base || baseSimulato(sim), sim.tariffe) * fattoreVoce(sim, linea, voce);
}

function ricavoLinea(sim, linea, colonna, base) {
  if (colonna !== 'simulato') return num((linea.ricavo || {})[colonna]);
  const d = sim.delta || {};
  return (
    num((linea.ricavo || {})[base]) *
    (1 + frazione(d.ricavo)) *
    (1 + frazione((d.ricavoLinea || {})[linea.id]))
  );
}

function costoDellaVoce(sim, linea, voce, colonna, base) {
  return colonna === 'simulato'
    ? costoVoceSimulato(sim, linea, voce, base)
    : costoVoce(voce, colonna, sim.tariffe);
}

const rapporto = (a, b) => (b !== 0 ? a / b : null);

/** Calcola una colonna completa: dettaglio per linea e totali di commessa. */
export function calcolaColonna(sim, colonna) {
  const base = colonna === 'simulato' ? baseSimulato(sim) : colonna;
  const p = sim.parametri || {};
  const sg = frazione(p.sgPct);
  const ctg = frazione(p.ctgPct);
  const target = frazione(p.targetPct);

  const linee = (sim.linee || []).map((linea) => {
    const perCategoria = {};
    for (const cat of CATEGORIE) perCategoria[cat] = 0;
    const voci = {};
    for (const voce of linea.voci || []) {
      const c = costoDellaVoce(sim, linea, voce, colonna, base);
      perCategoria[voce.cat] = (perCategoria[voce.cat] || 0) + c;
      voci[voce.id] = c;
    }
    const cd = CATEGORIE.reduce((s, cat) => s + perCategoria[cat], 0);
    const r = ricavoLinea(sim, linea, colonna, base);
    const mdc = r - cd;
    return {
      id: linea.id,
      nome: linea.nome,
      perCategoria,
      voci,
      cd,
      ricavo: r,
      mdc,
      mdcPct: rapporto(mdc, r),
    };
  });

  const cd = linee.reduce((s, l) => s + l.cd, 0);
  const ricavo = linee.reduce((s, l) => s + l.ricavo, 0);
  const mdc = ricavo - cd;
  const speseGenerali = cd * sg;
  const contingency = cd * ctg;
  const mi = ricavo - cd - speseGenerali - contingency;

  // Costo massimo compatibile con il margine industriale obiettivo:
  // MI = R - CD(1+sg+ctg) >= target*R  =>  CD <= R(1-target)/(1+sg+ctg)
  const cdMax = (ricavo * (1 - target)) / (1 + sg + ctg);
  const riserva = cdMax - cd;

  return {
    colonna,
    base,
    linee,
    cd,
    ricavo,
    mdc,
    mdcPct: rapporto(mdc, ricavo),
    speseGenerali,
    contingency,
    mi,
    miPct: rapporto(mi, ricavo),
    cdMax,
    riserva,
    riservaPct: rapporto(riserva, cd),
  };
}

/**
 * Confronto fra due colonne. Restituisce le tre grandezze distinte che il documento
 * di proposta impone di non confondere: variazione assoluta in euro, variazione della
 * marginalità in punti percentuali, variazione relativa del margine in percentuale.
 */
export function gap(a, b) {
  const pp = (x, y) => (x === null || y === null ? null : (y - x) * 100);
  // La variazione relativa non ha significato se il margine di partenza non è positivo.
  const rel = (x, y) => (x > 0 ? ((y - x) / x) * 100 : null);

  const effettoCostoPerLinea = b.linee.map((lb) => {
    const la = a.linee.find((x) => x.id === lb.id);
    const base = la || { cd: 0, ricavo: 0, perCategoria: {} };
    const perCategoria = {};
    for (const cat of CATEGORIE) {
      perCategoria[cat] = -((lb.perCategoria[cat] || 0) - (base.perCategoria[cat] || 0));
    }
    return {
      id: lb.id,
      nome: lb.nome,
      effettoRicavo: lb.ricavo - base.ricavo,
      effettoCosto: -(lb.cd - base.cd),
      perCategoria,
      dMdc: lb.mdc - (base.mdc || 0),
    };
  });

  return {
    da: a.colonna,
    a: b.colonna,
    dMdc: b.mdc - a.mdc,
    dMdcPp: pp(a.mdcPct, b.mdcPct),
    dMdcRel: rel(a.mdc, b.mdc),
    dMi: b.mi - a.mi,
    dMiPp: pp(a.miPct, b.miPct),
    dMiRel: rel(a.mi, b.mi),
    dRicavo: b.ricavo - a.ricavo,
    dCd: b.cd - a.cd,
    effettoRicavo: b.ricavo - a.ricavo,
    effettoCosto: -(b.cd - a.cd),
    perLinea: effettoCostoPerLinea,
  };
}

/** Calcolo completo: le tre colonne e i due gap. */
export function calcola(sim) {
  const colonne = {};
  for (const c of COLONNE) colonne[c] = calcolaColonna(sim, c);
  return {
    colonne,
    baseSimulazione: baseSimulato(sim),
    gapPreventivoKom: gap(colonne.preventivo, colonne.kom),
    gapKomSimulato: gap(colonne.kom, colonne.simulato),
  };
}

/**
 * Sensitività: impatto sul margine industriale simulato di una variazione del driver,
 * tenendo fermi gli altri. Ordinato per impatto decrescente (tornado).
 */
export function sensitivita(sim, ampiezzaPct = 10, livello = 'voce') {
  const driver = [];
  for (const linea of sim.linee || []) {
    if (livello === 'voce') {
      for (const voce of linea.voci || []) {
        if (costoVoce(voce, baseSimulato(sim), sim.tariffe) === 0) continue;
        driver.push({
          campo: 'voce',
          chiave: voce.id,
          etichetta: (voce.nome || 'senza nome') + ' · ' + linea.nome,
        });
      }
      continue;
    }
    for (const cat of CATEGORIE) {
      const chiave = linea.id + '|' + cat;
      const haVoci = (linea.voci || []).some((v) => v.cat === cat);
      if (haVoci) driver.push({ campo: 'catLinea', chiave, etichetta: linea.nome + ' · ' + ETICHETTA_CATEGORIA[cat] });
    }
  }
  const partenza = calcolaColonna(sim, 'simulato').mi;
  const righe = driver.map((d) => {
    const campo = d.campo || 'catLinea';
    const conDelta = (segno) => {
      const clone = {
        ...sim,
        delta: {
          ...(sim.delta || {}),
          [campo]: {
            ...((sim.delta || {})[campo] || {}),
            [d.chiave]: num(((sim.delta || {})[campo] || {})[d.chiave]) + segno * ampiezzaPct,
          },
        },
      };
      return calcolaColonna(clone, 'simulato').mi;
    };
    const su = conDelta(1) - partenza;
    const giu = conDelta(-1) - partenza;
    return { ...d, su, giu, ampiezza: Math.abs(su - giu) };
  });
  righe.sort((x, y) => y.ampiezza - x.ampiezza);
  return { base: partenza, ampiezzaPct, righe };
}

export const RIFERIMENTI_INCIDENZA = {
  cd: 'Costi diretti',
  ricavo: 'Ricavo',
};

/**
 * Peso di ogni voce sul totale, colonna per colonna, e sua variazione fra le colonne.
 *
 * Il riferimento cambia la domanda a cui si risponde, e le due letture non sono
 * intercambiabili:
 *  - 'cd'     quanto pesa la voce sui costi diretti. Descrive la composizione del costo.
 *             Uno scostamento uniforme su tutte le voci non la muove di un punto.
 *  - 'ricavo' quanto pesa la voce sul ricavo. Descrive quanto della commessa se ne va in
 *             quella voce, e si muove per qualunque scostamento. Sommata al margine di
 *             contribuzione fa 100%.
 *
 * Restituisce righe piatte già ordinate e annidate (livello 0 linea, 1 categoria, 2 voce),
 * pronte per essere stampate, così l'interfaccia non deve ricostruire la gerarchia.
 */
export function incidenze(sim, risultato, riferimento = 'cd') {
  const denom = (col) => (riferimento === 'ricavo' ? col.ricavo : col.cd);
  const quota = (valore, col) => {
    const d = denom(col);
    return d ? valore / d : null;
  };
  const perColonna = (fn) => {
    const o = {};
    for (const c of COLONNE) o[c] = fn(risultato.colonne[c]);
    return o;
  };
  const pp = (a, b) => (a === null || b === null ? null : (b - a) * 100);
  const conDelta = (valori) => ({
    valori,
    dPreventivoKom: pp(valori.preventivo, valori.kom),
    dKomSimulato: pp(valori.kom, valori.simulato),
  });

  const righe = [];
  for (const linea of sim.linee || []) {
    const perLinea = (col) => {
      const l = col.linee.find((x) => x.id === linea.id);
      return l ? quota(l.cd, col) : null;
    };
    righe.push({ livello: 0, tipo: 'linea', id: linea.id, nome: linea.nome || 'Linea', ...conDelta(perColonna(perLinea)) });

    for (const cat of CATEGORIE) {
      const voci = (linea.voci || []).filter((v) => v.cat === cat);
      if (voci.length === 0) continue;
      const perCat = (col) => {
        const l = col.linee.find((x) => x.id === linea.id);
        return l ? quota(l.perCategoria[cat] || 0, col) : null;
      };
      righe.push({ livello: 1, tipo: 'categoria', id: linea.id + '|' + cat, nome: ETICHETTA_CATEGORIA[cat], ...conDelta(perColonna(perCat)) });

      for (const voce of voci) {
        const perVoce = (col) => {
          const l = col.linee.find((x) => x.id === linea.id);
          return l ? quota(l.voci[voce.id] || 0, col) : null;
        };
        righe.push({ livello: 2, tipo: 'voce', id: voce.id, nome: voce.nome || 'senza nome', ...conDelta(perColonna(perVoce)) });
      }
    }
  }

  righe.push({
    livello: 0, tipo: 'totale', id: '_cd', nome: 'Totale costi diretti',
    ...conDelta(perColonna((col) => quota(col.cd, col))),
  });
  if (riferimento === 'ricavo') {
    righe.push({
      livello: 0, tipo: 'margine', id: '_mdc', nome: 'Margine di contribuzione',
      ...conDelta(perColonna((col) => quota(col.mdc, col))),
    });
  }
  return { riferimento, righe };
}

export const LEVE = {
  costi: 'Costi',
  ricavi: 'Ricavi',
};

/**
 * Calcolo inverso: dato il margine che si vuole raggiungere, quale scostamento serve.
 *
 * Il margine di riferimento è quello industriale, che coincide con il margine di
 * contribuzione quando costi di struttura e riserva sono a zero:
 *   MI = R - CD(1+k),  con k = struttura + riserva
 *   MI/R = m  =>  CD(1+k) = R(1-m)
 *
 * Agendo sui costi, il ricavo resta quello simulato e si cerca CD; agendo sui ricavi,
 * restano i costi e si cerca R. Il risultato è uno scostamento percentuale complessivo,
 * cioè la stessa leva che il PM muove a mano: resta visibile, modificabile e annullabile.
 */
export function scostamentoPerMargine(sim, marginePct, leva) {
  const m = frazione(marginePct);
  const p = sim.parametri || {};
  const k = frazione(p.sgPct) + frazione(p.ctgPct);
  const attuale = calcolaColonna(sim, 'simulato');

  const senza = (campo) => calcolaColonna(
    { ...sim, delta: { ...(sim.delta || {}), [campo]: 0 } },
    'simulato',
  );

  if (m >= 1) {
    return { possibile: false, motivo: 'Un margine del 100% o più non è raggiungibile.' };
  }

  if (leva === 'costi') {
    if (!(attuale.ricavo > 0)) {
      return { possibile: false, motivo: 'Serve un ricavo maggiore di zero per calcolare i costi ammessi.' };
    }
    const base = senza('globale').cd;
    if (!(base > 0)) {
      return { possibile: false, motivo: 'Serve almeno un costo inserito su cui agire.' };
    }
    const richiesto = (attuale.ricavo * (1 - m)) / (1 + k);
    return {
      possibile: true,
      leva: 'costi',
      deltaPct: (richiesto / base - 1) * 100,
      attuale: attuale.cd,
      richiesto,
      variazione: richiesto - attuale.cd,
      negativo: richiesto < 0,
    };
  }

  if (!(attuale.cd > 0)) {
    return { possibile: false, motivo: 'Serve almeno un costo inserito per calcolare il ricavo necessario.' };
  }
  const base = senza('ricavo').ricavo;
  if (!(base > 0)) {
    return { possibile: false, motivo: 'Serve un ricavo di partenza maggiore di zero su cui agire.' };
  }
  const richiesto = (attuale.cd * (1 + k)) / (1 - m);
  return {
    possibile: true,
    leva: 'ricavi',
    deltaPct: (richiesto / base - 1) * 100,
    attuale: attuale.ricavo,
    richiesto,
    variazione: richiesto - attuale.ricavo,
    negativo: false,
  };
}

/**
 * Costo della voce nella colonna simulata con tutti gli scostamenti applicati tranne
 * quello della voce stessa. È il punto di partenza per fare il percorso inverso: se
 * l'utente scrive direttamente quanto vuole che costi quella voce, da qui si ricava lo
 * scostamento che produce quel numero.
 */
export function costoVoceSenzaScostamentoProprio(sim, linea, voce) {
  const d = sim.delta || {};
  const f = (1 + frazione(d.globale))
    * (1 + frazione((d.linea || {})[linea.id]))
    * (1 + frazione((d.catLinea || {})[linea.id + '|' + voce.cat]));
  return costoVoce(voce, baseSimulato(sim), sim.tariffe) * f;
}

/** Ricavo della linea nella colonna simulata senza lo scostamento proprio della linea. */
export function ricavoSenzaScostamentoProprio(sim, linea) {
  const d = sim.delta || {};
  return num((linea.ricavo || {})[baseSimulato(sim)]) * (1 + frazione(d.ricavo));
}

/**
 * Scostamento da scrivere perché una grandezza assuma il valore voluto.
 * Restituisce null quando il valore di partenza è zero: da zero nessun fattore
 * moltiplicativo porta a un numero diverso da zero, e fingere il contrario darebbe
 * un campo che accetta quello che scrivi e non lo rispetta.
 */
export function scostamentoPerValore(partenza, voluto) {
  if (!(Math.abs(partenza) > 1e-9)) return null;
  return (num(voluto) / partenza - 1) * 100;
}
