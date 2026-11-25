# Turni Ufficio

Web app per **generare, modificare e pubblicare i turni settimanali** dell'ufficio.

Come l'agenda è una pagina statica: aprendo `turni/index.html` funziona subito in **modalità locale**, con dati demo e un selettore per simulare i tre livelli di accesso. Collegando Supabase diventa **multi-utente**, con login e permessi applicati dal database.

## Flusso di lavoro

1. **Personale**: anagrafica dei colleghi con qualifica (DIR, COLL, OSP, SCF, SCFI, OFE, RGOZ, RCE…). L'elenco si può incollare da Excel con *Importa elenco*.
2. **Preparazione settimana**: per ogni collega e ogni giorno si imposta lo stato.
   - *Assenze*: ferie, permesso, malattia, corso, riposo. Chi è assente non viene inserito nei turni.
   - *Richieste personali*: mattina o pomeriggio.
   - *Esigenze aziendali*: turno imposto.
3. **Genera bozza**: l'algoritmo compila l'orario applicando le regole in ordine di priorità.
4. **Revisione**: un clic su una cella permette di cambiare turno o ruolo nel turno (es. un SCF che copre lo sportello conta come OSP) e di aggiungere una nota. Le celle modificate a mano sono segnate con ✎ e si possono conservare quando si rigenera. In alto compaiono gli avvisi: turni scoperti e richieste non soddisfatte.
5. **Pubblica**: da quel momento l'orario è visibile a tutti. Si può ritirare e ripubblicare.

## Calendario predefinito

| Turno | Lun–Ven | Sabato |
|---|---|---|
| Mattina | 08:00–14:10 | 08:00–13:10 |
| Pomeriggio | 13:30–19:40 | — |

Gli orari si modificano in *Regole → Calendario*.

## Regole di popolamento (modificabili dal Super user)

| # | Regola | Parametri |
|---|---|---|
| 1 | **Assenze**: chi è in ferie, permesso, malattia, corso o riposo non viene inserito | sempre attiva |
| 2 | **Esigenze aziendali**: turno imposto o corso | on/off |
| 3 | **Copertura minima** per qualifica e turno (predefinito: almeno 3 OSP in ogni turno, sabato compreso) | tabella dei minimi |
| 4 | **Richieste personali** | on/off, vincolanti sì/no |
| 5 | **Alternanza mattina/pomeriggio** rispetto alla settimana precedente | on/off, settimanale o giornaliera |
| 6 | **Sabato** (giorni a turno unico) | tutti i disponibili, oppure rotazione equa su N persone |
| 7 | **Bilanciamento** del numero di persone tra mattina e pomeriggio | on/off, differenza massima |

Per ogni qualifica si sceglie anche la **turnazione** (alternata, solo mattina, solo pomeriggio, esclusa dalla generazione) e il **livello di accesso** proposto.

## Livelli di accesso

| Azione | Utente | Admin | Super user |
|---|:-:|:-:|:-:|
| Vedere l'orario pubblicato | ✓ | ✓ | ✓ |
| Vedere le bozze, preparare la settimana, generare, modificare, pubblicare | | ✓ | ✓ |
| Gestire il personale | | ✓ | ✓ |
| Modificare regole, orari e qualifiche | | | ✓ |
| Abilitare utenti, backup | | | ✓ |

Qualifiche proposte: **Utente** per SCF, OSP, OFE, SCFI e RCE; **Admin** per DIR, COLL e RGOZ. Il livello **Super user** si assegna al singolo account.

Con il database condiviso i permessi sono applicati dalle regole di sicurezza del database:

- un Utente non riceve né le bozze né i dati di preparazione (ferie, malattie, richieste);
- un Utente non può scrivere nulla.

## Database condiviso (Supabase)

1. Su supabase.com, nello stesso progetto dell'agenda o in uno nuovo, apri **SQL Editor**. Incolla [`supabase/schema.sql`](supabase/schema.sql), sostituisci in fondo `tua-email@esempio.it` con la tua email (in minuscolo) ed esegui.
2. Copia *Project URL* e chiave *anon public* in [`config.js`](config.js).
3. Apri la pagina, scegli *Primo accesso? Crea l'account* con quella email e scegli se partire con i dati demo o con il solo personale vuoto.
4. In **Utenti** abilita le email dei colleghi assegnando il livello. Ognuno crea poi il proprio account. Se l'email è indicata anche nella scheda del collaboratore, la sua riga viene evidenziata nell'orario.

Pubblicazione: il workflow di GitHub Pages del repository pubblica questa app all'indirizzo `…/turni/`.
