# Simulatore Margine di Commessa

Strumento a uso dei Project Manager per simulare il margine di commessa al variare dei
macro valori di costo, suddivisi per linea di servizio: quadri elettrici, installazione in
cantiere, commissioning.

Contesto: Righi Solutions.

Confronta tre colonne sulla stessa struttura — Margine preventivo, Margine KOM e Margine
simulato — in valore assoluto, in percentuale di marginalità e in punti percentuali.

## Come si usa

Apri `dist/simulatore-margine.html`. È un file unico e autosufficiente: nessuna
installazione, nessun account, nessun server, nessuna connessione. Si apre con un doppio
clic da disco, da chiavetta o da cartella di rete.

### I quattro stadi

Ogni voce attraversa quattro stadi. Si scrive il valore di preventivo, poi una percentuale
per ogni passaggio.

    Preventivo --% trattativa--> Dopo trattativa --% KOM--> KOM --% simulato--> Simulato

| Stadio | Che cos'è |
|---|---|
| Preventivo | il costo come stimato in offerta, e il ricavo offerto. È l'unico valore che si scrive da zero |
| Preventivo dopo trattativa | quello che resta dopo la trattativa con i fornitori |
| KOM | il budget concordato al kick off meeting |
| Simulato | lo scenario che si sta provando |

La percentuale fra una colonna e l'altra è la diminuzione ottenuta in quel passaggio:
sconti, ottimizzazioni previste, trattative con i fornitori. Una percentuale negativa è un
aumento, ed è ammessa.

Ogni casella si scrive nei due versi: metti la percentuale e ottieni il valore, oppure
metti il valore e ottieni la percentuale che lo produce. Così il KOM resta un numero che si
può dettare, pur essendo espresso come riduzione rispetto allo stadio precedente.

### Una pagina sola

Il Cruscotto contiene tutto: dati della commessa, parametri, margine nei quattro stadi,
cascata del margine, il blocco per partire dal margine voluto, le tabelle dei servizi e la
classifica delle voci su cui conviene intervenire. Archivio e Guida restano due schede a
parte.

### Trovare dove ottimizzare

Nel blocco "Partire dal margine" metti il margine che vuoi raggiungere: lo strumento
calcola la riduzione uniforme che servirebbe e la applica a tutte le voci. Da lì la
concentri dove è davvero ottenibile, alzando la percentuale su una voce e azzerandola su
un'altra. Il grafico "Dove conviene intervenire" ordina le voci per quanto rende un taglio
del 10%.

### Colori

Verde quando il margine ci guadagna, rosso quando ci perde. Su un costo vuol dire scendere,
su ricavo e margine salire. Il colore non è mai l'unico segnale: c'è sempre il segno davanti
al numero e, sui valori assoluti, una freccia.

### Da smartphone

Tutte le schede funzionano da 375 px in su, verificato alle larghezze degli iPhone in
circolazione. Le tabelle si ricompongono in blocchi verticali: ogni numero porta con sé la
propria etichetta, quindi non serve scorrere di lato.

Su iPhone e iPad funziona tutto tranne il collegamento a una cartella di rete: Safari non
espone il selettore di cartelle e su iOS tutti i browser usano lo stesso motore.

### Archivio

| Modo | Come si attiva | Nota |
|---|---|---|
| Cartella di rete | pulsante nella scheda Archivio | un file JSON per simulazione, sopravvive alla pulizia del browser, condiviso. Richiede Chrome o Edge su desktop |
| Memoria del browser | automatico se non è stata scelta una cartella | ripiego, sparisce con la pulizia dei dati di navigazione |
| File singolo | pulsanti Scarica e Apri | funziona ovunque |

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
    assets/font/        caratteri incorporati nel file distribuibile
    dist/               file da distribuire

Perché esiste un passo di assemblaggio: una pagina aperta da cartella di rete ha origine
opaca e in quel contesto il browser blocca i moduli JavaScript. I moduli servono per poter
testare il calcolo, il file unico per poter aprire la pagina. `tools/build.mjs` concilia le
due cose in poche righe, senza alcuna dipendenza esterna.

## Cosa non fa, di proposito

Nessuna consuntivazione, nessun avanzamento lavori, nessuna storicizzazione, nessun ciclo
di vita con approvazioni, nessuna integrazione con il gestionale. Una simulazione è una
fotografia della data in cui è stata fatta e non va aggiornata nel tempo.

## Caratteri

Il file incorpora il sottoinsieme latino di IBM Plex Sans e IBM Plex Mono, 98 KB in base64,
per funzionare senza rete. IBM Plex è distribuito con SIL Open Font License 1.1, che
consente di incorporare e ridistribuire riportando la nota di copyright e la licenza. Il
testo completo è in `assets/font/LICENSE-IBM-Plex.txt` e la nota è nel file prodotto.

Copyright 2017 IBM Corp. con Reserved Font Name "Plex".
