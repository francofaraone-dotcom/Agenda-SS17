# Agenda Ristorante

Web app per gestire **prenotazioni, eventi e disponibilità** di un ristorante, con composizione dei menu, intolleranze, servizi aggiuntivi, formula di servizio (servito / buffet) e intrattenimento (musica, DJ, karaoke…).

Nessuna installazione: è una pagina statica (HTML + CSS + JavaScript). I dati sono salvati nel browser (localStorage).

## Avvio

- Apri `index.html` nel browser, **oppure**
- pubblicala con GitHub Pages (Settings → Pages → branch e cartella root), **oppure**
- in locale: `python3 -m http.server` e vai su http://localhost:8000

Al primo avvio vengono caricati dei dati demo (ricaricabili o cancellabili da *Impostazioni*).

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

> I dati restano nel browser del dispositivo in uso: per condividerli tra più dispositivi usa *Esporta / Importa backup*.
