# Agenda Ristorante

Web app per gestire **prenotazioni, eventi e disponibilità** di un ristorante, con composizione dei menu, intolleranze, servizi aggiuntivi, formula di servizio (servito / buffet) e intrattenimento (musica, DJ, karaoke…).

Nessuna installazione: è una pagina statica (HTML + CSS + JavaScript). Funziona in due modalità:

- **locale**: i dati restano nel browser del dispositivo (nessuna configurazione);
- **condivisa**: i dati stanno in un database online con login riservato allo staff e aggiornamenti in tempo reale (vedi sotto).

## Avvio

- Apri `index.html` nel browser, **oppure**
- pubblicala con GitHub Pages (Settings → Pages → branch e cartella root), **oppure**
- in locale: `python3 -m http.server` e vai su http://localhost:8000

Al primo avvio l'agenda è vuota, con una sala e i turni standard: imposta sale, turni, piatti, menu e servizi dalle rispettive sezioni (i dati demo si possono caricare da *Impostazioni* per fare prove).

## Funzioni

| Sezione | Cosa fa |
|---|---|
| **Oggi** | Coperti del giorno per turno, occupazione, intolleranze per la cucina, prossimi eventi, richieste da confermare |
| **Calendario** | Vista mensile con occupazione per turno (verde / giallo / rosso), eventi e giorni di chiusura; clic su un giorno per il dettaglio |
| **Prenotazioni** | Elenco con ricerca e filtri (stato, tipo, date), esportazione CSV |
| **Eventi** | Schede evento con formula, menu, musica, servizi, intolleranze e preventivo |
| **Disponibilità** | Verifica posti liberi per data/turno/sala, prossimi 14 giorni, gestione sale (coperti e tavoli), turni e orari, chiusura settimanale, ferie e chiusure straordinarie (anche di un solo turno) |
| **Menu** | Catalogo piatti per portata con i 14 allergeni UE e tag vegetariano/vegano; composizione di menu con prezzo adulto/bambino |
| **Servizi** | Catalogo servizi aggiuntivi (allestimenti, torta, confettata, open bar, DJ, karaoke, fotografo, proiettore…) a prezzo fisso o a persona |
| **Impostazioni** | Dati del locale, caparra suggerita, backup/ripristino JSON |

### Prenotazione / evento

- Cliente, canale (telefono, WhatsApp, email…), stato (richiesta, opzionata, confermata, caparra versata, completata, annullata, no show)
- Data, ora, turno automatico, sala, tavolo, adulti/bambini, **sala in esclusiva**
- **Controllo disponibilità in tempo reale**: overbooking, sala già riservata, tavolo già occupato, giorno chiuso
- **Formula**: servito al tavolo, buffet, buffet + servito, apericena/finger food, family style, alla carta
- **Menu**: si parte da un menu composto e lo si personalizza aggiungendo/togliendo piatti
- **Intolleranze e diete** (allergie UE, celiachia, lattosio, vegetariano, vegano, halal, kosher, gravidanza, menu bambino) con numero di persone e note: l'app **segnala i piatti del menu in conflitto**
- **Musica**: sì / no / da definire + intrattenimento (sottofondo, DJ set, musica dal vivo, piano bar, karaoke, animazione bambini, spettacolo, maxischermo, ballo)
- **Servizi aggiuntivi** dal catalogo
- **Preventivo automatico**: menu adulti e bambini, servizi, intrattenimento, sconto, caparra e saldo
- Scheda stampabile, testo di conferma da copiare o inviare via WhatsApp, duplicazione

## Importare le prenotazioni da Google Calendar

1. Su computer apri **calendar.google.com → ⚙️ Impostazioni**, scegli a sinistra il calendario delle prenotazioni e clicca **Esporta calendario** (scarica un file `.zip`).
2. Nell'agenda: **Prenotazioni → 📥 Importa da Google Calendar** (oppure da *Impostazioni*) e carica lo `.zip` così com'è, o il file `.ics` estratto.
3. Scegli da quale data importare (di default da oggi), controlla l'anteprima e premi **Importa selezionati**.

Dal titolo e dalla descrizione di ogni evento l'app ricava: nome, coperti (*"Rossi 4 pax"*, *"x6"*, *"8 persone"*, *"(5)"*), bambini, telefono, email, tavolo, tipo di evento (compleanno, comunione, matrimonio, aziendale…), intolleranze (*celiaco, vegano, allergia noci…*) e stato (*da confermare*, eventi annullati). Nell'anteprima si può correggere tutto; il testo originale finisce nelle note. Gli eventi già importati vengono riconosciuti e non si duplicano, quindi si può ripetere l'importazione quando serve.

Limiti: degli eventi ricorrenti viene importata solo la prima data; gli eventi "tutto il giorno" ricevono l'orario di inizio dell'ultimo turno (modificabile).

### Sincronizzazione automatica con Google Calendar

Se continuate a segnare prenotazioni anche su Google Calendar, l'agenda può aggiornarsi da sola. Richiede il **database condiviso** (sezione sotto): una pagina web da sola non può leggere il calendario Google.

1. In Supabase → **SQL Editor** esegui [`supabase/google-sync.sql`](supabase/google-sync.sql) (dopo `schema.sql`).
2. In Google Calendar (da computer): **⚙️ Impostazioni** → a sinistra il calendario delle prenotazioni → **Integra calendario** → copia l'**Indirizzo segreto in formato iCal**.
3. Nell'agenda, da amministratore: **Impostazioni → 📅 Sincronizzazione Google Calendar** → incolla l'indirizzo → **Salva indirizzo**.

Da quel momento il database controlla il calendario **ogni 5 minuti** (anche quando nessuno ha l'agenda aperta) e ogni agenda aperta si aggiorna in tempo reale:

- **evento nuovo** (da ieri in poi) → nuova prenotazione, interpretata come nell'importazione manuale;
- **evento modificato** (orario, data, coperti, titolo…) → la prenotazione si aggiorna, **tranne i campi che lo staff ha corretto a mano nell'agenda**, che restano come li avete messi; menu, intolleranze, servizi e note aggiunti nell'agenda non vengono mai toccati;
- **evento annullato o eliminato** su Google → la prenotazione futura passa ad *Annullata* con una nota.

La sincronizzazione va **da Google verso l'agenda**: le prenotazioni create direttamente nell'agenda non vengono scritte su Google. Il pulsante **🔄 Sincronizza ora** forza un controllo immediato. L'indirizzo segreto dà accesso in lettura al calendario: non condividerlo; se finisce in mani sbagliate, in Google Calendar si può reimpostare (e poi va incollato di nuovo nell'agenda).

## Database condiviso e accesso riservato allo staff

Con il database condiviso tutto lo staff vede la stessa agenda, da qualsiasi dispositivo, e le modifiche compaiono **in tempo reale** sugli altri schermi. Per entrare serve **email e password**, e possono entrare **solo le email autorizzate** dall'amministratore.

Il database è [Supabase](https://supabase.com) (piano gratuito sufficiente per un ristorante).

### 1. Crea il database (una volta, ~5 minuti)

1. Registrati su supabase.com → **New project** (scegli una regione europea, es. Frankfurt, e una password per il database).
2. Apri **SQL Editor → New query**, incolla tutto il file [`supabase/schema.sql`](supabase/schema.sql), **sostituisci in fondo `TUA-EMAIL@esempio.it` con la tua email** e premi **Run**.
3. In **Project Settings → API** copia *Project URL* e la chiave *anon public*.
4. In **Authentication → URL Configuration** imposta *Site URL* con l'indirizzo della pagina (vedi punto 3 sotto, es. `https://<utente>.github.io/Agenda-SS17/`), così i link di conferma e di reset password tornano all'agenda.

### 2. Collega l'app

Modifica [`config.js`](config.js) (anche direttamente dal sito di GitHub, icona ✏️) e incolla i due valori:

```js
window.AGENDA_CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```

La chiave *anon public* è fatta per stare nella pagina: da sola non dà accesso a nulla, perché le regole di sicurezza del database (Row Level Security) permettono di leggere e scrivere **solo agli utenti loggati presenti nella tabella `staff`**. Non inserire mai la chiave *service_role*.

### 3. Pubblica su GitHub Pages

1. Unisci il codice nel branch `main`.
2. Su GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Il workflow `.github/workflows/pages.yml` pubblica la pagina a ogni modifica di `main` (pubblica solo i file dell'app, non lo schema SQL). L'indirizzo compare in **Actions** e in **Settings → Pages**.

> **Nota sulla privacy della pagina.** GitHub Pages non può chiedere una password (questo è possibile solo con GitHub Enterprise Cloud). Inoltre, con il piano GitHub *Free* Pages funziona solo su repository **pubblici**; con *Pro/Team* anche da repository privati, ma il sito resta comunque raggiungibile da chiunque abbia il link.
> Non è un problema: la pagina contiene solo il programma, **nessun dato e nessun segreto**. Chi apre il link senza essere autorizzato vede soltanto la schermata di accesso, e il database rifiuta qualsiasi richiesta che non venga da un membro dello staff.

### 4. Primo accesso e staff

1. Apri la pagina → **Primo accesso? Crea l'account** con la tua email (quella messa nello schema) → conferma dal link ricevuto via email → accedi.
2. Al primo accesso con database vuoto puoi scegliere: caricare i dati già presenti nel browser, i dati demo, oppure partire da zero.
3. Per aggiungere collaboratori: **Impostazioni → Staff autorizzato** → inserisci email, nome e ruolo (*Staff* o *Amministratore*). La persona apre la pagina e crea il proprio account con quella email.
4. Per togliere l'accesso: **Rimuovi** accanto al nome. Da quel momento il database non le mostra più nulla.

Ruoli: lo **staff** gestisce prenotazioni, eventi, menu, servizi e disponibilità; l'**amministratore** in più gestisce le persone autorizzate, importa backup e può svuotare i dati.

Consiglio: quando tutto lo staff ha creato l'account, in Supabase **Authentication → Providers → Email** puoi disattivare *Allow new users to sign up*; i nuovi collaboratori li inviterai da **Authentication → Users → Invite user** (oltre ad autorizzarli nell'app).

### Come funziona la sincronizzazione

- Ogni prenotazione, piatto, menu, servizio, sala e chiusura è un documento separato: si salva solo ciò che cambia, quindi due persone possono lavorare contemporaneamente su prenotazioni diverse senza sovrascriversi. Se modificano **la stessa** prenotazione nello stesso momento vale l'ultimo salvataggio.
- In alto accanto al titolo c'è lo stato: **● Sincronizzato**, **Salvataggio…**, **⚠ Non salvato** (riprova in automatico).
- Se un collega modifica qualcosa mentre stai compilando un modulo, la vista si aggiorna appena chiudi il modulo.
- Lasciando `config.js` vuoto l'app torna in modalità locale (dati solo nel browser).

## File

| File | Contenuto |
|---|---|
| `index.html`, `styles.css` | Struttura e grafica |
| `app.js` | Logica dell'agenda |
| `gcal.js` | Importazione e sincronizzazione da Google Calendar |
| `cloud.js` | Login, database condiviso, tempo reale, gestione staff |
| `config.js` | Collegamento al database (vuoto = modalità locale) |
| `supabase/schema.sql` | Tabelle e regole di sicurezza da eseguire su Supabase |
| `supabase/google-sync.sql` | Sincronizzazione automatica con Google Calendar (facoltativa) |
| `.github/workflows/pages.yml` | Pubblicazione automatica su GitHub Pages |
