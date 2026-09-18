# Simulatore Margine di Commessa

Strumento a uso dei Project Manager per simulare il margine di commessa al variare dei
macro valori di costo, suddivisi per linea di servizio: quadri elettrici, installazione in
cantiere, commissioning.

Contesto: Righi Solutions.

Confronta tre colonne sulla stessa struttura — Margine preventivo, Margine KOM e Margine
simulato — in valore assoluto, in percentuale di marginalità e in punti percentuali.

## Come si usa

Apri `dist/simulatore-margine.html`. È un file unico: nessuna installazione, nessun
account, nessun server. Si apre con un doppio clic, anche da una cartella di rete.

Alla prima apertura mostra una commessa di esempio con numeri inventati, segnalata da un
avviso: serve a far vedere come funziona. Il pulsante "Parti da zero" svuota tutto.

1. Dati di commessa: codice, cliente, parametri (spese generali, contingency, margine
   obiettivo) e tariffe orarie. Poi, per ogni linea di servizio, il ricavo e i costi nelle
   colonne Preventivo e KOM.
2. Simulazione: sposta i cursori. Gli scostamenti si applicano alla colonna KOM e si
   compongono: complessivo, poi linea, poi categoria. Il KOM non viene toccato.
3. Confronto: le tre colonne affiancate, i due gap, la cascata del margine, la riserva
   residua rispetto al margine obiettivo.
4. Archivio: salva la simulazione. Ogni salvataggio crea una nuova voce datata.

La barra in basso resta sempre visibile e mostra il margine mentre si digita.

### Archivio

L'archivio vive dove scegli tu, in ordine di robustezza:

| Modo | Come si attiva | Nota |
|---|---|---|
| Cartella di rete | pulsante "Scegli la cartella di rete" nella scheda Archivio | un file JSON per simulazione, sopravvive alla pulizia del browser, condiviso, incluso nel backup aziendale. Richiede Chrome o Edge su desktop |
| Memoria del browser | automatico se non è stata scelta una cartella | ripiego. Sparisce con la pulizia dei dati di navigazione e non è condiviso |
| File singolo | pulsanti "Scarica come file" e "Apri da file" | funziona ovunque |

Prima di usarlo sul serio vanno impostate le tariffe orarie con il costo orario aziendale
pieno. Finché restano a zero, il margine calcolato non ha significato.

## Documentazione

- [Proposta, modello di calcolo e scelte](docs/00-proposta-e-piano-di-lavoro.md)
- [Piano di sviluppo sul grafo delle dipendenze](docs/01-piano-di-sviluppo-grafo.md)

## Sviluppo

    npm test     # test del motore di calcolo
    npm run dev  # pagina di sviluppo su http://localhost:8080
    npm run build # produce dist/simulatore-margine.html
    npm run cpm  # ricalcola il piano di sviluppo (cammino critico)

    src/calcolo.mjs     motore di calcolo puro, senza DOM, testato
    src/modello.mjs     valori di default, voci suggerite, esempio, normalizzazione
    src/archivio.mjs    persistenza: cartella, browser, file
    src/app.mjs         interfaccia
    src/stile.css       stile
    src/index.html      pagina di sviluppo (moduli, va servita da un'origine reale)
    test/               test del motore
    tools/build.mjs     assemblaggio nel file unico
    tools/cpm.mjs       analisi del grafo delle attività
    dist/               file da distribuire

Perché esiste un passo di assemblaggio: una pagina aperta da cartella di rete ha origine
opaca e in quel contesto il browser blocca i moduli JavaScript. I moduli servono per poter
testare il calcolo, il file unico per poter aprire la pagina. `tools/build.mjs` concilia le
due cose in poche righe, senza alcuna dipendenza esterna.

## Cosa non fa, di proposito

Nessuna consuntivazione, nessun avanzamento lavori, nessuna storicizzazione, nessun ciclo
di vita con approvazioni, nessuna integrazione con il gestionale. Una simulazione è una
fotografia della data in cui è stata fatta e non va aggiornata nel tempo.
