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
avviso. Il pulsante "Parti da zero" svuota tutto e lascia la maschera minima.

### Tre livelli di dettaglio

Si parte dal livello Base e si espande solo quando serve, con pulsanti espliciti. Cambiare
livello non cancella nulla: nasconde soltanto.

| Livello | Cosa si compila | Quanti numeri per una commessa a tre linee |
|---|---|---|
| Base | ricavo, materiale e manodopera per linea, una colonna sola | 9 |
| Intermedio | aggiunge la colonna Preventivo, gli altri costi diretti e le spese generali | 24 |
| Completo | righe per marca fornitore e tipo di manodopera, con tariffe orarie | quanti ne servono |

Al livello Base la manodopera si inserisce in euro, senza dover impostare tariffe orarie.
Nel livello Completo ogni riga di manodopera si commuta fra importo e ore per tariffa.

Una categoria con più voci compare come somma non modificabile, con un pulsante che porta
al livello Completo. Gli altri costi diretti restano nascosti al livello Base solo finché
sono a zero: appena valorizzati compaiono, perché un costo che abbassa il margine a schermo
non può restare invisibile.

### Le schede

1. Dati di commessa: livello, dati della commessa, parametri e valori.
2. Simulazione: cursori per gli scostamenti, con l'effetto mostrato in testa alla scheda.
3. Confronto: tre colonne, due gap, cascata del margine, incidenza di ogni voce.
4. Archivio: salvataggio e riapertura.
5. Guida: cosa fa, come si legge, cosa non fa.

La barra in basso resta sempre visibile e mostra il margine mentre si digita.

### Vedere da dove arriva un numero

Tocca (o clicca) una cella calcolata, riconoscibile dal bordino tratteggiato: compare il
calcolo che l'ha prodotta, con i valori di partenza e gli scostamenti applicati. Sul
desktop lo stesso testo è anche il suggerimento del browser.

Sul telefono non esiste il passaggio del dito sopra una cella: il browser non ha un evento
di hover sul touch, quindi la funzione è costruita sul tocco. Si chiude toccando fuori o
con Esc.

### Da smartphone e da iPhone

Tutte le schede funzionano da 375 px in su, verificato alle larghezze degli iPhone in
circolazione (375, 390, 393, 402, 430, 440). Nella scheda Confronto le tabelle si
ricompongono in blocchi verticali: ogni numero porta con sé la propria etichetta, quindi
non serve scorrere di lato per leggere una cifra.

| Aspetto | Su iPhone e iPad |
|---|---|
| Inserimento, simulazione, confronto, spiegazione dei calcoli | funzionano |
| Archivio in memoria del browser, Apri e Salva file | funzionano |
| Collegamento a una cartella di rete | non disponibile: Safari non espone il selettore di cartelle e su iOS tutti i browser usano lo stesso motore, quindi il limite vale anche per Chrome ed Edge sul telefono |

I campi di inserimento usano 16 px sui dispositivi a tocco: sotto quella soglia iOS
ingrandisce la pagina al primo tocco su un campo e non la rimpicciolisce più.

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
