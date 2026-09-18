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

/** Costo di una singola voce nella colonna indicata, prima degli scostamenti. */
export function costoVoce(voce, colonna, tariffe) {
  const d = voce[colonna] || {};
  if (voce.cat === 'manodopera') {
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
export function sensitivita(sim, ampiezzaPct = 10) {
  const driver = [];
  for (const linea of sim.linee || []) {
    for (const cat of CATEGORIE) {
      const chiave = linea.id + '|' + cat;
      const haVoci = (linea.voci || []).some((v) => v.cat === cat);
      if (haVoci) driver.push({ chiave, etichetta: linea.nome + ' · ' + ETICHETTA_CATEGORIA[cat] });
    }
  }
  const partenza = calcolaColonna(sim, 'simulato').mi;
  const righe = driver.map((d) => {
    const conDelta = (segno) => {
      const clone = {
        ...sim,
        delta: {
          ...(sim.delta || {}),
          catLinea: {
            ...((sim.delta || {}).catLinea || {}),
            [d.chiave]: num(((sim.delta || {}).catLinea || {})[d.chiave]) + segno * ampiezzaPct,
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
