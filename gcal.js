/* Agenda Ristorante — importazione delle prenotazioni da Google Calendar.
   Legge il file .ics (o lo .zip) esportato da Google Calendar, interpreta ogni evento
   (data, ora, nome, coperti, telefono, tipo evento, intolleranze) e mostra un'anteprima
   modificabile prima di importare. Gli eventi già importati (stesso UID) non si duplicano. */
'use strict';

/* ---------- lettura file (.ics oppure .zip di Google) ---------- */
async function readCalendarFiles(files) {
  const out = [];
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) { // "PK" = zip
      for (const e of await unzip(buf)) if (/\.ics$/i.test(e.name)) out.push({ name: e.name, text: e.text });
    } else {
      out.push({ name: f.name, text: new TextDecoder('utf-8').decode(buf) });
    }
  }
  return out;
}

// lettore zip minimale (archivi "stored" o "deflate", come quelli di Google)
async function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Archivio zip non valido');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.subarray(start, start + csize);
    let raw;
    if (method === 0) raw = data;
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Il browser non sa aprire lo zip: estrai il file .ics e caricalo');
      raw = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    } else continue;
    files.push({ name, text: new TextDecoder('utf-8').decode(raw) });
  }
  return files;
}

/* ---------- parser iCalendar ---------- */
function parseICS(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const calName = (lines.find(l => l.startsWith('X-WR-CALNAME:')) || '').slice(13);
  const events = [];
  let cur = null, depth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }   // VALARM ecc.
    if (line.startsWith('END:') && depth) { depth--; continue; }
    if (line === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (depth) continue;
    const m = line.match(/^([A-Z0-9-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const params = {};
    m[2].split(';').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); });
    cur[m[1]] = { value: m[3], params };
  }
  return { calName, events };
}
const icsText = v => (v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

// data/ora ICS → { data: 'YYYY-MM-DD', ora: 'HH:MM' | '', allDay }
function icsDate(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4]) return { data: `${m[1]}-${m[2]}-${m[3]}`, ora: '', allDay: true };
  if (m[7]) { // UTC → ora locale del browser
    const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]));
    return { data: isoDate(d), ora: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false };
  }
  // ora "di parete" (TZID o fluttuante): la usiamo così com'è
  return { data: `${m[1]}-${m[2]}-${m[3]}`, ora: `${m[4]}:${m[5]}`, allDay: false };
}

/* ---------- interpretazione del testo dell'evento ---------- */
const EVENTO_KEYWORDS = [
  ['Matrimonio', /matrimoni|nozze|sposi\b/i], ['Battesimo', /battesim/i], ['Comunione', /comunion/i],
  ['Cresima', /cresim/i], ['Laurea', /laurea/i], ['Anniversario', /anniversari/i],
  ['Compleanno', /compleann|\bcompl\.?\b|\bbirthday\b|\d+\s*anni\b|\b18esimo/i],
  ['Addio al celibato/nubilato', /addio al (celibato|nubilato)/i],
  ['Evento aziendale', /aziendal|\bsrl\b|\bspa\b|\bs\.r\.l|team building|cena di natale|meeting/i],
  ['Degustazione', /degustazion/i], ['Serata a tema', /serata a tema|\bserata\b/i],
  ['Festa privata', /\bfesta\b|\bparty\b|rinfresco/i], ['Cena di gruppo', /\bgruppo\b/i],
];
const INTOL_KEYWORDS = [
  ['Celiachia', /celiac|senza glutine|gluten/i], ['Intolleranza al lattosio', /lattosio|lactose/i],
  ['Vegano', /\bvegan/i], ['Vegetariano', /vegetarian/i], ['Menu bambino', /menu bimb|menu bambin/i],
  ['Allergia: Frutta a guscio', /noci|nocciol|frutta a guscio|mandorl|pistacch/i],
  ['Allergia: Arachidi', /arachid/i], ['Allergia: Crostacei', /crostace|gamber/i], ['Allergia: Pesce', /allergi\w* (al )?pesce/i],
  ['Allergia: Uova', /allergi\w* (alle )?uova/i], ['Allergia: Latte', /allergi\w* (al )?latte/i], ['Allergia: Molluschi', /mollusch|cozze|vongol/i],
  ['Allergia: Sesamo', /sesamo/i], ['Allergia: Soia', /\bsoia\b/i], ['Allergia: Sedano', /sedano/i],
];
const PAX_RE = [
  /(\d{1,3})\s*(?:pax|persone|pers\.?|coperti|cop\.?|ospiti|invitati|px|adulti)\b/i,
  /\b(?:pax|persone|coperti|ospiti|per)\s*[:=]?\s*(\d{1,3})\b/i,
  /(?:^|\s)[x×]\s?(\d{1,3})\b/i,
  /\((\d{1,3})\)/,
  /(?:^|\s)(\d{1,3})\s*p\b/i,
];
const KIDS_RE = /(\d{1,2})\s*(?:bambini|bambino|bimbi|bimbo|bimb\.?|kids|ragazzi|bamb\.?)/i;
const PHONE_RE = /(?:\+?39[\s.]?)?(?:3\d{2}|0\d{1,3})[\s./-]?\d{3,4}[\s./-]?\d{3,4}/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const TAVOLO_RE = /\b(?:tav(?:olo|\.)?|tavoli|t\.)\s*(\d+(?:\s*[+e,]\s*\d+)*)/i;

function interpretEvent(ev) {
  const summary = icsText(ev.SUMMARY?.value), desc = icsText(ev.DESCRIPTION?.value), loc = icsText(ev.LOCATION?.value);
  const all = [summary, desc, loc].join('\n');
  const start = icsDate(ev.DTSTART);
  if (!start) return null;

  let adulti = 0;
  for (const re of PAX_RE) { const m = summary.match(re) || all.match(re); if (m) { adulti = +m[1]; break; } }
  const km = all.match(KIDS_RE); const bambini = km ? +km[1] : 0;
  if (adulti && bambini && /totale|in tutto|tot\.?/i.test(all) && adulti > bambini) adulti -= bambini;
  const phone = (all.match(PHONE_RE) || [''])[0].trim();
  const email = (all.match(EMAIL_RE) || [''])[0];
  const tavolo = ((all.match(TAVOLO_RE) || [])[1] || '').replace(/\s*(e|,)\s*/g, '+').replace(/\s/g, '');

  const tipoEvento = (EVENTO_KEYWORDS.find(([, re]) => re.test(all)) || [''])[0];
  const isEvento = !!tipoEvento && !['Cena di gruppo'].includes(tipoEvento) || adulti >= 15;

  // nome: il titolo ripulito da coperti, telefono, orari e parole di servizio
  let nome = summary
    .replace(PHONE_RE, ' ').replace(EMAIL_RE, ' ').replace(TAVOLO_RE, ' ').replace(KIDS_RE, ' ');
  PAX_RE.forEach(re => (nome = nome.replace(re, ' ')));
  nome = nome
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ')
    .replace(/\b(prenotazion[ei]|pren\.?|tavolo|confermat[oa]|da confermare|ore|h)\b/gi, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s*[-–—|:/,]+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // "Cena Rossi" → "Rossi", ma "Cena di Natale Acme" (evento) resta com'è
  if (!isEvento) nome = nome.replace(/^(cena|pranzo|aperitivo)\s+/i, '').trim();
  if (!nome) nome = summary || 'Senza nome';

  const sala = S.sale.find(s => s.nome && new RegExp('\\b' + s.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(all));
  const intolleranze = INTOL_KEYWORDS.filter(([, re]) => re.test(all)).map(([tipo]) => ({ tipo, n: 1, note: 'da verificare (importato)' }));
  const daConfermare = /da confermare|in attesa|forse|opzion|\?\s*$/i.test(summary) || ev.STATUS?.value === 'TENTATIVE';
  const cancellato = ev.STATUS?.value === 'CANCELLED' || /annullat|disdett|cancellat/i.test(summary);

  const ora = start.ora || '';
  return {
    uid: gcalKey(ev) || `${start.data}-${summary}`,
    hash: gcalHash(ev),
    ricorrente: !!ev.RRULE,
    allDay: start.allDay,
    summary, desc,
    p: newBooking({
      tipo: isEvento ? 'evento' : 'tavolo',
      tipoEvento: isEvento ? (tipoEvento || 'Cena di gruppo') : '',
      titolo: isEvento ? summary : '',
      nome, telefono: phone, email, fonte: 'Google Calendar',
      data: start.data, ora: ora || S.settings.turni.at(-1)?.start || '20:00',
      turno: turnoFromOra(ora || S.settings.turni.at(-1)?.start || '20:00'),
      salaId: sala?.id || S.sale[0]?.id || '',
      tavolo, adulti: adulti || 2, bambini,
      stato: cancellato ? 'annullata' : daConfermare ? 'richiesta' : 'confermata',
      intolleranze,
      note: ['Importato da Google Calendar: ' + summary, desc, loc && 'Luogo: ' + loc].filter(Boolean).join('\n'),
      gcalUid: gcalKey(ev) || `${start.data}-${summary}`,
      coperti_incerti: !adulti,
    }),
  };
}

/* ---------- interfaccia ---------- */
function openGcalImport() {
  openModal('Importa da Google Calendar', `
    <div class="alert info" style="margin-top:0">
      <b>Come esportare il calendario da Google</b> (da computer):
      <ol style="margin:6px 0 0;padding-left:20px">
        <li>Apri <b>calendar.google.com</b> → ⚙️ <b>Impostazioni</b>.</li>
        <li>A sinistra, sotto <i>Impostazioni dei miei calendari</i>, scegli il calendario delle prenotazioni.</li>
        <li>Clicca <b>Esporta calendario</b>: viene scaricato un file <b>.zip</b>.</li>
        <li>Caricalo qui sotto così com'è (va bene anche il file <b>.ics</b> estratto).</li>
      </ol>
    </div>
    <div class="form-grid" style="align-items:end">
      <label class="field span-2">File del calendario (.zip o .ics)<input type="file" id="gcFile" accept=".ics,.zip,text/calendar,application/zip" multiple></label>
      <label class="field">Importa eventi dal<input type="date" id="gcFrom" value="${todayISO()}"></label>
      <label class="field">al (facoltativo)<input type="date" id="gcTo"></label>
    </div>
    <p class="small muted">Suggerimento: nel titolo degli eventi l'app riconosce il nome, i coperti (es. “Rossi 4 pax”, “x6”, “8 persone”), i bambini, il telefono, il tavolo, il tipo di evento (compleanno, comunione…) e parole come “celiaco”, “vegano”, “allergia noci”. Tutto è modificabile nell'anteprima.</p>
    <div id="gcOut"></div>`);
  let parsed = [];
  const render = () => {
    const from = $('#gcFrom').value, to = $('#gcTo').value;
    const known = new Set(S.prenotazioni.map(p => p.gcalUid).filter(Boolean));
    const rows = parsed.filter(r => (!from || r.p.data >= from) && (!to || r.p.data <= to)).sort((a, b) => (a.p.data + a.p.ora).localeCompare(b.p.data + b.p.ora));
    const fuori = parsed.length - rows.length;
    if (!parsed.length) { $('#gcOut').innerHTML = ''; return; }
    $('#gcOut').innerHTML = `
      <div class="toolbar" style="margin-top:10px">
        <b>${rows.length} eventi</b><span class="small muted">${fuori ? `(${fuori} fuori dalle date scelte)` : ''}</span>
        <span class="spacer"></span>
        <label class="check"><input type="checkbox" id="gcAll" checked> Seleziona tutti</label>
      </div>
      <div class="table-wrap"><table class="gc-table"><thead><tr><th></th><th>Data</th><th>Ora</th><th>Cliente / titolo</th><th>Adulti</th><th>Bimbi</th><th>Tipo</th><th>Info riconosciute</th></tr></thead><tbody>
      ${rows.map((r, i) => {
        const dup = known.has(r.uid);
        const p = r.p;
        return `<tr data-i="${parsed.indexOf(r)}" class="${dup ? 'muted' : ''}">
          <td><input type="checkbox" class="gc-sel" ${dup ? "disabled" : p.stato === "annullata" ? "" : "checked"}></td>
          <td class="nowrap">${esc(fmtDate(p.data))}</td>
          <td><input type="time" class="gc-ora" value="${esc(p.ora)}" style="width:125px">${r.allDay ? '<div class="small muted">tutto il giorno</div>' : ''}</td>
          <td><input class="gc-nome" value="${esc(p.nome)}" style="min-width:170px"><div class="small muted" title="${esc(r.desc)}">${esc(r.summary)}</div></td>
          <td><input type="number" min="0" class="gc-ad" value="${p.adulti}" style="width:70px;${p.coperti_incerti ? 'border-color:var(--warn)' : ''}" title="${p.coperti_incerti ? 'Coperti non trovati nel testo: controlla' : ''}"></td>
          <td><input type="number" min="0" class="gc-bb" value="${p.bambini}" style="width:60px"></td>
          <td><select class="gc-tipo" style="min-width:140px"><option value="">Tavolo</option>${TIPI_EVENTO.map(t => `<option ${p.tipoEvento === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td class="small"><div class="tags">
            ${dup ? '<span class="badge">già importato</span>' : ''}
            ${p.stato !== 'confermata' ? statoBadge(p.stato) : ''}
            ${p.telefono ? `<span class="badge">📞 ${esc(p.telefono)}</span>` : ''}
            ${p.tavolo ? `<span class="badge">Tav. ${esc(p.tavolo)}</span>` : ''}
            ${p.intolleranze.map(x => `<span class="badge warn">${esc(x.tipo.replace('Allergia: ', 'allergia '))}</span>`).join('')}
            ${p.coperti_incerti ? '<span class="badge warn">coperti da verificare</span>' : ''}
            ${r.ricorrente ? '<span class="badge warn">ricorrente: importata solo la 1ª data</span>' : ''}
          </div></td></tr>`;
      }).join('')}
      </tbody></table></div>
      <div class="modal-foot" style="margin-top:12px">
        <span class="small muted" id="gcCount"></span><span class="spacer"></span>
        <button class="btn" data-close>Annulla</button>
        <button class="btn primary" id="gcGo">Importa selezionati</button>
      </div>`;
    $$('[data-close]', $('#gcOut')).forEach(b => (b.onclick = closeModal));
    const count = () => {
      const n = $$('.gc-sel').filter(c => c.checked).length;
      $('#gcCount').textContent = `${n} da importare`;
      $('#gcGo').disabled = !n;
    };
    $('#gcAll').onchange = e => { $$('.gc-sel').filter(c => !c.disabled).forEach(c => (c.checked = e.target.checked)); count(); };
    $('#gcOut').addEventListener('change', e => { if (e.target.classList.contains('gc-sel')) count(); });
    count();
    $('#gcGo').onclick = () => {
      let n = 0;
      $$('.gc-table tbody tr').forEach(tr => {
        if (!$('.gc-sel', tr).checked) return;
        const r = parsed[+tr.dataset.i], p = { ...r.p };
        p.ora = $('.gc-ora', tr).value || p.ora;
        p.turno = turnoFromOra(p.ora);
        p.nome = $('.gc-nome', tr).value.trim() || p.nome;
        p.adulti = Math.max(0, parseInt($('.gc-ad', tr).value) || 0);
        p.bambini = Math.max(0, parseInt($('.gc-bb', tr).value) || 0);
        const tipo = $('.gc-tipo', tr).value;
        p.tipo = tipo ? 'evento' : 'tavolo';
        p.tipoEvento = tipo;
        p.titolo = tipo ? (p.titolo || r.summary) : '';
        delete p.coperti_incerti;
        p.id = S.prenotazioni.some(x => x.id === gcalId(r.uid)) ? uid() : gcalId(r.uid);
        p.gcalUid = r.uid; p.gcalHash = r.hash; p.gcalSnap = gcalSnap(r.p);
        S.prenotazioni.push(p); n++;
      });
      closeModal(); rerender();
      toast(`✓ ${n} prenotazioni importate da Google Calendar`);
    };
  };
  $('#gcFrom').onchange = render; $('#gcTo').onchange = render;
  $('#gcFile').onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    $('#gcOut').innerHTML = '<p class="muted">Lettura del file…</p>';
    try {
      const cals = await readCalendarFiles(files);
      if (!cals.length) throw new Error('Nessun file .ics trovato');
      parsed = cals.flatMap(c => parseICS(c.text).events).map(interpretEvent).filter(Boolean);
      // stesso evento presente in più file: tienine uno
      const seen = new Set(); parsed = parsed.filter(r => !seen.has(r.uid) && seen.add(r.uid));
      if (!parsed.length) throw new Error('Il file non contiene eventi');
      render();
    } catch (err) {
      $('#gcOut').innerHTML = `<div class="alert danger">Impossibile leggere il file: ${esc(err.message)}</div>`;
    }
  };
}

/* =========================================================
   Sincronizzazione automatica (con database condiviso)
   Il database scarica periodicamente il calendario Google (indirizzo segreto iCal);
   qui il contenuto viene confrontato con l'agenda:
   - eventi nuovi (da ieri in poi) → nuove prenotazioni
   - eventi modificati → aggiornati solo i campi che nessuno ha corretto a mano nell'agenda
   - eventi annullati o eliminati su Google → prenotazione "Annullata"
   ========================================================= */
const GCAL_FIELDS = ['nome', 'telefono', 'email', 'data', 'ora', 'turno', 'adulti', 'bambini', 'tavolo', 'tipo', 'tipoEvento', 'titolo'];

function strHash(str, seed = 5381) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function gcalKey(ev) {
  const u = ev.UID?.value || '';
  return u && ev['RECURRENCE-ID'] ? u + '#' + ev['RECURRENCE-ID'].value : u;
}
function gcalHash(ev) {
  return strHash(['DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'STATUS'].map(k => ev[k]?.value || '').join('\u0001'));
}
// id stabile: due dispositivi che sincronizzano insieme creano la STESSA prenotazione, non due copie
const gcalId = key => 'gc_' + strHash(key) + strHash(key, 7919);
const gcalSnap = p => Object.fromEntries(GCAL_FIELDS.map(f => [f, p[f]]));

function gcalMerge(ex, r) {
  if (ex.gcalHash === r.hash) return false;
  const prev = ex.gcalSnap || {};
  let changed = false;
  for (const f of GCAL_FIELDS) {
    const userEdited = f in prev && ex[f] !== prev[f];
    if (!userEdited && ex[f] !== r.p[f]) { ex[f] = r.p[f]; changed = true; }
  }
  if (r.p.stato === 'annullata' && ex.stato !== 'annullata') {
    ex.stato = 'annullata'; changed = true;
    ex.note = (ex.note ? ex.note + '\n' : '') + 'Annullata su Google Calendar il ' + new Date().toLocaleString('it-IT');
  }
  ex.gcalHash = r.hash;
  ex.gcalSnap = gcalSnap(r.p);
  return changed;
}

function applyGcalFeed(text, from = addDays(todayISO(), -1)) {
  const items = parseICS(text).events.map(interpretEvent).filter(Boolean);
  const res = { created: 0, updated: 0, cancelled: 0, events: items.length };
  if (!items.length) return res; // feed vuoto o non valido: non tocchiamo nulla
  const byKey = new Map(S.prenotazioni.filter(p => p.gcalUid).map(p => [p.gcalUid, p]));
  const seen = new Set();
  for (const r of items) {
    if (seen.has(r.uid)) continue;
    seen.add(r.uid);
    const ex = byKey.get(r.uid) || S.prenotazioni.find(x => x.id === gcalId(r.uid));
    if (ex) {
      if (!ex.gcalUid) ex.gcalUid = r.uid;
      if (gcalMerge(ex, r)) res.updated++;
      continue;
    }
    if (r.p.data < from || r.p.stato === 'annullata') continue;
    const p = { ...r.p, id: gcalId(r.uid), gcalUid: r.uid, gcalHash: r.hash, gcalSnap: gcalSnap(r.p) };
    if (p.coperti_incerti) p.note = '⚠️ Coperti non indicati su Google Calendar: da verificare.\n' + p.note;
    delete p.coperti_incerti;
    S.prenotazioni.push(p);
    res.created++;
  }
  // eventi spariti dal calendario Google (eliminati): annulla le prenotazioni future collegate
  const t = todayISO();
  for (const p of S.prenotazioni) {
    if (p.gcalUid && !seen.has(p.gcalUid) && p.data >= t && isActive(p) && p.stato !== 'completata') {
      p.stato = 'annullata';
      p.note = (p.note ? p.note + '\n' : '') + 'Evento eliminato da Google Calendar il ' + new Date().toLocaleString('it-IT');
      res.cancelled++;
    }
  }
  return res;
}
