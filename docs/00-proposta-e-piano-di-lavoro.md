# Simulatore Margine di Commessa — Proposta e Piano di Lavoro

Contesto: Righi Solutions (Righi Elettroservizi S.p.A.) — commesse di impiantistica e
automazione industriale articolate su quadri elettrici, installazione in cantiere e
commissioning.

Stato: proposta da approvare. Nessuna riga di codice applicativo è stata scritta.
Data: 2026-09-18

---

## 1. Premessa critica: cosa manca nella richiesta

Prima del piano, quattro punti che vanno chiusi perché cambiano la struttura del tool.

### 1.1 Senza il ricavo non esiste un margine

La richiesta elenca solo variabili di costo (materiale, manodopera per tipo di servizio).
Il margine è per definizione una differenza tra ricavi e costi: senza un valore di vendita
in input il tool calcola un preventivo di costo, non un margine.

Serve quindi almeno un campo ricavo. Decisione da prendere: ricavo unico di commessa
oppure ricavo ripartito per linea di servizio. La seconda opzione è più onerosa in
inserimento ma è l'unica che permette di rispondere alla domanda che interessa davvero al
PM: quale delle tre linee sta erodendo il margine.

Secondo punto correlato: il ricavo è fisso (contratto a corpo) o varia con le quantità
(contratto a misura o a economia)? Nel secondo caso una variazione di ore non peggiora il
margine nello stesso modo, e il modello deve saperlo.

### 1.2 "Margine" è ambiguo e va congelato in una definizione

Due ambiguità distinte:

a) Margine o ricarico. Il margine si calcola sul prezzo di vendita, il ricarico (markup)
sul costo. Le due grandezze non coincidono e la confusione è l'errore di pricing più
diffuso: un ricarico del 30% corrisponde a un margine del 23%, non del 30%.
Formule: Margine% = (Prezzo - Costo) / Prezzo; Ricarico% = (Prezzo - Costo) / Costo;
conversione Margine = Ricarico / (1 + Ricarico).

b) Quale livello di margine. Margine di contribuzione (ricavi meno costi diretti della
commessa) oppure margine industriale (dopo l'attribuzione di spese generali e struttura).
Il primo è il KPI corretto per le decisioni di commessa; il secondo è quello che si
confronta con il budget aziendale.

Proposta: esporre entrambi a cascata nella stessa schermata, con le spese generali come
percentuale parametrica e dichiarata. Il PM vede il margine di contribuzione come leva
operativa e il margine industriale come verifica.

### 1.3 Materiale e manodopera non coprono il costo di una commessa Righi

Su installazione in cantiere e commissioning, in particolare fuori sede e all'estero,
esistono voci che pesano quanto la manodopera e che il PM controlla direttamente:
trasferte e viaggi, vitto e alloggio, noleggi (piattaforme, ponteggi, mezzi), trasporti e
logistica del quadro, subappalti e terzisti, collaudi e certificazioni, penali.

Escluderle rende la simulazione ottimistica in modo sistematico. Proposta: terza categoria
di costo "Altri costi diretti" presente dalla versione 1, con righe libere. Il PM che non
la usa la lascia a zero, non costa nulla.

### 1.4 La manodopera va inserita in ore, non in euro

Se il PM inserisce un importo in euro non può simulare lo scenario che gli serve davvero
("cosa succede se il cantiere sfora di 200 ore"). Ore per tariffa oraria è l'unica forma
che rende la leva utilizzabile.

Conseguenza: servono le tariffe orarie aziendali (costo orario pieno, non prezzo di
vendita) per tipo di manodopera, da controllo di gestione, configurabili e con data di
validità. Sono il parametro che determina l'attendibilità di tutto il modello.

---

## 2. Modello di calcolo proposto

### 2.1 Struttura dati a quattro livelli

| Livello | Elemento | Default | Modificabile |
|---|---|---|---|
| 0 | Commessa | codice, cliente, descrizione, valuta, data | sì |
| 1 | Linea di servizio | Quadri elettrici, Installazione cantiere, Commissioning | aggiungibile/rimovibile |
| 2 | Categoria di costo | Materiale, Manodopera, Altri costi diretti | fissa (scheletro) |
| 3 | Voce | righe preimpostate per categoria | aggiungibile/rimovibile/rinominabile |

Scelta di progetto: lo scheletro (livelli 1 e 2) è fisso, le righe (livello 3) sono libere.
Motivo: se tutto è libero si perde la confrontabilità tra commesse e non si può consolidare
nulla; se tutto è fisso il tool non serve. Il vincolo è sul contenitore, non sul contenuto.

### 2.2 Voci preimpostate

| Categoria | Voci di default | Campi di input |
|---|---|---|
| Materiale | ABB, Siemens, Schneider, Rittal, Phoenix Contact, Cavi, Carpenteria, Minuteria, Altro | importo di listino, sconto %, oppure costo netto |
| Manodopera | Produzione/cablaggio, Ingegneria elettrica, Ingegneria software, Montaggio cantiere, Messa in servizio, Project management | ore, tariffa €/h |
| Altri costi diretti | Trasferte e viaggi, Vitto e alloggio, Noleggi, Trasporti, Subappalti, Collaudi e certificazioni | importo |

Le voci Materiale sono neutre rispetto alla marca: l'elenco sopra è un default editabile,
non una lista chiusa.

### 2.3 Formule

Voce di costo:

    costo_voce = quantita x prezzo_unitario x (1 - sconto)

dove per la manodopera quantita = ore e prezzo_unitario = costo orario aziendale.

Aggregazioni:

    CD_linea  = somma dei costi delle voci della linea
    MdC_linea = Ricavo_linea - CD_linea
    MdC%_linea = MdC_linea / Ricavo_linea

    CD  = somma CD_linea
    R   = somma Ricavo_linea
    SG  = alfa x CD            (spese generali, alfa parametrico)
    CTG = gamma x CD           (contingency/rischio, gamma parametrico)

    Margine industriale  MI  = R - CD - SG - CTG
    Margine industriale% MI% = MI / R

Break-even rispetto al margine obiettivo m*:

    CD_max  = R x (1 - m*) / (1 + alfa + gamma)
    riserva = CD_max - CD
    riserva% = riserva / CD

Lettura per il PM: "posso sforare i costi del X% prima di scendere sotto il margine
obiettivo".

### 2.4 Meccanismo di simulazione

Il PM inserisce il baseline una sola volta (budget di commessa). La simulazione non avviene
riscrivendo i numeri, ma applicando scostamenti percentuali su più livelli, che si
compongono in modo moltiplicativo dal generale al particolare:

    costo_simulato = costo_base x (1 + d_globale) x (1 + d_linea) x (1 + d_categoria) x (1 + d_voce)

Questo è il cuore del tool: il baseline resta intatto e sempre confrontabile, e il PM
ragiona per leve ("materiale quadri +8%", "ore cantiere +15%") invece che per importi.

### 2.5 I tre baseline a confronto

Il modello non ha un solo baseline ma tre istanze della stessa struttura dati, confrontate
affiancate:

| Colonna | Che cos'e' | Chi la inserisce | Quando si congela |
|---|---|---|---|
| Preventivo | marginalita' stimata in fase di offerta | commerciale / ufficio preventivi | alla presentazione dell'offerta |
| KOM | budget esecutivo concordato al kick off meeting, dopo acquisizione ordine | PM con controllo di gestione | al KOM, e non si tocca piu' |
| Simulato | scenario what-if corrente | PM, in autonomia | mai, e' lo scenario di lavoro |

Regola di derivazione: gli scostamenti percentuali della simulazione si applicano alla
colonna KOM, che e' il budget di cui il PM risponde. Se il KOM non e' ancora stato fatto,
il simulato deriva dal Preventivo e l'interfaccia lo dichiara esplicitamente.

Le colonne Preventivo e KOM hanno ciascuna il proprio ricavo, non solo i propri costi. E'
un punto non negoziabile: fra offerta e ordine il prezzo cambia quasi sempre (sconto di
chiusura, varianti, revisione perimetro). Se si forzasse un ricavo unico, una perdita di
margine dovuta a una concessione di prezzo verrebbe attribuita ai costi, e il PM
inseguirebbe un problema che non esiste.

### 2.6 I due gap, che rispondono a domande diverse

| Gap | Formula | Domanda a cui risponde | Chi ne risponde |
|---|---|---|---|
| Preventivo → KOM | erosione gia' avvenuta prima di iniziare i lavori | quanto margine abbiamo perso in trattativa e in ridefinizione del perimetro | commerciale e direzione |
| KOM → Simulato | erosione prospettica in esecuzione | dove sta andando la commessa rispetto al budget di cui rispondo | PM |

Tenerli separati e' il motivo per cui servono tre colonne e non due. Un tool che mostra solo
"preventivo contro attuale" fa apparire il PM responsabile di uno sconto commerciale deciso
prima che la commessa esistesse.

### 2.7 Confronto in valore assoluto e in percentuale: due percentuali diverse

Avvertenza di calcolo. "Confronto in percentuale" ha due significati distinti e non
intercambiabili. Vanno mostrati entrambi, con etichette esplicite:

| Grandezza | Formula | Unita' | Lettura |
|---|---|---|---|
| Margine assoluto | MdC in euro per colonna | euro | quanto margine c'e' |
| Marginalita' | MdC / Ricavo della stessa colonna | % | quanto e' redditizia la commessa |
| Variazione assoluta | MdC_b - MdC_a | euro | quanti euro di margine si sono persi |
| Variazione della marginalita' | MdC%_b - MdC%_a | punti percentuali (p.p.) | di quanto e' peggiorata la redditivita' |
| Variazione relativa del margine | (MdC_b - MdC_a) / MdC_a | % | quanta parte del margine si e' bruciata |

Esempio numerico per fissare la differenza. Preventivo: ricavo 1.000.000, MdC 180.000,
marginalita' 18,0%. KOM: ricavo 960.000, MdC 134.400, marginalita' 14,0%.
Variazione assoluta -45.600 euro; variazione della marginalita' -4,0 p.p.; variazione
relativa del margine -25,3%. Sono tre numeri corretti e diversi che descrivono lo stesso
fatto: presentarne uno solo, o confondere p.p. con %, e' l'errore da cui questo tool deve
proteggere.

### 2.8 Scomposizione del gap: effetto prezzo ed effetto costo

Poiche' ricavo e costi cambiano entrambi fra una colonna e l'altra, il confronto mostra da
dove nasce lo scostamento del margine assoluto:

    delta MdC = (R_b - R_a) - (CD_b - CD_a)
                 effetto ricavo    effetto costo

L'effetto costo viene ulteriormente scomposto per linea di servizio e per categoria
(materiale, manodopera, altri), in modo che la somma dei contributi quadri con il totale.
Rappresentazione: grafico a cascata (waterfall) da Margine preventivo a Margine KOM a
Margine simulato.

### 2.9 Output

| Output | Contenuto | A cosa serve |
|---|---|---|
| Riepilogo | Ricavo, costi, MdC euro e %, MI %, per linea e totale | fotografia |
| Confronto a tre colonne | Preventivo / KOM / Simulato, con i due gap, in euro, in % e in punti percentuali | il confronto richiesto, cuore del tool |
| Waterfall del margine | cascata da Preventivo a KOM a Simulato, scomposta in effetto ricavo ed effetto costo per linea e categoria | capire da dove nasce lo scostamento |
| Semaforo | scostamento dal margine obiettivo | allerta |
| Break-even | riserva di costo residua in euro e % | negoziazione |
| Tornado chart | impatto sul margine di una variazione di +/- X% su ogni driver, ordinato per effetto | capire dove guardare |
| Scenari salvati | Simulato Base, Best, Worst, confrontabili contro Preventivo e KOM | riunione di avanzamento |

Il tornado chart risponde alla domanda operativa: fra tutte le variabili, quale mi fa più
male se sbaglio la stima. È lo strumento standard per questo tipo di analisi.

---

## 3. Interfaccia

Requisito dichiarato: semplice, intuitiva, senza sovrastruttura. Traduzione operativa:
nessun login, nessuna installazione, nessun database da amministrare, una schermata sola.

### 3.1 Layout

Schermata unica con quattro zone:

1. Testata: dati commessa, ricavo per linea, parametri globali (spese generali %,
   contingency %, margine obiettivo %).
2. Corpo: un blocco per linea di servizio, dentro tre sottoblocchi (Materiale, Manodopera,
   Altri). Righe editabili, pulsante per aggiungere riga, icona per rimuoverla, nome riga
   rinominabile in linea.
3. Barra risultati fissa in basso, sempre visibile durante l'inserimento: Ricavo, Costi,
   MdC euro, MdC %, MI %, semaforo.
4. Pannello simulazione: slider per driver, tornado chart, scenari salvati.
5. Pannello confronto: le tre colonne Preventivo / KOM / Simulato affiancate, con i due gap
   in euro, in percentuale e in punti percentuali, e il waterfall del margine.

Selettore di colonna attiva in testata (Preventivo, KOM, Simulato): determina quale delle
tre istanze si sta compilando. Preventivo e KOM, una volta congelati, diventano di sola
lettura con uno sblocco esplicito, per evitare che il budget di riferimento venga
riscritto a posteriori.

### 3.2 Vista semplice e vista dettagliata

Un interruttore, stesso modello dati sotto.

| Vista | Cosa mostra | Quando si usa |
|---|---|---|
| Semplice | 9 caselle (3 linee x 3 categorie), un importo per casella | offerta, stima rapida, riunione |
| Dettagliata | righe per marca fornitore e per tipo di manodopera | budget esecutivo, analisi scostamenti |

Regola di coerenza: la vista semplice mostra la somma delle righe di dettaglio. Se esistono
righe di dettaglio la casella aggregata diventa di sola lettura e si può agire solo tramite
scostamento percentuale, per evitare incoerenze tra i due livelli.

---

### 3.3 Come si popolano tre colonne senza triplicare il lavoro di inserimento

Il rischio dell'aggiunta delle tre colonne e' che il PM debba inserire tre volte la stessa
struttura. Mitigazioni previste:

| Meccanismo | Effetto |
|---|---|
| Duplica colonna | il KOM nasce come copia del Preventivo, il PM modifica solo le righe cambiate |
| Evidenza delle righe modificate | marcatore sulle sole voci che differiscono dalla colonna di origine |
| Colonna Preventivo opzionale | se l'offerta non e' disponibile in forma analitica, si inserisce il solo totale di riga o il solo margine di offerta, e il confronto resta possibile al livello disponibile |
| Simulato sempre derivato | non si inserisce mai a mano: e' KOM piu' scostamenti percentuali |

## 4. Architettura: opzioni a confronto

| Opzione | Descrizione | Pro | Contro | Effort v1 |
|---|---|---|---|---|
| A. Web app statica (raccomandata) | HTML+JS autoconsistente, nessun server; salvataggio su file JSON, link condivisibile, export Excel | zero infrastruttura, zero IT ops, nessun dato personale su server, funziona anche offline | nessun consolidamento automatico tra commesse, nessuno storico centrale | 5-6 gg/uomo |
| B. Web app + backend leggero | come A più database condiviso e archivio commesse | storico, confronto tra commesse, accesso multiutente | richiede hosting, backup, gestione accessi, referente IT | 12-15 gg/uomo |
| C. Template Excel | foglio strutturato con scenari | familiare, zero adozione | versioni divergenti, formule rotte, nessun controllo, difficile da aggiornare | 2-3 gg/uomo |
| D. Integrazione ERP/gestionale | lettura diretta dei consuntivi | dati reali, nessun reinserimento | dipende dal gestionale in uso, tempi e costi di un ordine di grandezza superiori | da valutare |

Raccomandazione: partire da A. Il valore del tool sta nel ragionamento what-if, non
nell'archiviazione. L'opzione B ha senso come fase 2, solo se il pilota dimostra che i PM
lo usano davvero. L'opzione D va valutata separatamente e solo dopo aver chiarito quale
gestionale alimenta oggi il budget di commessa.

Nota su C: è l'alternativa onesta da considerare. Viene scartata non perché Excel non sia
adeguato al calcolo, ma perché su una popolazione di più PM il file si moltiplica in varianti
non allineate e il confronto tra commesse diventa impossibile.

### 4.1 Stack tecnico per l'opzione A

- Pagina HTML singola, JavaScript senza framework e senza build step.
- Motore di calcolo isolato in un modulo puro, con test unitari (test runner nativo di
  Node, nessuna dipendenza esterna).
- Grafici in SVG generato a runtime, nessuna libreria di terze parti.
- Persistenza: localStorage del browser per il lavoro in corso, export/import JSON per
  archiviare e scambiare, export CSV/Excel per il controllo di gestione.
- Distribuzione: file singolo apribile da cartella di rete, oppure pagina interna.

Motivazione: nessuna dipendenza da aggiornare, nessun rischio di rottura del build, il file
sopravvive agli anni. Il prezzo è una maggiore disciplina nella scrittura del codice, che
si paga isolando il motore di calcolo e testandolo.

---

## 5. Piano di lavoro

| Fase | Contenuto | Deliverable | Effort | Blocco |
|---|---|---|---|---|
| 0 | Allineamento: definizione di margine, perimetro costi, tariffe orarie, fonte del baseline | documento di specifica confermato | 0,5 gg | richiede risposte dal committente |
| 1 | Motore di calcolo e test | modulo calcolo + suite di test | 1 gg | dipende da fase 0 |
| 2 | Interfaccia di inserimento, vista semplice e dettagliata | schermata funzionante | 1,5 gg | |
| 3 | Gestione delle tre colonne Preventivo / KOM / Simulato, duplica colonna, congelamento | modello a tre istanze | 1 gg | |
| 4 | Simulatore: scostamenti percentuali componibili, scenari Base/Best/Worst | pannello simulazione | 1 gg | |
| 5 | Confronto e scomposizione: tabella a tre colonne con i due gap, waterfall, tornado, break-even, export | reportistica | 1,5 gg | |
| 6 | Personalizzazione voci, salvataggio, condivisione | gestione righe e persistenza | 0,5-1 gg | |
| 7 | Pilota su 2 commesse reali con 2 PM, taratura | versione tarata + note d'uso | 1 settimana di calendario | richiede disponibilità PM |

Totale sviluppo: 6,5-7,5 giornate/uomo, più una settimana di calendario per il pilota.
La stima non include eventuale integrazione con il gestionale.

Ordine di priorità se il tempo si riduce: fasi 1, 2, 3 e la sola tabella di confronto della
fase 5 sono il minimo utilizzabile; la fase 4 è ciò che distingue un simulatore da un
foglio di calcolo; waterfall, tornado e fase 6 sono rifinitura.

---

## 6. Decisioni

### 6.1 Confermate (2026-09-18)

| # | Decisione | Scelta | Conseguenza sul modello |
|---|---|---|---|
| 1 | Definizione di margine | Entrambi a cascata | Il calcolo espone Margine di contribuzione (R - CD) e, sotto, Margine industriale (R - CD - SG - CTG). Due righe di risultato, una sola schermata |
| 2 | Ricavo | Ripartito per linea di servizio | Ogni linea ha il proprio campo ricavo e il proprio MdC%. Il totale commessa e' la somma |
| 3 | Perimetro costi v1 | Include "Altri costi diretti" | Tre categorie per linea: Materiale, Manodopera, Altri costi diretti. Chi non la usa la lascia a zero |
| 4 | Persistenza dati | Solo browser piu' file | Nessun backend, nessun login. localStorage per il lavoro in corso, export/import JSON, export CSV/Excel. Architettura opzione A |
| 5 | Confronto richiesto | Tre colonne: Preventivo, KOM, Simulato | Il modello dati diventa tre istanze della stessa struttura. Confronto in euro, in % di marginalita' e in punti percentuali, piu' scomposizione effetto ricavo / effetto costo. Effort v1: piu' 1 gg |

### 6.2 Aperte, con assunzione adottata in attesa di risposta

Nessuna di queste blocca lo sviluppo: sono tutte parametriche e modificabili in schermata.
Le assunzioni sono dichiarate qui per essere smentite, non per essere date per buone.

| # | Punto aperto | Assunzione adottata in v1 | Cosa cambia se l'assunzione e' sbagliata |
|---|---|---|---|
| 5 | Tipo di contratto prevalente | Contratto a corpo: il ricavo di linea resta fisso durante la simulazione | Se prevale il contratto a misura serve un interruttore per linea che leghi il ricavo alle quantita'. Impatto: mezza giornata, da prevedere in fase 3 |
| 6 | Tariffe orarie per tipo di manodopera | Campi parametrici in schermata, precompilati con valori segnaposto visibilmente marcati come da sostituire. Nessun valore inventato e' trattato come reale | Nessun impatto strutturale. Impatto sull'attendibilita' dei risultati: totale. E' il rischio numero uno del progetto |
| 7 | Percentuale spese generali e sua base | Parametro in schermata, applicato sui costi diretti, default vuoto e non precompilato | Se la base aziendale e' il ricavo e non i costi diretti, cambia una formula e l'etichetta. Impatto: trascurabile se deciso prima della fase 1 |
| 8 | Origine del budget di commessa (preventivo commerciale, gestionale, foglio del PM) | Inserimento manuale del baseline, piu' import da CSV con mappatura colonne | Se esiste un export strutturato dal gestionale, l'import va tarato su quel tracciato. Impatto: da mezza a una giornata in fase 5 |
| 9 | Numero di PM utilizzatori e necessita' di confronto fra commesse | Uso individuale, nessun consolidamento | Se serve confronto storico fra commesse si passa all'opzione architetturale B, valutata dopo il pilota |
| 10 | Disponibilita' del preventivo in forma analitica per linea e categoria | Colonna Preventivo compilabile a livello aggregato se il dettaglio non esiste | Se il preventivo e' disponibile solo come margine complessivo, il gap Preventivo → KOM resta calcolabile ma non scomponibile per linea |
| 11 | Chi congela il KOM e con quale autorita' | Congelamento lato PM, con sblocco esplicito e tracciato in locale | Se il congelamento deve essere validato dal controllo di gestione serve un flusso di approvazione, che implica l'opzione architetturale B |

## 7. Rischi

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Tariffe orarie non aggiornate o non condivise | il tool produce margini falsi e perde credibilità al primo confronto con il consuntivo | tariffe centralizzate, data di validità visibile in schermata, responsabile nominato |
| Il PM lo usa una volta e torna a Excel | investimento sprecato | pilota su commesse vere prima del rilascio, import del budget esistente, nessun doppio inserimento |
| Deriva funzionale verso un gestionale di commessa | complessità, costi, sovrapposizione con l'ERP | perimetro dichiarato: simulatore di scenari, non sistema di consuntivazione |
| Dati di commessa e marginalità in file circolanti | informazione commerciale sensibile fuori controllo | file locali e non pubblici, nessun invio a servizi esterni, decisione esplicita sulla collocazione |
| Confusione margine/ricarico nell'uso quotidiano | decisioni di pricing sbagliate | etichette esplicite in interfaccia e conversione mostrata a fianco |

---

## 8. Fuori perimetro (versione 1)

- Consuntivazione ore e avanzamento lavori. Di conseguenza non esiste una quarta colonna
  "Consuntivo" o "EAC": il simulato è una stima del PM, non un dato di contabilità di
  commessa. È l'estensione naturale del tool ed è l'unica che richiederebbe l'integrazione
  con il gestionale.
- Fatturazione, SAL, stati avanzamento.
- Gestione fornitori e ordini.
- Integrazione con ERP o gestionale.
- Multi-valuta con cambio dinamico.
- Autenticazione e profilazione utenti.

---

## 9. Fonti

Contesto aziendale:
- Righi Elettroservizi S.p.A. / Righi Solutions — https://it.linkedin.com/company/righi-elettroservizi-spa
- Righi Solutions, Impianti industriali — https://www.righisolutions.com/soluzioni/impianti-industriali/
- ANIE Automazione, scheda azienda Righi Elettroservizi — https://anieautomazione.anie.it/scheda-azienda/4751/righi-elettroservizi-spa

Margine di commessa e controllo di gestione:
- Il margine di contribuzione nelle aziende di commessa — https://www.cruscottodicontrollo.it/il-margine-di-contribuzione-analisi-comparativa-tra-aziende-di-commercio-produzione-e-commessa/
- Margine di contribuzione e consuntivo nelle commesse — https://edigit.it/blog/produttivita/margine-di-contribuzione-e-consuntivo-misurare-la-redditivita-delle-commesse
- Controllo di gestione per produzione su commessa — https://www.studiocortelli.com/controllo-di-gestione/controllo-gestione-produzione-su-commessa-pmi.html

Margine e ricarico:
- Margine o markup, differenza e formule — https://help.progestnow.com/article/margine-o-markup-differenza-e-formule/
- Margine: calcolo e tipologie — https://farenumeri.it/margine-calcolo-e-tipologie/

Analisi di sensitività:
- Praxis Framework, Analisi della sensibilità — https://www.praxisframework.org/it/library/sensitivity-analysis
- Università di Padova, Analisi di sensitività — https://static.gest.unipd.it/labtesi/eb-didattica/EAI/sensitivita.pdf
