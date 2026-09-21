// Assemblaggio del file singolo distribuibile.
//
// Perché esiste: una pagina aperta da cartella di rete ha origine opaca e in quel contesto
// il browser blocca i moduli JavaScript. I moduli servono per poter testare il calcolo;
// il file unico serve per poter aprire la pagina. Questo script concilia le due cose senza
// alcuna dipendenza esterna: rimuove le righe di import, toglie la parola export e
// concatena i moduli nell'ordine delle dipendenze dentro una funzione anonima.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const qui = dirname(fileURLToPath(import.meta.url));
const radice = join(qui, '..');
const src = (f) => readFileSync(join(radice, 'src', f), 'utf8');

const ORDINE = ['calcolo.mjs', 'modello.mjs', 'archivio.mjs', 'app.mjs'];

// Controllo di sintassi prima di assemblare. I test coprono il motore, non l'interfaccia:
// senza questo, una parentesi mancante in app.mjs passa il build, passa i test, e si
// scopre solo aprendo la pagina e trovandola bianca.
for (const f of ORDINE) {
  try {
    execFileSync(process.execPath, ['--check', join(radice, 'src', f)], { stdio: 'pipe' });
  } catch (e) {
    const dettaglio = (e.stderr || Buffer.from('')).toString().trim().split('\n').slice(0, 4).join('\n');
    throw new Error(`errore di sintassi in src/${f}:\n${dettaglio}`);
  }
}

function spoglia(codice, nome) {
  const senzaImport = codice.replace(/^import\s[\s\S]*?from\s+'[^']+';\s*$/gm, '');
  const senzaExport = senzaImport.replace(/^export\s+(?=(async\s+function|function|const|let|class)\b)/gm, '');
  if (/^\s*export\s/m.test(senzaExport)) {
    throw new Error(`${nome}: resta una dichiarazione export non gestita`);
  }
  if (/^\s*import\s/m.test(senzaExport)) {
    throw new Error(`${nome}: resta un import non gestito`);
  }
  return `// ---- ${nome} ----\n${senzaExport.trim()}\n`;
}

const script = [
  "'use strict';",
  ...ORDINE.map((f) => spoglia(src(f), f)),
  'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);',
  'else avvia();',
].join('\n\n');

// Controllo grossolano ma utile: nomi dichiarati due volte al livello superiore.
const dichiarazioni = [...script.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const doppi = dichiarazioni.filter((n, i) => dichiarazioni.indexOf(n) !== i);
if (doppi.length) throw new Error('nomi dichiarati più volte nel file unico: ' + [...new Set(doppi)].join(', '));

// Una dichiarazione locale che chiama se stessa (const modo = modo()) è sintatticamente
// valida ma lancia a runtime. Nasce facilmente rinominando gli import, quindi si controlla.
const autoRiferimenti = [...script.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?\1\s*\(/g)].map((m) => m[1]);
if (autoRiferimenti.length) {
  throw new Error('dichiarazione che si auto-riferisce, lancia a runtime: ' + [...new Set(autoRiferimenti)].join(', '));
}

const TITOLO = 'Simulatore Margine Commessa';

/**
 * Caratteri incorporati nel file invece che richiesti a un server.
 *
 * Un file che si porta in giro deve funzionare anche senza rete: su una cartella di rete
 * aziendale, su una chiavetta, su un portatile in cantiere. Con il collegamento a Google
 * Fonts il testo ripiegherebbe sui caratteri di sistema e ogni apertura tenterebbe una
 * richiesta verso l'esterno, cosa che su una rete aziendale chiusa aggiunge solo attesa.
 *
 * IBM Plex è distribuito con SIL Open Font License 1.1, che consente di incorporare e
 * ridistribuire a patto di riportare la nota di copyright e la licenza: la nota è qui
 * sotto e il testo completo è in assets/font/LICENSE-IBM-Plex.txt.
 *
 * Incorporato il solo sottoinsieme latino: 98 KB in base64. Per i caratteri fuori da quel
 * sottoinsieme il browser ripiega da sé sulla catena dichiarata nel foglio di stile.
 */
const FACCE = [
  ['IBM Plex Sans', '400 600', 'plex-sans.woff2'],
  ['IBM Plex Mono', '400', 'plex-mono-400.woff2'],
  ['IBM Plex Mono', '500', 'plex-mono-500.woff2'],
];

function caratteriIncorporati() {
  const regole = FACCE.map(([famiglia, peso, file]) => {
    const dati = readFileSync(join(radice, 'assets', 'font', file)).toString('base64');
    return `@font-face{font-family:'${famiglia}';font-style:normal;font-weight:${peso};`
      + `font-display:swap;src:url(data:font/woff2;base64,${dati}) format('woff2')}`;
  });
  return '<style>\n/* IBM Plex. Copyright 2017 IBM Corp. con Reserved Font Name "Plex".\n'
    + '   SIL Open Font License 1.1 — https://openfontlicense.org\n'
    + '   Testo completo della licenza: assets/font/LICENSE-IBM-Plex.txt */\n'
    + regole.join('\n') + '\n</style>';
}

const FONT = caratteriIncorporati();

const contenuto = [
  `<title>${TITOLO}</title>`,
  FONT,
  `<style>\n${src('stile.css').trim()}\n</style>`,
  `<script>\n${script}\n</` + 'script>',
].join('\n');

const documento = [
  '<!doctype html>',
  '<html lang="it">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  contenuto,
  '</head>',
  '<body></body>',
  '</html>',
].join('\n');

mkdirSync(join(radice, 'dist'), { recursive: true });
writeFileSync(join(radice, 'dist', 'simulatore-margine.html'), documento);
writeFileSync(join(radice, 'dist', 'artifact.html'), contenuto);

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1) + ' KB';
console.log('dist/simulatore-margine.html  ' + kb(documento) + '  (file unico da aprire o mettere in cartella di rete)');
console.log('dist/artifact.html            ' + kb(contenuto) + '  (stesso contenuto, senza involucro del documento)');
