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

| Colonna | Che cos'è | Da dove arriva il numero |
|---|---|---|
| Preventivo | marginalità stimata in fase di offerta | il PM la trascrive dall'offerta |
| KOM | budget concordato al kick off meeting | il PM la trascrive dal KOM |
| Simulato | scenario what-if corrente | derivata, mai digitata |

Vincolo di semplicità: le tre colonne si compilano in un'unica sessione di lavoro. Non
esiste un ciclo di vita, non esiste un congelamento con autorizzazione, non esiste un
obbligo di tornare ad aggiornarle. Preventivo e KOM sono numeri di riferimento che il PM
trascrive, non record da mantenere.

Regola di derivazione: gli scostamenti percentuali della simulazione si applicano alla
colonna KOM, che è il budget di cui il PM risponde. Se il KOM non c'è ancora, il simulato
deriva dal Preventivo e l'interfaccia lo dichiara.

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
tre istanze si sta compilando. Nessun congelamento, nessuna autorizzazione, nessun blocco
di modifica: il PM scrive dove vuole e quando vuole, la simulazione vale per la sessione in
corso e finisce nell'archivio così com'è.

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
| Colonna Preventivo opzionale | se l'offerta non è disponibile in forma analitica, si inserisce il solo totale di riga o il solo margine di offerta, e il confronto resta possibile al livello disponibile |
| Simulato sempre derivato | non si inserisce mai a mano: è KOM più scostamenti percentuali |
| Parti da una simulazione esistente | si apre una simulazione dall'archivio, si cambiano i numeri, si salva come nuova. Nessun template da mantenere |

## 4. Archivio delle simulazioni

Requisito: nessuna storicizzazione, nessun consuntivo da aggiornare nel tempo, solo un
archivio dove le simulazioni vengono salvate.

### 4.1 Cosa significa, in concreto

| Principio | Traduzione operativa |
|---|---|
| Istantanee, non record | ogni salvataggio crea una nuova voce di archivio, datata. Non si aggiorna una voce esistente |
| Nessun obbligo di ritorno | nessuna scadenza, nessun promemoria, nessun avanzamento da compilare. Una simulazione non "invecchia", resta valida come fotografia della data in cui è stata fatta |
| Nessun ciclo di vita | nessuno stato bozza/approvato/chiuso, nessuna autorizzazione, nessun workflow |
| Riaprire serve a ripartire | aprire una simulazione la ricarica nella maschera come punto di partenza; salvando si crea una nuova voce, l'originale resta intatto |
| Cancellare è libero | il PM elimina dall'archivio ciò che non gli serve, senza conseguenze |

Conseguenza sul modello: le colonne Preventivo e KOM perdono ogni apparato di congelamento
e autorizzazione descritto nelle versioni precedenti di questo documento. Sono campi di
input come gli altri.

### 4.2 Dove vive l'archivio: verifica tecnica, non opinione

La soluzione apparentemente ovvia (archivio nel browser, in localStorage) è stata scartata
sulla base di una verifica diretta, eseguita in Chromium su questo ambiente.

| Contesto | Origin | Secure context | localStorage | Selettore cartella | IndexedDB |
|---|---|---|---|---|---|
| pagina aperta da file (`file://`) | `null`, opaco | sì | funziona, ma isolato per singolo percorso del file | raggiungibile | disponibile |
| pagina servita da un'origine reale (`http://127.0.0.1`) | reale | sì | funziona | raggiungibile | disponibile |

Verifica eseguita con Chromium headless (build Playwright 1194): due file HTML nella stessa
cartella, aperti da percorso locale, vedono ciascuno esclusivamente la propria chiave di
localStorage. Lo storage è agganciato al percorso esatto del file.

Implicazione pratica, che è il motivo dello scarto: se il file HTML viene spostato,
rinominato o copiato in un'altra cartella di rete, l'archivio delle simulazioni non è più
raggiungibile. Su una cartella condivisa aziendale, dove i file vengono riorganizzati, è
questione di tempo. Si aggiunge che la cancellazione dei dati di navigazione del browser
cancella l'archivio senza preavviso, e che Firefox blocca del tutto localStorage sulle
pagine aperte da file locale.

Nota di metodo: la verifica è stata condotta in modalità headless. È attendibile sul
comportamento dello storage, che dipende dal motore; una conferma sul browser realmente in
uso in azienda va fatta durante il pilota, non prima.

### 4.3 Soluzione proposta: una cartella di rete, un file per simulazione

| Elemento | Scelta |
|---|---|
| Unità di archivio | un file JSON per simulazione |
| Nome file | generato: `codicecommessa_AAAA-MM-GG_hhmm.json` |
| Collocazione | una cartella di rete aziendale scelta una volta dall'utente |
| Lettura dell'elenco | la maschera legge la cartella e mostra l'elenco con commessa, cliente, data, margine simulato |
| Tecnologia | File System Access API (selettore di cartella), disponibile su Chrome ed Edge desktop dalla versione 86 |
| Fallback universale | pulsanti Scarica e Apri file, funzionanti su qualsiasi browser, senza elenco automatico |
| localStorage | usato solo per il salvataggio automatico del lavoro in corso, come recupero da chiusura accidentale. Dichiaratamente temporaneo, mai come archivio |

Perché questa soluzione regge il requisito: l'archivio è composto da file ordinari su una
share aziendale. Sopravvive alla pulizia del browser, è visibile da Esplora risorse, è
incluso nel backup aziendale esistente, è condivisibile fra PM allegandolo a una mail, e
non richiede alcun server, database o account.

Limite dichiarato: il selettore di cartella non è supportato da Firefox e Safari, che
espongono solo lo storage privato dell'origine e non i selettori su disco. Su quei browser
resta il fallback Scarica/Apri, che funziona ma senza elenco automatico. Se il browser
standard aziendale è Edge o Chrome il limite è teorico; va confermato.

### 4.4 Opzioni scartate, con motivo

| Opzione | Motivo dello scarto |
|---|---|
| Archivio in localStorage | agganciato al percorso del file, cancellabile dalla pulizia del browser, non condivisibile, bloccato da Firefox su file locale (verificato) |
| Database e backend | contraddice il requisito: introduce hosting, backup, account, manutenzione. Nessuna esigenza del tool lo giustifica |
| Foglio Excel condiviso come archivio | conflitti di scrittura simultanea, versioni divergenti, formule modificabili per errore |
| Integrazione con il gestionale | è esattamente la storicizzazione che il requisito esclude |

## 5. Architettura applicativa

| Opzione | Pro | Contro | Effort v1 |
|---|---|---|---|
| A. Pagina HTML singola, nessun server (raccomandata) | zero infrastruttura, zero IT ops, nessun account, apribile da cartella di rete | il selettore di cartella richiede Chrome o Edge | 5-6 gg/uomo |
| B. Pagina servita da un'origine interna | storage più solido, nessuna dipendenza dal percorso del file | richiede un web server interno e un referente IT | piu' 1-2 gg |
| C. Template Excel | familiare, zero adozione | versioni divergenti, formule rotte, nessun controllo | 2-3 gg/uomo |

Raccomandazione: A. L'opzione B diventa sensata solo se durante il pilota emergono
problemi di storage, ed è un cambio di distribuzione, non di applicazione: lo stesso file
servito da un'origine reale invece che aperto da cartella.

Nota su C: Excel non viene scartato perché inadeguato al calcolo, ma perché su più PM il
file si moltiplica in varianti non allineate e il confronto fra commesse diventa
impossibile.

### 5.1 Stack tecnico

- Pagina HTML singola, JavaScript senza framework e senza fase di build.
- Motore di calcolo isolato in un modulo puro, con test unitari (test runner nativo di
  Node, nessuna dipendenza esterna).
- Grafici in SVG generato a runtime, nessuna libreria di terze parti.
- Archivio: file JSON in cartella di rete, con fallback Scarica/Apri.
- Export: CSV per il controllo di gestione, stampa in PDF tramite il browser.

Motivazione: nessuna dipendenza da aggiornare, nessun build da mantenere, il file
sopravvive agli anni. Il prezzo è maggiore disciplina nella scrittura del codice, che si
paga isolando il motore di calcolo e testandolo.

## 6. Piano di lavoro

| Fase | Contenuto | Deliverable | Effort |
|---|---|---|---|
| 1 | Motore di calcolo e test | modulo calcolo + suite di test | 1 gg |
| 2 | Maschera unica: testata, tre colonne, righe editabili, vista semplice e dettagliata | schermata funzionante | 2 gg |
| 3 | Simulazione per scostamenti percentuali componibili | pannello simulazione | 0,5 gg |
| 4 | Confronto: tabella a tre colonne, due gap, euro / % / punti percentuali, break-even | riepilogo decisionale | 1 gg |
| 5 | Archivio: salvataggio, elenco, riapertura, fallback | archivio su cartella | 1 gg |
| 6 | Export CSV e stampa | reportistica | 0,5 gg |
| 7 | Pilota su 2 commesse reali con 2 PM | versione tarata + una pagina di istruzioni | 1 settimana di calendario |
| opz. | Waterfall del margine e tornado chart | grafici | 1 gg |

Totale: 6 giornate/uomo, 5 senza i grafici opzionali, più una settimana di calendario per
il pilota.

Rispetto alla versione precedente del piano il totale scende da 6,5-7,5 a 6 giornate. La
riduzione viene dalle funzioni eliminate in nome della semplicità, elencate sotto.

### 6.1 Eliminato per rispettare il requisito di semplicità

| Funzione tolta | Perché |
|---|---|
| Congelamento colonne con sblocco autorizzato | è governance, non simulazione |
| Gestore di scenari Base/Best/Worst nell'applicazione | con l'archivio bastano tre simulazioni salvate |
| Import CSV dal gestionale | è l'anticamera dell'integrazione e della storicizzazione |
| Marcatore delle righe modificate rispetto alla colonna di origine | utile in un budget vivo, inutile in una fotografia |
| Waterfall e tornado in versione 1 | ottimi in riunione, non necessari per simulare. Restano opzionali |

## 7. Decisioni

### 7.1 Confermate

| # | Decisione | Scelta |
|---|---|---|
| 1 | Definizione di margine | Margine di contribuzione e margine industriale a cascata |
| 2 | Ricavo | Ripartito per linea di servizio, con ricavo proprio per ciascuna delle tre colonne |
| 3 | Perimetro costi v1 | Materiale, Manodopera, Altri costi diretti |
| 4 | Persistenza | Nessun backend. Archivio come file JSON in cartella di rete |
| 5 | Confronto | Tre colonne Preventivo / KOM / Simulato, in euro, in percentuale di marginalità e in punti percentuali |
| 6 | Uso | Estemporaneo. Nessuna storicizzazione, nessun consuntivo, nessun ciclo di vita |

### 7.2 Aperte

| # | Punto aperto | Assunzione adottata | Impatto se sbagliata |
|---|---|---|---|
| 7 | Browser standard aziendale | Edge o Chrome desktop, quindi selettore di cartella disponibile | su Firefox o Safari resta il fallback Scarica/Apri, senza elenco automatico. Nessun impatto sul calcolo |
| 8 | Percorso della cartella di rete per l'archivio | scelto dall'utente al primo uso | nessuno |
| 9 | Tariffe orarie per tipo di manodopera | campi parametrici, precompilati con segnaposto visibilmente marcati da sostituire | nessun impatto strutturale, impatto totale sull'attendibilità. È il rischio numero uno |
| 10 | Percentuale di spese generali e sua base | parametro in schermata, applicato sui costi diretti, default vuoto | cambia una formula e un'etichetta se la base aziendale è il ricavo |
| 11 | Tipo di contratto prevalente | a corpo, ricavo di linea fisso durante la simulazione | se prevale il contratto a misura serve un interruttore per linea, mezza giornata |
| 12 | Disponibilità del preventivo in forma analitica | colonna Preventivo compilabile anche in forma aggregata | il gap Preventivo verso KOM resta calcolabile ma non scomponibile per linea |

Nessuno di questi punti blocca la fase 1.

## 8. Rischi

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Tariffe orarie non aggiornate o non condivise | il tool produce margini falsi e perde credibilità al primo confronto con il consuntivo | tariffe visibili in schermata con data di validità, responsabile nominato |
| Archivio perso per spostamento del file o pulizia del browser | perdita delle simulazioni salvate | archivio su cartella di rete, non nel browser. È la ragione della scelta in sezione 4 |
| Deriva verso un gestionale di commessa | complessità, costi, sovrapposizione con l'ERP | perimetro dichiarato in sezione 9 e funzioni già eliminate in sezione 6.1 |
| Dati di marginalità in file circolanti | informazione commerciale sensibile fuori controllo | cartella di rete con i permessi aziendali già in essere, nessun invio a servizi esterni |
| Confusione fra punti percentuali e percentuale | letture sbagliate in riunione | etichette esplicite e le tre variazioni sempre mostrate insieme, sezione 2.7 |
| Il PM lo usa una volta e torna a Excel | investimento sprecato | pilota su commesse vere, nessun doppio inserimento, nessun obbligo di aggiornamento |

## 9. Fuori perimetro

- Consuntivazione ore, avanzamento lavori, SAL. Non esiste una colonna Consuntivo o EAC: il
  simulato è una stima del PM, non un dato di contabilità di commessa.
- Storicizzazione e confronto nel tempo della stessa commessa.
- Fatturazione, gestione fornitori, ordini.
- Integrazione con ERP o gestionale.
- Multi-valuta con cambio dinamico.
- Autenticazione, profilazione utenti, workflow di approvazione.

## 10. Fonti

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

Comportamento del browser (verificato in questo ambiente e confrontato con la documentazione):
- File System API, supporto e selettori su disco — https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- showDirectoryPicker, metodo e compatibilità — https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- File System Access API, Chrome for Developers — https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- localStorage e origini opache — https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- Firefox, localStorage non disponibile su documenti file:// — https://bugzilla.mozilla.org/show_bug.cgi?id=507361

Analisi di sensitività:
- Praxis Framework, Analisi della sensibilità — https://www.praxisframework.org/it/library/sensitivity-analysis
- Università di Padova, Analisi di sensitività — https://static.gest.unipd.it/labtesi/eb-didattica/EAI/sensitivita.pdf
