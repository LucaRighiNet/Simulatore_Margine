# Piano di sviluppo ottimizzato sul grafo delle dipendenze

Metodo: le attività di sviluppo sono modellate come grafo orientato aciclico, dove ogni
nodo è un'attività e ogni arco un vincolo di precedenza. Su questo grafo si applica il
Critical Path Method: ordinamento topologico, passata in avanti per inizio e fine al più
presto, passata all'indietro per inizio e fine al più tardi, scorrimento come differenza
fra i due.

Il calcolo non è stimato a occhio: è prodotto da `tools/cpm.mjs`, eseguibile con
`node tools/cpm.mjs`. Modificando durate o dipendenze in quel file, il piano si ricalcola.
Lo script verifica anche che il grafo sia effettivamente aciclico e che non esistano
dipendenze verso attività inesistenti.

## 1. Risultato dell'analisi (perimetro obbligatorio)

| Att. | Attivita | Durata | Dipende da | ES | EF | LS | LF | Scorrimento | Critica |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Struttura repo, README, scaffolding | 0,25 | - | 0,00 | 0,25 | 0,00 | 0,25 | 0,00 | si |
| A2 | Modello dati e schema JSON della simulazione | 0,50 | A1 | 0,25 | 0,75 | 0,25 | 0,75 | 0,00 | si |
| B1 | Motore: costo per voce e normalizzazione | 0,50 | A2 | 0,75 | 1,25 | 0,75 | 1,25 | 0,00 | si |
| B2 | Motore: aggregazioni, MdC, MI, break-even | 0,50 | B1 | 1,25 | 1,75 | 1,25 | 1,75 | 0,00 | si |
| B3 | Motore: scostamenti componibili (simulato) | 0,25 | B2 | 1,75 | 2,00 | 2,25 | 2,50 | 0,50 |  |
| B4 | Motore: gap, punti percentuali, scomposizione | 0,50 | B2 | 1,75 | 2,25 | 1,75 | 2,25 | 0,00 | si |
| B5 | Test unitari del motore | 0,50 | B3, B4 | 2,25 | 2,75 | 2,50 | 3,00 | 0,25 |  |
| C1 | Stile e impianto della maschera | 0,50 | A1 | 0,25 | 0,75 | 0,50 | 1,00 | 0,25 |  |
| C2 | Editor righe: aggiungi, rimuovi, rinomina | 0,50 | C1, A2 | 0,75 | 1,25 | 1,00 | 1,50 | 0,25 |  |
| C3 | Tre colonne e vista semplice/dettagliata | 0,50 | C2, B1 | 1,25 | 1,75 | 1,50 | 2,00 | 0,25 |  |
| C4 | Pannello parametri e tariffe orarie | 0,25 | C1, A2 | 0,75 | 1,00 | 2,75 | 3,00 | 2,00 |  |
| C5 | Pannello simulazione | 0,50 | C3, B3 | 2,00 | 2,50 | 2,50 | 3,00 | 0,50 |  |
| C6 | Pannello confronto e barra risultati | 0,50 | C3, B4 | 2,25 | 2,75 | 2,25 | 2,75 | 0,00 | si |
| D1 | Archivio: serializzazione, scarica/apri | 0,50 | A2, C3 | 1,75 | 2,25 | 2,00 | 2,50 | 0,25 |  |
| D2 | Archivio: cartella di rete ed elenco | 0,50 | D1 | 2,25 | 2,75 | 2,50 | 3,00 | 0,25 |  |
| E1 | Export CSV e stampa | 0,25 | C6 | 2,75 | 3,00 | 2,75 | 3,00 | 0,00 | si |
| E2 | Assemblaggio in file singolo | 0,25 | C5, C6, D2, E1, C4, B5 | 3,00 | 3,25 | 3,00 | 3,25 | 0,00 | si |
| E3 | Istruzioni d uso | 0,25 | E2 | 3,25 | 3,50 | 3,25 | 3,50 | 0,00 | si |

Legenda: ES inizio al più presto, EF fine al più presto, LS inizio al più tardi, LF fine al
più tardi. Scorrimento è di quanto un'attività può slittare senza spostare la fine del
progetto. Durate in giornate/uomo.

## 2. Cammino critico

    A1 -> A2 -> B1 -> B2 -> B4 -> C6 -> E1 -> E2 -> E3

Lettura: la catena che determina la durata passa dal modello dati al motore di calcolo, e
da lì al pannello di confronto. Non passa dall'editor delle righe né dall'archivio, che
hanno entrambi scorrimento.

Conseguenza operativa, che è il motivo per cui si fa questa analisi: il motore di calcolo
dei gap (B4) e il pannello di confronto (C6) sono le attività dove un ritardo si trasferisce
integralmente sulla data di fine. Sono anche le due che contengono la logica più facile da
sbagliare (punti percentuali contro percentuale, scomposizione ricavo/costo). Vanno fatte
per prime e vanno testate, non provate a schermo.

| Metrica | Valore |
|---|---|
| Durata a parallelismo illimitato (lunghezza del cammino critico) | 3,50 gg |
| Durata a esecutore singolo (somma delle durate) | 7,50 gg |
| Attività con scorrimento | B3, B5, C1, C2, C3, C4, C5, D1, D2 |
| Attività opzionali fuori perimetro obbligatorio | F1 (waterfall e tornado), 0,75 gg |

## 3. Nota onesta sulle due durate

Con un solo sviluppatore la durata è la somma, 7,50 giornate: il parallelismo non esiste e
il cammino critico non accorcia nulla. I 3,50 giorni sono il limite teorico con risorse
illimitate, utile come metro di quanto il progetto sia comprimibile aggiungendo persone, non
come previsione.

Il valore pratico dell'analisi con un solo sviluppatore è un altro, ed è triplice:

1. Ordine di esecuzione. L'ordinamento topologico garantisce di non iniziare mai un'attività
   i cui presupposti non esistono ancora, che è la causa più comune di rilavorazione.
2. Priorità sotto pressione. Se il tempo si riduce, si taglia fra le attività con
   scorrimento, mai sul cammino critico.
3. Rilevazione di dipendenze nascoste. Costruire il grafo ha reso esplicito che il pannello
   di confronto dipende dal motore dei gap e non dall'interfaccia, il che ha invertito
   l'ordine rispetto alla prima stesura del piano.

## 4. Scostamento rispetto alla stima precedente

La proposta indicava 6 giornate con una scomposizione grossolana in sette fasi. La
scomposizione fine in diciotto attività somma 7,50 giornate. La differenza non è un
ripensamento: è l'effetto noto per cui una stima aggregata omette il lavoro che solo la
scomposizione rende visibile. La stima da usare è 7,50, e questo documento sostituisce la
sezione 6 della proposta.

## 5. Ordine di esecuzione adottato

    A1  struttura repo, README, scaffolding
    A2  modello dati e schema JSON
    B1  motore: costo per voce e normalizzazione
    B2  motore: aggregazioni, MdC, MI, break-even
    B3  motore: scostamenti componibili
    B4  motore: gap, punti percentuali, scomposizione
    B5  test unitari del motore
    C1  stile e impianto della maschera
    C2  editor righe
    C3  tre colonne e vista semplice/dettagliata
    C4  pannello parametri e tariffe orarie
    C5  pannello simulazione
    C6  pannello confronto e barra risultati
    D1  archivio: serializzazione, scarica/apri
    D2  archivio: cartella di rete ed elenco
    E1  export CSV e stampa
    E2  assemblaggio in file singolo
    E3  istruzioni d'uso

I test (B5) sono collocati dopo il motore e prima dell'interfaccia: verificare il calcolo a
schermo, dentro l'interfaccia, è il modo più lento e meno affidabile di accorgersi di un
errore di formula.

## 6. Struttura del repository

    src/calcolo.mjs     motore di calcolo puro, nessuna dipendenza dal DOM
    src/app.mjs         interfaccia
    src/archivio.mjs    persistenza: cartella di rete, browser, file
    src/stile.css       stile
    src/index.html      pagina di sviluppo, da servire su un'origine reale
    test/calcolo.test.js test del motore, eseguibili con: node --test
    tools/cpm.mjs       analisi del grafo delle attività
    tools/build.mjs     assemblaggio nel file singolo distribuibile
    dist/               file singolo prodotto, è ciò che si consegna
    docs/               proposta e piano

Sul perché esiste un passo di assemblaggio nonostante la promessa di non avere una fase di
build: una pagina aperta da cartella di rete ha origine opaca, e in quel contesto i moduli
JavaScript vengono bloccati dal browser. Tenere il codice in moduli separati serve a poterlo
testare; consegnare un file unico serve a poterlo aprire. `tools/build.mjs` concilia le due
cose in poche righe, senza alcuna dipendenza esterna: non è un toolchain, è una
concatenazione verificabile a vista.
