/* Agenda Ristorante — prenotazioni, eventi, disponibilità, menu, intolleranze, servizi.
   App statica: tutti i dati sono salvati nel browser (localStorage). */
'use strict';

/* =========================================================
   Costanti
   ========================================================= */
const DB_KEY = 'agendaRistorante.v1';

const ALLERGENI = ['Glutine', 'Crostacei', 'Uova', 'Pesce', 'Arachidi', 'Soia', 'Latte',
  'Frutta a guscio', 'Sedano', 'Senape', 'Sesamo', 'Solfiti', 'Lupini', 'Molluschi'];

// Diete / esigenze: mappate sugli allergeni o sui tag dei piatti per il controllo del menu
const DIETE = {
  'Celiachia': { allergeni: ['Glutine'] },
  'Intolleranza al lattosio': { allergeni: ['Latte'] },
  'Vegetariano': { tag: 'vegetariano' },
  'Vegano': { tag: 'vegano' },
  'Halal': {},
  'Kosher': {},
  'Gravidanza': {},
  'Menu bambino': {},
  'Altro': {},
};
const INTOLLERANZE = [...ALLERGENI.map(a => 'Allergia: ' + a), ...Object.keys(DIETE)];

const PORTATE = [
  ['aperitivo', 'Aperitivo / Benvenuto'],
  ['antipasto', 'Antipasti'],
  ['primo', 'Primi'],
  ['secondo', 'Secondi'],
  ['contorno', 'Contorni'],
  ['buffet', 'Buffet / Finger food'],
  ['dolce', 'Dolci & Torta'],
  ['bevande', 'Bevande & Vini'],
];
const PORTATA_LABEL = Object.fromEntries(PORTATE);

const STATI = {
  richiesta: { label: 'Richiesta', cls: 'warn' },
  opzionata: { label: 'Opzionata', cls: 'info' },
  confermata: { label: 'Confermata', cls: 'ok' },
  caparra: { label: 'Caparra versata', cls: 'ok' },
  completata: { label: 'Completata', cls: '' },
  annullata: { label: 'Annullata', cls: 'danger' },
  noshow: { label: 'No show', cls: 'danger' },
};
const STATI_ATTIVI = ['richiesta', 'opzionata', 'confermata', 'caparra', 'completata'];

const TIPI_EVENTO = ['Compleanno', 'Matrimonio', 'Battesimo', 'Comunione', 'Cresima', 'Laurea',
  'Anniversario', 'Evento aziendale', 'Cena di gruppo', 'Addio al celibato/nubilato',
  'Festa privata', 'Serata a tema', 'Degustazione', 'Altro'];

const FORMULE = ['Servito al tavolo', 'Buffet', 'Buffet + servito', 'Apericena / Finger food',
  'Family style (condivisione)', 'Menu alla carta'];

const INTRATTENIMENTO = ['Musica di sottofondo', 'DJ set', 'Musica dal vivo', 'Piano bar', 'Karaoke',
  'Animazione bambini', 'Spettacolo / Show', 'Maxischermo / Proiezione', 'Ballo / Pista'];

const CATEGORIE_SERVIZI = ['Allestimento', 'Dolci', 'Bevande', 'Intrattenimento', 'Foto & Video', 'Logistica', 'Altro'];

const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const GIORNI_BREVI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/* =========================================================
   Utility
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const eur = v => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v || 0);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); };
const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  s ? parseISO(s).toLocaleDateString('it-IT', opts) : '';
const fmtLong = s => fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2400);
}

/* =========================================================
   Stato / persistenza
   ========================================================= */
// Modalità: locale (solo questo browser) o condivisa (database Supabase, vedi cloud.js e config.js)
const CFG = window.AGENDA_CONFIG || {};
const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
let S = CLOUD ? emptyState() : load();

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* storage non disponibile */ }
  return seed();
}
function save() {
  if (CLOUD) return cloudSave();
  try { localStorage.setItem(DB_KEY, JSON.stringify(S)); } catch (e) { toast('⚠️ Impossibile salvare nel browser'); }
}
function normalize(d) {
  const base = emptyState();
  return {
    ...base, ...d,
    settings: { ...base.settings, ...(d.settings || {}) },
  };
}
function emptyState() {
  return {
    settings: {
      nome: 'Il Mio Ristorante',
      telefono: '', email: '', indirizzo: '',
      turni: [
        { id: 'pranzo', label: 'Pranzo', start: '12:00', end: '15:30' },
        { id: 'cena', label: 'Cena', start: '19:00', end: '23:59' },
      ],
      chiusuraSettimanale: [1], // 0 = domenica, 1 = lunedì...
      durataTurnoMin: 120,
      soglieOcc: { mid: 0.7, full: 0.95 },
      ivaInclusa: true,
      caparraPerc: 30,
    },
    sale: [], piatti: [], menu: [], servizi: [], chiusure: [], prenotazioni: [],
  };
}

function seed() {
  const s = emptyState();
  s.settings.nome = 'Trattoria Demo';
  const sala = (nome, capienza, tavoli, note = '') => ({ id: uid(), nome, capienza, tavoli, note });
  s.sale = [
    sala('Sala principale', 60, 15, 'Vista giardino'),
    sala('Sala privata', 30, 5, 'Ideale per eventi, con proiettore'),
    sala('Veranda / Esterno', 40, 10, 'Disponibile da maggio a settembre'),
  ];
  const p = (nome, portata, prezzo, allergeni = [], tag = []) => ({ id: uid(), nome, portata, prezzo, allergeni, tag, descrizione: '' });
  s.piatti = [
    p('Prosecco di benvenuto con stuzzichini', 'aperitivo', 6, ['Solfiti', 'Glutine'], ['vegetariano']),
    p('Tagliere di salumi e formaggi', 'antipasto', 12, ['Latte']),
    p('Bruschette miste', 'antipasto', 7, ['Glutine'], ['vegetariano', 'vegano']),
    p('Insalata di mare', 'antipasto', 14, ['Crostacei', 'Molluschi', 'Pesce', 'Sedano']),
    p('Flan di verdure con fonduta', 'antipasto', 9, ['Uova', 'Latte'], ['vegetariano']),
    p('Risotto ai funghi porcini', 'primo', 13, ['Latte', 'Sedano'], ['vegetariano']),
    p('Tagliatelle al ragù', 'primo', 12, ['Glutine', 'Uova', 'Sedano']),
    p('Paccheri allo scoglio', 'primo', 16, ['Glutine', 'Crostacei', 'Molluschi', 'Pesce']),
    p('Pasta senza glutine al pomodoro', 'primo', 10, [], ['vegetariano', 'vegano']),
    p('Filetto di manzo al pepe verde', 'secondo', 22, ['Latte', 'Senape']),
    p('Orata al forno con patate', 'secondo', 19, ['Pesce']),
    p('Burger vegetale di legumi', 'secondo', 14, ['Soia', 'Sesamo'], ['vegetariano', 'vegano']),
    p('Patate al forno', 'contorno', 5, [], ['vegetariano', 'vegano']),
    p('Verdure grigliate', 'contorno', 5, [], ['vegetariano', 'vegano']),
    p('Mini pizze e focaccine', 'buffet', 4, ['Glutine', 'Latte'], ['vegetariano']),
    p('Spiedini di frutta', 'buffet', 3, [], ['vegetariano', 'vegano']),
    p('Torta millefoglie (personalizzabile)', 'dolce', 6, ['Glutine', 'Uova', 'Latte'], ['vegetariano']),
    p('Tiramisù', 'dolce', 6, ['Glutine', 'Uova', 'Latte'], ['vegetariano']),
    p('Sorbetto al limone', 'dolce', 4, [], ['vegetariano', 'vegano']),
    p('Acqua, vino della casa e caffè', 'bevande', 8, ['Solfiti'], ['vegetariano', 'vegano']),
  ];
  const ids = names => names.map(n => s.piatti.find(x => x.nome === n).id);
  s.menu = [
    { id: uid(), nome: 'Menu Terra', descrizione: 'Antipasto, primo, secondo, contorno, dolce, bevande', prezzoPersona: 38, prezzoBambini: 20,
      piatti: ids(['Tagliere di salumi e formaggi', 'Tagliatelle al ragù', 'Filetto di manzo al pepe verde', 'Patate al forno', 'Tiramisù', 'Acqua, vino della casa e caffè']) },
    { id: uid(), nome: 'Menu Mare', descrizione: 'Percorso di pesce', prezzoPersona: 48, prezzoBambini: 25,
      piatti: ids(['Insalata di mare', 'Paccheri allo scoglio', 'Orata al forno con patate', 'Sorbetto al limone', 'Acqua, vino della casa e caffè']) },
    { id: uid(), nome: 'Menu Festa / Cerimonia', descrizione: 'Aperitivo di benvenuto, due primi, secondo, torta', prezzoPersona: 55, prezzoBambini: 25,
      piatti: ids(['Prosecco di benvenuto con stuzzichini', 'Flan di verdure con fonduta', 'Risotto ai funghi porcini', 'Tagliatelle al ragù', 'Filetto di manzo al pepe verde', 'Verdure grigliate', 'Torta millefoglie (personalizzabile)', 'Acqua, vino della casa e caffè']) },
    { id: uid(), nome: 'Buffet Apericena', descrizione: 'Finger food a buffet', prezzoPersona: 25, prezzoBambini: 12,
      piatti: ids(['Prosecco di benvenuto con stuzzichini', 'Bruschette miste', 'Mini pizze e focaccine', 'Spiedini di frutta']) },
  ];
  const sv = (nome, categoria, prezzo, tipoPrezzo = 'fisso') => ({ id: uid(), nome, categoria, prezzo, tipoPrezzo });
  s.servizi = [
    sv('Allestimento floreale tavoli', 'Allestimento', 150),
    sv('Palloncini e addobbi a tema', 'Allestimento', 80),
    sv('Tovagliato e mise en place elegante', 'Allestimento', 3, 'persona'),
    sv('Segnaposto e tableau personalizzati', 'Allestimento', 1.5, 'persona'),
    sv('Torta personalizzata (al kg)', 'Dolci', 30),
    sv('Confettata', 'Dolci', 120),
    sv('Open bar (2 ore)', 'Bevande', 15, 'persona'),
    sv('Taglio torta e brindisi', 'Bevande', 4, 'persona'),
    sv('DJ / Impianto audio', 'Intrattenimento', 250),
    sv('Postazione karaoke', 'Intrattenimento', 120),
    sv('Musica dal vivo (duo)', 'Intrattenimento', 400),
    sv('Animatore per bambini', 'Intrattenimento', 150),
    sv('Fotografo', 'Foto & Video', 350),
    sv('Proiettore e schermo', 'Logistica', 50),
    sv('Uso esclusivo della sala', 'Logistica', 300),
    sv('Parcheggio riservato', 'Logistica', 0),
  ];

  // prenotazioni demo intorno a oggi
  const t = todayISO();
  const [sp, ss, sv2] = s.sale;
  const mk = o => ({
    id: uid(), tipo: 'tavolo', tipoEvento: '', titolo: '', nome: '', telefono: '', email: '',
    data: t, ora: '20:00', turno: 'cena', salaId: sp.id, tavolo: '', adulti: 2, bambini: 0,
    stato: 'confermata', esclusiva: false, menuId: '', piatti: [], prezzoPersona: 0, prezzoBambini: 0,
    formula: '', intrattenimento: [], musica: '', servizi: [], costoIntrattenimento: 0,
    intolleranze: [], caparra: 0, sconto: 0, note: '', noteCucina: '', fonte: 'Telefono',
    createdAt: new Date().toISOString(), ...o,
  });
  s.prenotazioni = [
    mk({ nome: 'Rossi Mario', telefono: '333 1234567', adulti: 4, ora: '20:00', tavolo: '5', intolleranze: [{ tipo: 'Celiachia', n: 1, note: 'Moglie' }] }),
    mk({ nome: 'Bianchi Laura', adulti: 2, ora: '20:30', tavolo: '2', stato: 'richiesta', fonte: 'WhatsApp' }),
    mk({ nome: 'Verdi Paolo', adulti: 6, bambini: 2, ora: '13:00', turno: 'pranzo', tavolo: '8' }),
    mk({ nome: 'Esposito Anna', adulti: 3, data: addDays(t, 1), ora: '21:00', tavolo: '3' }),
    mk({
      tipo: 'evento', tipoEvento: 'Compleanno', titolo: '18 anni di Giulia', nome: 'Neri Giulia', telefono: '347 9876543',
      email: 'giulia@example.com', data: addDays(t, 3), ora: '20:00', turno: 'cena', salaId: ss.id, esclusiva: true,
      adulti: 28, bambini: 0, stato: 'caparra', menuId: s.menu[3].id, piatti: [...s.menu[3].piatti],
      prezzoPersona: 25, prezzoBambini: 12, formula: 'Buffet', intrattenimento: ['DJ set', 'Karaoke'], musica: 'si',
      servizi: [s.servizi[1].id, s.servizi[4].id, s.servizi[9].id], caparra: 300,
      intolleranze: [{ tipo: 'Vegano', n: 2, note: '' }, { tipo: 'Allergia: Frutta a guscio', n: 1, note: 'Marco' }],
      note: 'Torta con foto, candeline 1 e 8.', fonte: 'Email',
    }),
    mk({
      tipo: 'evento', tipoEvento: 'Comunione', titolo: 'Prima Comunione di Luca', nome: 'Ferrari Stefano', telefono: '320 5551234',
      data: addDays(t, 10), ora: '13:00', turno: 'pranzo', salaId: sp.id, adulti: 35, bambini: 10, stato: 'opzionata',
      menuId: s.menu[2].id, piatti: [...s.menu[2].piatti], prezzoPersona: 55, prezzoBambini: 25, formula: 'Servito al tavolo',
      intrattenimento: ['Musica di sottofondo', 'Animazione bambini'], musica: 'si',
      servizi: [s.servizi[0].id, s.servizi[3].id, s.servizi[5].id, s.servizi[11].id],
      intolleranze: [{ tipo: 'Celiachia', n: 2, note: 'Nonna e zio' }, { tipo: 'Menu bambino', n: 10, note: '' }],
      note: 'Tavolo imperiale per la famiglia, tavolo bambini separato.', fonte: 'Di persona',
    }),
    mk({
      tipo: 'evento', tipoEvento: 'Evento aziendale', titolo: 'Cena di Natale Acme Srl', nome: 'Acme Srl — Sig.ra Conti', telefono: '02 1234567',
      data: addDays(t, 17), ora: '20:30', turno: 'cena', salaId: sp.id, esclusiva: true, adulti: 55, stato: 'confermata',
      menuId: s.menu[1].id, piatti: [...s.menu[1].piatti], prezzoPersona: 48, formula: 'Servito al tavolo',
      intrattenimento: ['Musica dal vivo'], musica: 'si', servizi: [s.servizi[2].id, s.servizi[6].id, s.servizi[13].id], caparra: 800,
      intolleranze: [{ tipo: 'Vegetariano', n: 4, note: '' }, { tipo: 'Allergia: Crostacei', n: 1, note: '' }],
      fonte: 'Email',
    }),
  ];
  return s;
}

/* =========================================================
   Logica di dominio
   ========================================================= */
const byId = (arr, id) => arr.find(x => x.id === id);
const coperti = p => (+p.adulti || 0) + (+p.bambini || 0);
const isActive = p => STATI_ATTIVI.includes(p.stato);

function turnoFromOra(ora) {
  if (!ora) return S.settings.turni[0]?.id || '';
  for (const t of S.settings.turni) if (ora >= t.start && ora <= t.end) return t.id;
  // fuori fascia: il più vicino all'inizio
  let best = S.settings.turni[0], diff = Infinity;
  for (const t of S.settings.turni) {
    const d = Math.abs(toMin(ora) - toMin(t.start));
    if (d < diff) { diff = d; best = t; }
  }
  return best?.id || '';
}
const toMin = h => { const [a, b] = (h || '0:0').split(':').map(Number); return a * 60 + b; };
const turnoLabel = id => S.settings.turni.find(t => t.id === id)?.label || id || '—';
const salaNome = id => byId(S.sale, id)?.nome || 'Sala n.d.';

function closureInfo(date) {
  const c = S.chiusure.find(c => date >= c.dal && date <= (c.al || c.dal));
  if (c) return { closed: true, motivo: c.motivo || 'Chiusura straordinaria', turni: c.turni || [] };
  const dow = parseISO(date).getDay();
  if (S.settings.chiusuraSettimanale.includes(dow)) return { closed: true, motivo: 'Chiusura settimanale (' + GIORNI[dow] + ')', turni: [] };
  return { closed: false };
}
// turni chiusi: [] = tutto il giorno
function isTurnoClosed(date, turno) {
  const c = closureInfo(date);
  return c.closed && (!c.turni.length || c.turni.includes(turno));
}

function bookingsOn(date, turno, excludeId) {
  return S.prenotazioni.filter(p => p.data === date && (!turno || p.turno === turno) && isActive(p) && p.id !== excludeId);
}

// occupazione per sala per turno, considerando le sale riservate in esclusiva
function occupancy(date, turno, excludeId) {
  const list = bookingsOn(date, turno, excludeId);
  return S.sale.map(s => {
    const bs = list.filter(p => p.salaId === s.id);
    const esclusiva = bs.some(p => p.esclusiva);
    const used = bs.reduce((a, p) => a + coperti(p), 0);
    const tavoliUsati = new Set(bs.map(p => p.tavolo).filter(Boolean)).size;
    return { sala: s, used, cap: s.capienza, free: esclusiva ? 0 : Math.max(0, s.capienza - used), esclusiva, bookings: bs, tavoliUsati };
  });
}
function totalOcc(date, turno) {
  const o = occupancy(date, turno);
  const cap = o.reduce((a, x) => a + x.cap, 0);
  const used = o.reduce((a, x) => a + (x.esclusiva ? x.cap : x.used), 0);
  return { cap, used, ratio: cap ? used / cap : 0, realCovers: o.reduce((a, x) => a + x.used, 0) };
}
const occClass = r => (r >= S.settings.soglieOcc.full ? 'full' : r >= S.settings.soglieOcc.mid ? 'mid' : '');

// verifica disponibilità per una prenotazione (ritorna avvisi)
function checkAvailability(p) {
  const warns = [];
  if (!p.data) return warns;
  const c = closureInfo(p.data);
  if (c.closed && (!c.turni.length || c.turni.includes(p.turno))) warns.push({ lvl: 'danger', msg: `Il locale risulta chiuso: ${c.motivo}.` });
  const occ = occupancy(p.data, p.turno, p.id).find(o => o.sala.id === p.salaId);
  if (occ) {
    const need = coperti(p);
    if (occ.esclusiva) warns.push({ lvl: 'danger', msg: `${occ.sala.nome} è già riservata in esclusiva per questo turno.` });
    else if (p.esclusiva && occ.used > 0) warns.push({ lvl: 'danger', msg: `Esclusiva richiesta ma in ${occ.sala.nome} ci sono già ${occ.used} coperti prenotati.` });
    else if (need > occ.free) warns.push({ lvl: 'danger', msg: `Overbooking: ${occ.sala.nome} ha ${occ.free} posti liberi su ${occ.cap}, richiesti ${need}.` });
    else warns.push({ lvl: 'ok', msg: `Disponibile: ${occ.sala.nome} — ${occ.free} posti liberi su ${occ.cap} (${turnoLabel(p.turno)}).` });
    if (p.tavolo) {
      const clash = occ.bookings.find(b => b.tavolo && b.tavolo.trim().toLowerCase() === p.tavolo.trim().toLowerCase()
        && Math.abs(toMin(b.ora) - toMin(p.ora)) < S.settings.durataTurnoMin);
      if (clash) warns.push({ lvl: 'warn', msg: `Tavolo ${p.tavolo} già assegnato a ${clash.nome} alle ${clash.ora}.` });
    }
  }
  return warns;
}

// piatti del menu in conflitto con le intolleranze dichiarate
function menuConflicts(p) {
  const res = [];
  for (const it of p.intolleranze || []) {
    let allergeni = [], tag = null;
    if (it.tipo.startsWith('Allergia: ')) allergeni = [it.tipo.slice(10)];
    else if (DIETE[it.tipo]) { allergeni = DIETE[it.tipo].allergeni || []; tag = DIETE[it.tipo].tag || null; }
    const bad = (p.piatti || []).map(id => byId(S.piatti, id)).filter(Boolean).filter(d =>
      d.allergeni.some(a => allergeni.includes(a)) || (tag && !(d.tag || []).includes(tag)));
    if (bad.length) res.push({ intol: it, piatti: bad });
  }
  return res;
}

function serviceCost(sv, p) {
  return sv.tipoPrezzo === 'persona' ? sv.prezzo * coperti(p) : sv.prezzo;
}
function preventivo(p) {
  const menuAdulti = (+p.adulti || 0) * num(p.prezzoPersona);
  const menuBambini = (+p.bambini || 0) * num(p.prezzoBambini);
  const servizi = (p.servizi || []).map(id => byId(S.servizi, id)).filter(Boolean).map(sv => ({ sv, costo: serviceCost(sv, p) }));
  const totServizi = servizi.reduce((a, x) => a + x.costo, 0);
  const intr = num(p.costoIntrattenimento);
  const lordo = menuAdulti + menuBambini + totServizi + intr;
  const sconto = num(p.sconto);
  const totale = Math.max(0, lordo - sconto);
  const caparra = num(p.caparra);
  return { menuAdulti, menuBambini, servizi, totServizi, intr, lordo, sconto, totale, caparra, saldo: totale - caparra };
}

/* =========================================================
   Router e rendering
   ========================================================= */
const VIEWS = {
  oggi: { title: 'Oggi', render: renderOggi },
  calendario: { title: 'Calendario', render: renderCalendario },
  giorno: { title: 'Giornata', render: renderGiorno },
  prenotazioni: { title: 'Prenotazioni', render: renderPrenotazioni },
  eventi: { title: 'Eventi', render: renderEventi },
  disponibilita: { title: 'Disponibilità', render: renderDisponibilita },
  menu: { title: 'Menu & Piatti', render: renderMenu },
  servizi: { title: 'Servizi aggiuntivi', render: renderServizi },
  impostazioni: { title: 'Impostazioni', render: renderImpostazioni },
};
const UI = { calMonth: null, filtri: { q: '', stato: '', tipo: '', dal: '', al: '' } };

function route() {
  const [name, arg] = (location.hash.slice(1) || 'oggi').split('/');
  const v = VIEWS[name] || VIEWS.oggi;
  $('#viewTitle').textContent = v.title;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === (name === 'giorno' ? 'calendario' : name)));
  $('#brandName').textContent = S.settings.nome;
  document.title = 'Agenda — ' + S.settings.nome;
  $('#view').innerHTML = '';
  v.render($('#view'), arg);
}
function rerender() { save(); route(); }

/* ---------- componenti condivisi ---------- */
function statoBadge(st) {
  const s = STATI[st] || { label: st, cls: '' };
  return `<span class="badge ${s.cls}">${esc(s.label)}</span>`;
}
function bookingItem(p, showDate = false) {
  const intol = (p.intolleranze || []).reduce((a, x) => a + (+x.n || 0), 0);
  const conf = menuConflicts(p).length;
  return `<div class="booking st-${p.stato}" data-open="${p.id}">
    <div><div class="time">${esc(p.ora || '--:--')}</div>${showDate ? `<div class="small muted">${esc(fmtDate(p.data, { day: 'numeric', month: 'short' }))}</div>` : ''}</div>
    <div>
      <div class="who">${p.tipo === 'evento' ? '🎉 ' + esc(p.titolo || p.tipoEvento || 'Evento') + ' · ' : ''}${esc(p.nome || 'Senza nome')}</div>
      <div class="meta">
        <span>${esc(salaNome(p.salaId))}${p.tavolo ? ' · Tav. ' + esc(p.tavolo) : ''}</span>
        <span>${esc(turnoLabel(p.turno))}</span>
        ${p.telefono ? `<span>📞 ${esc(p.telefono)}</span>` : ''}
        ${p.formula ? `<span>🍽️ ${esc(p.formula)}</span>` : ''}
        ${(p.intrattenimento || []).length ? `<span>🎵 ${esc(p.intrattenimento.join(', '))}</span>` : ''}
      </div>
      <div class="tags" style="margin-top:4px">
        ${statoBadge(p.stato)}
        ${p.esclusiva ? '<span class="badge primary">Sala in esclusiva</span>' : ''}
        ${intol ? `<span class="badge warn">⚠️ ${intol} con intolleranze</span>` : ''}
        ${conf ? `<span class="badge danger">Menu da verificare</span>` : ''}
        ${p.note ? '<span class="badge">📝 note</span>' : ''}
      </div>
    </div>
    <div class="covers">${coperti(p)}<small>coperti${p.bambini ? ` (${p.bambini} bimbi)` : ''}</small></div>
  </div>`;
}
function bindOpen(root) {
  $$('[data-open]', root).forEach(el => el.addEventListener('click', () => openBooking(byId(S.prenotazioni, el.dataset.open))));
}
function occBar(label, used, cap, extra = '') {
  const r = cap ? used / cap : 0;
  return `<div class="occ"><div class="occ-head"><span>${label}</span><span><b>${used}</b> / ${cap} ${extra}</span></div>
    <div class="occ-bar ${occClass(r)}"><span style="width:${Math.min(100, r * 100).toFixed(0)}%"></span></div></div>`;
}

/* ---------- OGGI ---------- */
function renderOggi(el) {
  const t = todayISO();
  const today = S.prenotazioni.filter(p => p.data === t && p.stato !== 'annullata').sort((a, b) => a.ora.localeCompare(b.ora));
  const nextEvents = S.prenotazioni.filter(p => p.tipo === 'evento' && p.data >= t && isActive(p)).sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora)).slice(0, 6);
  const daConfermare = S.prenotazioni.filter(p => p.data >= t && ['richiesta', 'opzionata'].includes(p.stato));
  const cop = today.filter(isActive).reduce((a, p) => a + coperti(p), 0);
  const intolToday = today.filter(isActive).flatMap(p => (p.intolleranze || []).map(i => ({ ...i, p })));
  const closed = closureInfo(t);
  const week = [...Array(7)].map((_, i) => addDays(t, i));
  const copWeek = S.prenotazioni.filter(p => p.data >= t && p.data <= week[6] && isActive(p)).reduce((a, p) => a + coperti(p), 0);

  el.innerHTML = `
    <div class="muted" style="margin-bottom:12px;text-transform:capitalize">${esc(fmtLong(t))}</div>
    ${closed.closed ? `<div class="alert warn">🔒 ${esc(closed.motivo)}${closed.turni.length ? ' — turni: ' + closed.turni.map(turnoLabel).join(', ') : ''}</div>` : ''}
    <div class="grid cols-4">
      <div class="card stat"><div class="label">Coperti oggi</div><div class="value">${cop}</div><div class="sub">${today.filter(isActive).length} prenotazioni</div></div>
      <div class="card stat"><div class="label">Prossimi 7 giorni</div><div class="value">${copWeek}</div><div class="sub">coperti prenotati</div></div>
      <div class="card stat"><div class="label">Da confermare</div><div class="value">${daConfermare.length}</div><div class="sub">richieste / opzioni</div></div>
      <div class="card stat"><div class="label">Eventi in arrivo</div><div class="value">${nextEvents.length}</div><div class="sub">confermati o in trattativa</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div>
        ${S.settings.turni.map(tu => {
          const list = today.filter(p => p.turno === tu.id);
          const o = totalOcc(t, tu.id);
          return `<div class="card">
            <div class="card-head"><h3>${esc(tu.label)} <span class="muted small">${esc(tu.start)}–${esc(tu.end)}</span></h3>
              <button class="btn sm" data-new="${t}|${tu.id}">+ Aggiungi</button></div>
            ${occBar('Occupazione', o.used, o.cap, 'posti')}
            <div style="margin-top:10px">${list.length ? list.map(p => bookingItem(p)).join('') : '<div class="empty">Nessuna prenotazione</div>'}</div>
          </div>`;
        }).join('')}
      </div>
      <div>
        <div class="card">
          <div class="card-head"><h3>⚠️ Intolleranze di oggi (per la cucina)</h3></div>
          ${intolToday.length ? `<table><thead><tr><th>Ora</th><th>Cliente</th><th>Esigenza</th><th>N.</th><th>Note</th></tr></thead><tbody>
            ${intolToday.map(i => `<tr class="clickable" data-open="${i.p.id}"><td>${esc(i.p.ora)}</td><td>${esc(i.p.nome)}${i.p.tavolo ? ' · T' + esc(i.p.tavolo) : ''}</td><td><b>${esc(i.tipo)}</b></td><td>${esc(i.n)}</td><td>${esc(i.note)}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">Nessuna intolleranza segnalata</div>'}
        </div>
        <div class="card">
          <div class="card-head"><h3>🎉 Prossimi eventi</h3><a href="#eventi" class="small">Tutti →</a></div>
          ${nextEvents.length ? nextEvents.map(p => bookingItem(p, true)).join('') : '<div class="empty">Nessun evento in programma</div>'}
        </div>
        <div class="card">
          <div class="card-head"><h3>⏳ Da confermare</h3></div>
          ${daConfermare.length ? daConfermare.slice(0, 8).map(p => bookingItem(p, true)).join('') : '<div class="empty">Tutto confermato 👍</div>'}
        </div>
      </div>
    </div>`;
  bindOpen(el);
  $$('[data-new]', el).forEach(b => b.addEventListener('click', () => {
    const [data, turno] = b.dataset.new.split('|');
    openBooking(null, { data, turno, ora: S.settings.turni.find(x => x.id === turno)?.start });
  }));
}

/* ---------- CALENDARIO ---------- */
function renderCalendario(el) {
  if (!UI.calMonth) UI.calMonth = todayISO().slice(0, 7);
  const [y, m] = UI.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // lunedì = 0
  const start = new Date(y, m - 1, 1 - startOffset);
  const days = [...Array(42)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return isoDate(d); });
  const t = todayISO();
  const monthName = first.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  el.innerHTML = `
    <div class="cal-head">
      <button class="btn" id="calPrev">‹</button>
      <h2>${esc(monthName)}</h2>
      <button class="btn" id="calNext">›</button>
      <button class="btn" id="calToday">Oggi</button>
      <span class="spacer" style="flex:1"></span>
      <span class="small muted">Legenda:</span>
      <span class="badge ok">libero</span><span class="badge warn">quasi pieno</span><span class="badge danger">pieno</span><span class="badge primary">evento</span>
    </div>
    <div class="cal">
      ${GIORNI_BREVI.map(g => `<div class="dow">${g}</div>`).join('')}
      ${days.map(d => {
        const ci = closureInfo(d);
        const evs = S.prenotazioni.filter(p => p.data === d && p.tipo === 'evento' && isActive(p));
        const fullClosed = ci.closed && !ci.turni.length;
        return `<div class="day ${d.slice(0, 7) !== UI.calMonth ? 'other' : ''} ${d === t ? 'today' : ''} ${fullClosed ? 'closed' : ''}" data-day="${d}">
          <div class="num"><span>${parseISO(d).getDate()}</span>${fullClosed ? '<span class="small muted closed-lbl">chiuso</span>' : ''}${evs.length ? '<span class="evdot">🎉</span>' : ''}</div>
          ${fullClosed ? '' : S.settings.turni.map(tu => {
            if (isTurnoClosed(d, tu.id)) return `<div class="turn full"><span>${esc(tu.label)}</span><span>chiuso</span></div>`;
            const o = totalOcc(d, tu.id);
            if (!o.realCovers && !o.used) return '';
            return `<div class="turn ${occClass(o.ratio)}"><span>${esc(tu.label)}</span><span>${o.realCovers}/${o.cap}</span></div>`;
          }).join('')}
          ${evs.map(p => `<div class="ev" title="${esc(p.titolo || p.tipoEvento)}">🎉 ${esc(p.titolo || p.tipoEvento)}</div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  const shift = n => { const d = new Date(y, m - 1 + n, 1); UI.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; route(); };
  $('#calPrev').onclick = () => shift(-1);
  $('#calNext').onclick = () => shift(1);
  $('#calToday').onclick = () => { UI.calMonth = t.slice(0, 7); route(); };
  $$('[data-day]', el).forEach(d => d.addEventListener('click', () => (location.hash = 'giorno/' + d.dataset.day)));
}

/* ---------- GIORNO ---------- */
function renderGiorno(el, date) {
  date = date || todayISO();
  const ci = closureInfo(date);
  el.innerHTML = `
    <div class="cal-head">
      <button class="btn" id="dPrev">‹</button>
      <h2 style="text-transform:capitalize">${esc(fmtLong(date))}</h2>
      <button class="btn" id="dNext">›</button>
      <input type="date" id="dPick" value="${date}" style="width:auto">
      <span style="flex:1"></span>
      <a class="btn" href="#calendario">← Calendario</a>
    </div>
    ${ci.closed ? `<div class="alert warn">🔒 ${esc(ci.motivo)}${ci.turni.length ? ' — turni: ' + ci.turni.map(turnoLabel).join(', ') : ''}</div>` : ''}
    <div class="grid cols-2">
      ${S.settings.turni.map(tu => {
        const list = S.prenotazioni.filter(p => p.data === date && p.turno === tu.id).sort((a, b) => a.ora.localeCompare(b.ora));
        const occ = occupancy(date, tu.id);
        return `<div class="card">
          <div class="card-head"><h3>${esc(tu.label)} <span class="small muted">${esc(tu.start)}–${esc(tu.end)}</span></h3>
            <button class="btn sm primary" data-new="${tu.id}">+ Prenota</button></div>
          ${occ.map(o => occBar(esc(o.sala.nome) + (o.esclusiva ? ' <span class="badge primary">esclusiva</span>' : ''), o.esclusiva ? o.cap : o.used, o.cap,
            `· ${o.esclusiva ? 0 : o.free} liberi${o.sala.tavoli ? ` · tavoli ${o.tavoliUsati}/${o.sala.tavoli}` : ''}`)).join('')}
          <div style="margin-top:12px">${list.length ? list.map(p => bookingItem(p)).join('') : '<div class="empty">Nessuna prenotazione</div>'}</div>
        </div>`;
      }).join('')}
    </div>`;
  $('#dPrev').onclick = () => (location.hash = 'giorno/' + addDays(date, -1));
  $('#dNext').onclick = () => (location.hash = 'giorno/' + addDays(date, 1));
  $('#dPick').onchange = e => e.target.value && (location.hash = 'giorno/' + e.target.value);
  $$('[data-new]', el).forEach(b => b.addEventListener('click', () =>
    openBooking(null, { data: date, turno: b.dataset.new, ora: S.settings.turni.find(x => x.id === b.dataset.new)?.start })));
  bindOpen(el);
}

/* ---------- LISTA PRENOTAZIONI ---------- */
function filterList(list) {
  const f = UI.filtri, q = f.q.trim().toLowerCase();
  return list.filter(p =>
    (!q || [p.nome, p.telefono, p.email, p.titolo, p.tipoEvento, p.note, p.tavolo].join(' ').toLowerCase().includes(q)) &&
    (!f.stato || p.stato === f.stato) &&
    (!f.tipo || p.tipo === f.tipo) &&
    (!f.dal || p.data >= f.dal) && (!f.al || p.data <= f.al));
}
function filtersBar(withTipo = true) {
  const f = UI.filtri;
  return `<div class="toolbar">
    <input type="search" id="fQ" placeholder="Cerca nome, telefono, note…" value="${esc(f.q)}" style="max-width:260px">
    <select id="fStato" style="width:auto"><option value="">Tutti gli stati</option>${Object.entries(STATI).map(([k, v]) => `<option value="${k}" ${f.stato === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
    ${withTipo ? `<select id="fTipo" style="width:auto"><option value="">Tavoli + eventi</option><option value="tavolo" ${f.tipo === 'tavolo' ? 'selected' : ''}>Solo tavoli</option><option value="evento" ${f.tipo === 'evento' ? 'selected' : ''}>Solo eventi</option></select>` : ''}
    <label class="small muted">dal <input type="date" id="fDal" value="${esc(f.dal)}" style="width:auto"></label>
    <label class="small muted">al <input type="date" id="fAl" value="${esc(f.al)}" style="width:auto"></label>
    <button class="btn sm ghost" id="fReset">Azzera</button>
    <span class="spacer"></span>
    <button class="btn sm" id="fCsv">⬇ CSV</button>
  </div>`;
}
function bindFilters(el, list) {
  const upd = () => {
    UI.filtri = { q: $('#fQ').value, stato: $('#fStato').value, tipo: $('#fTipo')?.value || '', dal: $('#fDal').value, al: $('#fAl').value };
    route();
    const q = $('#fQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  };
  ['#fStato', '#fTipo', '#fDal', '#fAl'].forEach(s => $(s, el)?.addEventListener('change', upd));
  let deb; $('#fQ').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(upd, 250); });
  $('#fReset').onclick = () => { UI.filtri = { q: '', stato: '', tipo: '', dal: '', al: '' }; route(); };
  $('#fCsv').onclick = () => exportCSV(list);
}

function renderPrenotazioni(el) {
  if (UI.filtri.dal === '' && !renderPrenotazioni._init) { UI.filtri.dal = todayISO(); renderPrenotazioni._init = true; }
  const list = filterList(S.prenotazioni).sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora));
  el.innerHTML = filtersBar() + `<div class="card"><div class="table-wrap"><table>
    <thead><tr><th>Data</th><th>Ora</th><th>Cliente</th><th>Tipo</th><th class="right">Coperti</th><th>Sala / Tavolo</th><th>Stato</th><th>Esigenze</th><th class="right">Totale</th></tr></thead>
    <tbody>${list.map(p => {
      const pr = preventivo(p);
      const intol = (p.intolleranze || []).map(i => `${i.n}× ${i.tipo.replace('Allergia: ', '')}`).join(', ');
      return `<tr class="clickable" data-open="${p.id}">
        <td class="nowrap">${esc(fmtDate(p.data))}</td><td>${esc(p.ora)}</td>
        <td><b>${esc(p.nome)}</b><div class="small muted">${esc(p.telefono)}</div></td>
        <td>${p.tipo === 'evento' ? `<span class="badge primary">${esc(p.tipoEvento || 'Evento')}</span>` : '<span class="small muted">Tavolo</span>'}</td>
        <td class="right"><b>${coperti(p)}</b>${p.bambini ? `<div class="small muted">${p.bambini} bimbi</div>` : ''}</td>
        <td>${esc(salaNome(p.salaId))}${p.tavolo ? `<div class="small muted">Tav. ${esc(p.tavolo)}</div>` : ''}</td>
        <td>${statoBadge(p.stato)}</td>
        <td class="small">${intol ? '⚠️ ' + esc(intol) : ''}</td>
        <td class="right nowrap">${pr.totale ? eur(pr.totale) : '—'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">Nessuna prenotazione con questi filtri</td></tr>'}</tbody></table></div></div>
    <p class="small muted">${list.length} risultati · ${list.filter(isActive).reduce((a, p) => a + coperti(p), 0)} coperti attivi</p>`;
  bindFilters(el, list);
  bindOpen(el);
}

/* ---------- EVENTI ---------- */
function renderEventi(el) {
  const saved = UI.filtri.tipo;
  UI.filtri.tipo = 'evento';
  const list = filterList(S.prenotazioni).sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora));
  UI.filtri.tipo = saved;
  el.innerHTML = filtersBar(false) + (list.length ? `<div class="grid cols-2">${list.map(p => {
    const pr = preventivo(p), menu = byId(S.menu, p.menuId), conf = menuConflicts(p);
    return `<div class="card" style="cursor:pointer" data-open="${p.id}">
      <div class="card-head">
        <div><h3>🎉 ${esc(p.titolo || p.tipoEvento || 'Evento')}</h3>
          <div class="small muted" style="text-transform:capitalize">${esc(fmtLong(p.data))} · ${esc(p.ora)}</div></div>
        ${statoBadge(p.stato)}
      </div>
      <dl class="sheet"><div class="kv">
        <dt>Cliente</dt><dd>${esc(p.nome)} ${p.telefono ? '· ' + esc(p.telefono) : ''}</dd>
        <dt>Ospiti</dt><dd><b>${coperti(p)}</b> (${p.adulti} adulti${p.bambini ? `, ${p.bambini} bambini` : ''})</dd>
        <dt>Sala</dt><dd>${esc(salaNome(p.salaId))}${p.esclusiva ? ' <span class="badge primary">esclusiva</span>' : ''}</dd>
        <dt>Formula</dt><dd>${esc(p.formula || '—')}</dd>
        <dt>Menu</dt><dd>${esc(menu?.nome || (p.piatti?.length ? 'Personalizzato' : '—'))}${p.piatti?.length ? ` <span class="muted small">(${p.piatti.length} piatti)</span>` : ''}</dd>
        <dt>Musica / Intratt.</dt><dd>${p.musica === 'no' ? 'Nessuna musica' : esc((p.intrattenimento || []).join(', ') || '—')}</dd>
        <dt>Servizi extra</dt><dd>${esc((p.servizi || []).map(id => byId(S.servizi, id)?.nome).filter(Boolean).join(', ') || '—')}</dd>
        <dt>Intolleranze</dt><dd>${esc((p.intolleranze || []).map(i => `${i.n}× ${i.tipo}`).join(', ') || 'Nessuna')}</dd>
        <dt>Preventivo</dt><dd><b>${eur(pr.totale)}</b> · caparra ${eur(pr.caparra)} · saldo ${eur(pr.saldo)}</dd>
      </div></dl>
      ${conf.length ? `<div class="alert danger">⚠️ ${conf.length} conflitto/i tra menu e intolleranze</div>` : ''}
    </div>`;
  }).join('')}</div>` : '<div class="card empty">Nessun evento. Crea il primo con “+ Evento”.</div>');
  bindFilters(el, list);
  bindOpen(el);
}

/* ---------- DISPONIBILITÀ ---------- */
function renderDisponibilita(el) {
  const st = S.settings;
  const dChk = UI.dispDate || todayISO();
  el.innerHTML = `
    <div class="grid cols-2">
      <div>
        <div class="card">
          <div class="card-head"><h3>🔎 Verifica disponibilità</h3>
            <input type="date" id="chkDate" value="${dChk}" style="width:auto"></div>
          <div id="chkOut"></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>📆 Prossimi 14 giorni</h3></div>
          <div class="table-wrap"><table><thead><tr><th>Giorno</th>${st.turni.map(t => `<th>${esc(t.label)}</th>`).join('')}</tr></thead><tbody>
          ${[...Array(14)].map((_, i) => {
            const d = addDays(todayISO(), i);
            return `<tr class="clickable" data-goday="${d}"><td class="nowrap">${esc(fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }))}</td>
              ${st.turni.map(t => {
                if (isTurnoClosed(d, t.id)) return '<td><span class="badge">chiuso</span></td>';
                const o = totalOcc(d, t.id);
                return `<td><span class="badge ${occClass(o.ratio) === 'full' ? 'danger' : occClass(o.ratio) === 'mid' ? 'warn' : 'ok'}">${o.cap - o.used} liberi</span> <span class="small muted">${o.realCovers}/${o.cap}</span></td>`;
              }).join('')}</tr>`;
          }).join('')}
          </tbody></table></div>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-head"><h3>🪑 Sale e capienza</h3><button class="btn sm" id="addSala">+ Sala</button></div>
          <table><thead><tr><th>Sala</th><th class="right">Coperti</th><th class="right">Tavoli</th><th>Note</th><th></th></tr></thead><tbody>
          ${S.sale.map(s => `<tr><td><b>${esc(s.nome)}</b></td><td class="right">${s.capienza}</td><td class="right">${s.tavoli || '—'}</td><td class="small muted">${esc(s.note)}</td>
            <td class="right nowrap"><button class="btn sm" data-edsala="${s.id}">Modifica</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Aggiungi almeno una sala</td></tr>'}
          </tbody></table>
          <p class="small muted">Capienza totale: <b>${S.sale.reduce((a, s) => a + (+s.capienza || 0), 0)}</b> coperti per turno.</p>
        </div>
        <div class="card">
          <div class="card-head"><h3>⏰ Turni e orari</h3><button class="btn sm" id="addTurno">+ Turno</button></div>
          <div id="turniBox" class="row-list">
          ${st.turni.map((t, i) => `<div class="row" style="grid-template-columns:1.3fr 1fr 1fr auto">
            <input data-t="${i}" data-k="label" value="${esc(t.label)}" placeholder="Nome turno">
            <input type="time" data-t="${i}" data-k="start" value="${esc(t.start)}">
            <input type="time" data-t="${i}" data-k="end" value="${esc(t.end)}">
            <button class="btn sm danger" data-deltur="${i}" ${st.turni.length < 2 ? 'disabled' : ''}>✕</button></div>`).join('')}
          </div>
          <label class="field" style="max-width:260px">Durata media tavolo (minuti)<input type="number" id="durata" min="30" step="15" value="${st.durataTurnoMin}"></label>
        </div>
        <div class="card">
          <div class="card-head"><h3>🔒 Chiusure</h3></div>
          <div class="small muted" style="margin-bottom:6px">Giorni di chiusura settimanale</div>
          <div class="pill-choice">${[1, 2, 3, 4, 5, 6, 0].map(g => `<label><input type="checkbox" data-dow="${g}" ${st.chiusuraSettimanale.includes(g) ? 'checked' : ''}>${GIORNI[g]}</label>`).join('')}</div>
          <div class="small muted" style="margin:14px 0 6px">Chiusure straordinarie / ferie / turni bloccati</div>
          <table><tbody>
          ${S.chiusure.slice().sort((a, b) => a.dal.localeCompare(b.dal)).map(c => `<tr><td class="nowrap">${esc(fmtDate(c.dal))}${c.al && c.al !== c.dal ? ' → ' + esc(fmtDate(c.al)) : ''}</td>
            <td>${esc(c.motivo || '')}</td><td class="small">${c.turni?.length ? c.turni.map(turnoLabel).join(', ') : 'Tutto il giorno'}</td>
            <td class="right"><button class="btn sm danger" data-delchi="${c.id}">✕</button></td></tr>`).join('') || '<tr><td class="muted small">Nessuna chiusura programmata</td></tr>'}
          </tbody></table>
          <div class="form-grid" style="margin-top:10px">
            <label class="field">Dal<input type="date" id="chDal"></label>
            <label class="field">Al<input type="date" id="chAl"></label>
            <label class="field span-2">Motivo<input id="chMot" placeholder="Ferie, evento privato, inventario…"></label>
            <div class="span-3 pill-choice">${st.turni.map(t => `<label><input type="checkbox" data-chturno="${t.id}">Solo ${esc(t.label)}</label>`).join('')}</div>
            <button class="btn primary" id="chAdd">Aggiungi chiusura</button>
          </div>
        </div>
      </div>
    </div>`;

  const renderChk = () => {
    const d = $('#chkDate').value || todayISO();
    UI.dispDate = d;
    const ci = closureInfo(d);
    $('#chkOut').innerHTML = (ci.closed ? `<div class="alert warn">🔒 ${esc(ci.motivo)}</div>` : '') +
      st.turni.map(t => isTurnoClosed(d, t.id) ? `<h4 style="margin:10px 0 4px">${esc(t.label)} — chiuso</h4>` :
        `<h4 style="margin:10px 0 4px">${esc(t.label)}</h4>` + occupancy(d, t.id).map(o =>
          occBar(esc(o.sala.nome) + (o.esclusiva ? ' <span class="badge primary">esclusiva</span>' : ''), o.esclusiva ? o.cap : o.used, o.cap, `· <b>${o.free}</b> liberi`)).join('')).join('') +
      `<div style="margin-top:10px"><a class="btn sm" href="#giorno/${d}">Apri la giornata →</a></div>`;
  };
  $('#chkDate').onchange = renderChk; renderChk();
  $$('[data-goday]', el).forEach(r => r.onclick = () => (location.hash = 'giorno/' + r.dataset.goday));
  $('#addSala').onclick = () => editSala();
  $$('[data-edsala]', el).forEach(b => b.onclick = () => editSala(byId(S.sale, b.dataset.edsala)));
  $$('[data-t]', el).forEach(i => i.onchange = () => { st.turni[+i.dataset.t][i.dataset.k] = i.value; rerender(); });
  $$('[data-deltur]', el).forEach(b => b.onclick = () => { if (confirm('Eliminare questo turno?')) { st.turni.splice(+b.dataset.deltur, 1); rerender(); } });
  $('#addTurno').onclick = () => { st.turni.push({ id: uid(), label: 'Nuovo turno', start: '18:00', end: '20:00' }); rerender(); };
  $('#durata').onchange = e => { st.durataTurnoMin = +e.target.value || 120; rerender(); };
  $$('[data-dow]', el).forEach(c => c.onchange = () => {
    st.chiusuraSettimanale = $$('[data-dow]', el).filter(x => x.checked).map(x => +x.dataset.dow); rerender();
  });
  $$('[data-delchi]', el).forEach(b => b.onclick = () => { S.chiusure = S.chiusure.filter(c => c.id !== b.dataset.delchi); rerender(); });
  $('#chAdd').onclick = () => {
    const dal = $('#chDal').value; if (!dal) return toast('Indica la data di inizio');
    const al = $('#chAl').value && $('#chAl').value >= dal ? $('#chAl').value : dal;
    S.chiusure.push({ id: uid(), dal, al, motivo: $('#chMot').value, turni: $$('[data-chturno]', el).filter(x => x.checked).map(x => x.dataset.chturno) });
    rerender(); toast('Chiusura aggiunta');
  };
}

function editSala(s) {
  const isNew = !s;
  s = s || { id: uid(), nome: '', capienza: 20, tavoli: 5, note: '' };
  openModal(isNew ? 'Nuova sala' : 'Modifica sala', `
    <div class="form-grid">
      <label class="field span-2">Nome<input id="sNome" value="${esc(s.nome)}"></label>
      <label class="field">Coperti max<input type="number" id="sCap" min="1" value="${s.capienza}"></label>
      <label class="field">N. tavoli<input type="number" id="sTav" min="0" value="${s.tavoli || 0}"></label>
      <label class="field span-4">Note<input id="sNote" value="${esc(s.note)}"></label>
    </div>
    <div class="modal-foot">${isNew ? '' : '<button class="btn danger" id="sDel">Elimina</button>'}<span class="spacer"></span>
      <button class="btn" data-close>Annulla</button><button class="btn primary" id="sSave">Salva</button></div>`);
  $('#sSave').onclick = () => {
    s.nome = $('#sNome').value.trim() || 'Sala'; s.capienza = +$('#sCap').value || 0; s.tavoli = +$('#sTav').value || 0; s.note = $('#sNote').value;
    if (isNew) S.sale.push(s);
    closeModal(); rerender();
  };
  $('#sDel')?.addEventListener('click', () => {
    if (S.prenotazioni.some(p => p.salaId === s.id)) return toast('Ci sono prenotazioni su questa sala: spostale prima');
    if (confirm('Eliminare la sala?')) { S.sale = S.sale.filter(x => x.id !== s.id); closeModal(); rerender(); }
  });
}

/* ---------- MENU ---------- */
function allergenBadges(d) {
  return `${(d.allergeni || []).map(a => `<span class="badge warn">${esc(a)}</span>`).join('')}
    ${(d.tag || []).map(t => `<span class="badge ok">${esc(t)}</span>`).join('')}`;
}
function renderMenu(el) {
  el.innerHTML = `
    <div class="grid cols-2">
      <div>
        <div class="card">
          <div class="card-head"><h3>📖 Menu composti</h3><button class="btn sm primary" id="addMenu">+ Componi menu</button></div>
          ${S.menu.map(m => {
            const dishes = m.piatti.map(id => byId(S.piatti, id)).filter(Boolean);
            const all = [...new Set(dishes.flatMap(d => d.allergeni))];
            const costo = dishes.reduce((a, d) => a + num(d.prezzo), 0);
            return `<div class="card" style="box-shadow:none">
              <div class="card-head"><div><h3>${esc(m.nome)}</h3><div class="small muted">${esc(m.descrizione)}</div></div>
                <div class="right"><b>${eur(m.prezzoPersona)}</b><div class="small muted">bimbi ${eur(m.prezzoBambini)}</div></div></div>
              ${PORTATE.map(([k, lab]) => {
                const ds = dishes.filter(d => d.portata === k);
                return ds.length ? `<div class="course-title">${lab}</div>${ds.map(d => `<div class="small">• ${esc(d.nome)}</div>`).join('')}` : '';
              }).join('')}
              <div class="tags" style="margin-top:8px"><span class="small muted">Allergeni:</span> ${all.length ? all.map(a => `<span class="badge warn">${esc(a)}</span>`).join('') : '<span class="badge ok">nessuno</span>'}</div>
              <div class="small muted" style="margin-top:4px">Valore piatti alla carta: ${eur(costo)}</div>
              <div style="margin-top:8px;display:flex;gap:6px"><button class="btn sm" data-edmenu="${m.id}">Modifica</button><button class="btn sm" data-dupmenu="${m.id}">Duplica</button></div>
            </div>`;
          }).join('') || '<div class="empty">Nessun menu</div>'}
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-head"><h3>🍝 Piatti</h3><button class="btn sm primary" id="addPiatto">+ Piatto</button></div>
          ${PORTATE.map(([k, lab]) => {
            const ds = S.piatti.filter(d => d.portata === k);
            return ds.length ? `<div class="course-title">${lab}</div>${ds.map(d => `<div class="dish">
              <div><div class="name">${esc(d.nome)}</div><div class="tags" style="margin-top:3px">${allergenBadges(d)}</div></div>
              <div class="right nowrap">${eur(d.prezzo)}<br><button class="btn sm ghost" data-edpiatto="${d.id}">Modifica</button></div></div>`).join('')}` : '';
          }).join('') || '<div class="empty">Nessun piatto</div>'}
        </div>
      </div>
    </div>`;
  $('#addMenu').onclick = () => editMenu();
  $('#addPiatto').onclick = () => editPiatto();
  $$('[data-edmenu]', el).forEach(b => b.onclick = () => editMenu(byId(S.menu, b.dataset.edmenu)));
  $$('[data-dupmenu]', el).forEach(b => b.onclick = () => {
    const m = byId(S.menu, b.dataset.dupmenu);
    S.menu.push({ ...m, id: uid(), nome: m.nome + ' (copia)', piatti: [...m.piatti] }); rerender();
  });
  $$('[data-edpiatto]', el).forEach(b => b.onclick = () => editPiatto(byId(S.piatti, b.dataset.edpiatto)));
}

function dishPicker(selected, flaggedIds = new Set()) {
  return PORTATE.map(([k, lab]) => {
    const ds = S.piatti.filter(d => d.portata === k);
    if (!ds.length) return '';
    return `<div class="course-title">${lab}</div>
      ${ds.map(d => `<div class="dish ${flaggedIds.has(d.id) ? 'flagged' : ''}"><label class="check" style="align-items:flex-start">
        <input type="checkbox" class="pick-dish" value="${d.id}" ${selected.includes(d.id) ? 'checked' : ''}>
        <span><span class="name">${esc(d.nome)}</span><span class="tags" style="margin-top:3px">${allergenBadges(d)}</span></span></label>
        <span class="small muted nowrap">${eur(d.prezzo)}</span></div>`).join('')}`;
  }).join('');
}

function editMenu(m) {
  const isNew = !m;
  m = m || { id: uid(), nome: '', descrizione: '', prezzoPersona: 35, prezzoBambini: 18, piatti: [] };
  openModal(isNew ? 'Componi nuovo menu' : 'Modifica menu', `
    <div class="form-grid">
      <label class="field span-2">Nome menu<input id="mNome" value="${esc(m.nome)}" placeholder="Es. Menu Matrimonio Gold"></label>
      <label class="field">Prezzo adulto €<input type="number" step="0.5" id="mPA" value="${m.prezzoPersona}"></label>
      <label class="field">Prezzo bambino €<input type="number" step="0.5" id="mPB" value="${m.prezzoBambini}"></label>
      <label class="field span-4">Descrizione<input id="mDesc" value="${esc(m.descrizione)}"></label>
    </div>
    <fieldset class="section" style="margin-top:14px"><legend>Composizione (seleziona i piatti per portata)</legend>
      <div id="mPick">${dishPicker(m.piatti)}</div>
      <div class="small muted" id="mSum" style="margin-top:8px"></div>
    </fieldset>
    <div class="modal-foot">${isNew ? '' : '<button class="btn danger" id="mDel">Elimina</button>'}<span class="spacer"></span>
      <button class="btn" data-close>Annulla</button><button class="btn primary" id="mSave">Salva menu</button></div>`);
  const sum = () => {
    const ids = $$('.pick-dish').filter(c => c.checked).map(c => c.value);
    const ds = ids.map(id => byId(S.piatti, id));
    const all = [...new Set(ds.flatMap(d => d.allergeni))];
    $('#mSum').innerHTML = `${ids.length} piatti · valore alla carta ${eur(ds.reduce((a, d) => a + num(d.prezzo), 0))} · allergeni: ${all.join(', ') || 'nessuno'}`;
  };
  $$('.pick-dish').forEach(c => c.onchange = sum); sum();
  $('#mSave').onclick = () => {
    m.nome = $('#mNome').value.trim() || 'Menu senza nome'; m.descrizione = $('#mDesc').value;
    m.prezzoPersona = num($('#mPA').value); m.prezzoBambini = num($('#mPB').value);
    m.piatti = $$('.pick-dish').filter(c => c.checked).map(c => c.value);
    if (isNew) S.menu.push(m);
    closeModal(); rerender(); toast('Menu salvato');
  };
  $('#mDel')?.addEventListener('click', () => { if (confirm('Eliminare il menu?')) { S.menu = S.menu.filter(x => x.id !== m.id); closeModal(); rerender(); } });
}

function editPiatto(d) {
  const isNew = !d;
  d = d || { id: uid(), nome: '', portata: 'antipasto', prezzo: 0, allergeni: [], tag: [], descrizione: '' };
  openModal(isNew ? 'Nuovo piatto' : 'Modifica piatto', `
    <div class="form-grid">
      <label class="field span-2">Nome<input id="dNome" value="${esc(d.nome)}"></label>
      <label class="field">Portata<select id="dPort">${PORTATE.map(([k, l]) => `<option value="${k}" ${d.portata === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Prezzo €<input type="number" step="0.5" id="dPrezzo" value="${d.prezzo}"></label>
      <label class="field span-4">Descrizione / ingredienti<input id="dDesc" value="${esc(d.descrizione || '')}"></label>
    </div>
    <fieldset class="section" style="margin-top:14px"><legend>Allergeni presenti (Reg. UE 1169/2011)</legend>
      <div class="check-grid">${ALLERGENI.map(a => `<label class="check"><input type="checkbox" class="d-all" value="${a}" ${d.allergeni.includes(a) ? 'checked' : ''}>${a}</label>`).join('')}</div>
    </fieldset>
    <fieldset class="section"><legend>Adatto a</legend>
      <div class="pill-choice">${['vegetariano', 'vegano'].map(t => `<label><input type="checkbox" class="d-tag" value="${t}" ${(d.tag || []).includes(t) ? 'checked' : ''}>${t}</label>`).join('')}</div>
    </fieldset>
    <div class="modal-foot">${isNew ? '' : '<button class="btn danger" id="dDel">Elimina</button>'}<span class="spacer"></span>
      <button class="btn" data-close>Annulla</button><button class="btn primary" id="dSave">Salva</button></div>`);
  $('#dSave').onclick = () => {
    d.nome = $('#dNome').value.trim() || 'Piatto'; d.portata = $('#dPort').value; d.prezzo = num($('#dPrezzo').value); d.descrizione = $('#dDesc').value;
    d.allergeni = $$('.d-all').filter(c => c.checked).map(c => c.value);
    d.tag = $$('.d-tag').filter(c => c.checked).map(c => c.value);
    if (isNew) S.piatti.push(d);
    closeModal(); rerender();
  };
  $('#dDel')?.addEventListener('click', () => {
    if (!confirm('Eliminare il piatto? Verrà rimosso anche dai menu.')) return;
    S.piatti = S.piatti.filter(x => x.id !== d.id);
    S.menu.forEach(m => (m.piatti = m.piatti.filter(id => id !== d.id)));
    closeModal(); rerender();
  });
}

/* ---------- SERVIZI ---------- */
function renderServizi(el) {
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>✨ Catalogo servizi aggiuntivi</h3><button class="btn sm primary" id="addSv">+ Servizio</button></div>
      <p class="small muted">Questi servizi si possono aggiungere a ogni prenotazione o evento e vengono calcolati nel preventivo (prezzo fisso o a persona).</p>
      <div class="table-wrap"><table><thead><tr><th>Servizio</th><th>Categoria</th><th class="right">Prezzo</th><th>Calcolo</th><th class="right">Usato in</th><th></th></tr></thead><tbody>
      ${CATEGORIE_SERVIZI.flatMap(cat => S.servizi.filter(s => (s.categoria || 'Altro') === cat)).map(s => `<tr>
        <td><b>${esc(s.nome)}</b></td><td><span class="badge">${esc(s.categoria)}</span></td>
        <td class="right">${eur(s.prezzo)}</td><td class="small">${s.tipoPrezzo === 'persona' ? 'a persona' : 'forfait'}</td>
        <td class="right small">${S.prenotazioni.filter(p => (p.servizi || []).includes(s.id)).length}</td>
        <td class="right"><button class="btn sm" data-edsv="${s.id}">Modifica</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nessun servizio</td></tr>'}
      </tbody></table></div>
    </div>`;
  $('#addSv').onclick = () => editServizio();
  $$('[data-edsv]', el).forEach(b => b.onclick = () => editServizio(byId(S.servizi, b.dataset.edsv)));
}
function editServizio(s) {
  const isNew = !s;
  s = s || { id: uid(), nome: '', categoria: 'Allestimento', prezzo: 0, tipoPrezzo: 'fisso' };
  openModal(isNew ? 'Nuovo servizio' : 'Modifica servizio', `
    <div class="form-grid">
      <label class="field span-2">Nome<input id="svNome" value="${esc(s.nome)}" placeholder="Es. Torta a piani, Fotografo…"></label>
      <label class="field">Categoria<select id="svCat">${CATEGORIE_SERVIZI.map(c => `<option ${s.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field">Prezzo €<input type="number" step="0.5" id="svPrezzo" value="${s.prezzo}"></label>
      <label class="field span-2">Calcolo<select id="svTipo"><option value="fisso" ${s.tipoPrezzo === 'fisso' ? 'selected' : ''}>Forfait (prezzo fisso)</option><option value="persona" ${s.tipoPrezzo === 'persona' ? 'selected' : ''}>A persona (× coperti)</option></select></label>
    </div>
    <div class="modal-foot">${isNew ? '' : '<button class="btn danger" id="svDel">Elimina</button>'}<span class="spacer"></span>
      <button class="btn" data-close>Annulla</button><button class="btn primary" id="svSave">Salva</button></div>`);
  $('#svSave').onclick = () => {
    s.nome = $('#svNome').value.trim() || 'Servizio'; s.categoria = $('#svCat').value; s.prezzo = num($('#svPrezzo').value); s.tipoPrezzo = $('#svTipo').value;
    if (isNew) S.servizi.push(s);
    closeModal(); rerender();
  };
  $('#svDel')?.addEventListener('click', () => {
    if (!confirm('Eliminare il servizio? Verrà tolto dalle prenotazioni.')) return;
    S.servizi = S.servizi.filter(x => x.id !== s.id);
    S.prenotazioni.forEach(p => (p.servizi = (p.servizi || []).filter(id => id !== s.id)));
    closeModal(); rerender();
  });
}

/* ---------- IMPOSTAZIONI ---------- */
function renderImpostazioni(el) {
  const st = S.settings;
  el.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <div class="card-head"><h3>🏷️ Dati del locale</h3></div>
        <div class="form-grid">
          <label class="field span-4">Nome ristorante<input data-set="nome" value="${esc(st.nome)}"></label>
          <label class="field span-2">Telefono<input data-set="telefono" value="${esc(st.telefono)}"></label>
          <label class="field span-2">Email<input data-set="email" value="${esc(st.email)}"></label>
          <label class="field span-4">Indirizzo<input data-set="indirizzo" value="${esc(st.indirizzo)}"></label>
          <label class="field span-2">Caparra suggerita (%)<input type="number" data-set="caparraPerc" value="${st.caparraPerc}"></label>
        </div>
        <p class="small muted">Questi dati compaiono sulla scheda evento / preventivo stampabile.</p>
      </div>
      <div class="card">
        <div class="card-head"><h3>💾 Dati e backup</h3></div>
        <p class="small muted">${CLOUD
          ? 'I dati sono nel database condiviso e si aggiornano in tempo reale per tutto lo staff. Il backup JSON resta utile come copia di sicurezza.'
          : 'Modalità locale: i dati sono salvati solo in questo browser. Per condividerli con lo staff configura il database (vedi README). Esporta regolarmente un backup.'}</p>
        <div class="toolbar">
          <button class="btn" id="exp">⬇ Esporta backup (JSON)</button>
          ${CLOUD && me?.ruolo !== 'admin' ? '' : '<label class="btn">⬆ Importa backup<input type="file" id="imp" accept="application/json" hidden></label>'}
          <button class="btn" id="csvAll">⬇ Prenotazioni CSV</button>
        </div>
        ${CLOUD && me?.ruolo !== 'admin' ? '' : `<div class="toolbar">
          <button class="btn danger" id="reset">Ricarica dati demo</button>
          <button class="btn danger" id="wipe">Svuota tutto</button>
        </div>`}
        <p class="small muted">${S.prenotazioni.length} prenotazioni · ${S.piatti.length} piatti · ${S.menu.length} menu · ${S.servizi.length} servizi · ${S.sale.length} sale</p>
      </div>
    </div>
    ${CLOUD ? '<div class="grid cols-2" style="margin-top:16px" id="cloudCards"></div>' : ''}`;
  if (CLOUD) renderCloudSettings($('#cloudCards', el));
  $$('[data-set]', el).forEach(i => i.onchange = () => {
    st[i.dataset.set] = i.type === 'number' ? num(i.value) : i.value; save(); $('#brandName').textContent = st.nome; toast('Salvato');
  });
  $('#exp').onclick = () => download(`agenda-ristorante-${todayISO()}.json`, JSON.stringify(S, null, 2), 'application/json');
  $('#csvAll').onclick = () => exportCSV(S.prenotazioni);
  if ($('#imp')) $('#imp').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.prenotazioni)) throw new Error();
        if (!confirm('Sostituire tutti i dati attuali con il backup?')) return;
        S = normalize(d); rerender(); toast('Backup importato');
      } catch { toast('File non valido'); }
    };
    r.readAsText(f);
  };
  if ($('#reset')) $('#reset').onclick = () => { if (confirm('Sostituire tutti i dati con i dati demo?')) { S = seed(); rerender(); } };
  if ($('#wipe')) $('#wipe').onclick = () => {
    if (!confirm('Cancellare TUTTI i dati (prenotazioni, menu, servizi)? Le sale e i turni restano.')) return;
    const keep = { settings: S.settings, sale: S.sale };
    S = { ...emptyState(), ...keep }; rerender();
  };
}

/* =========================================================
   Form prenotazione / evento
   ========================================================= */
function newBooking(over = {}) {
  const tipo = over.tipo || 'tavolo';
  const ora = over.ora || (tipo === 'evento' ? '20:00' : '20:00');
  return {
    id: uid(), tipo, tipoEvento: tipo === 'evento' ? 'Compleanno' : '', titolo: '',
    nome: '', telefono: '', email: '', fonte: 'Telefono',
    data: over.data || todayISO(), ora, turno: over.turno || turnoFromOra(ora),
    salaId: S.sale[0]?.id || '', tavolo: '', adulti: tipo === 'evento' ? 20 : 2, bambini: 0,
    stato: tipo === 'evento' ? 'richiesta' : 'confermata', esclusiva: false,
    menuId: '', piatti: [], prezzoPersona: 0, prezzoBambini: 0,
    formula: tipo === 'evento' ? 'Servito al tavolo' : '', musica: '', intrattenimento: [], costoIntrattenimento: 0,
    servizi: [], intolleranze: [], caparra: 0, sconto: 0, note: '', noteCucina: '',
    createdAt: new Date().toISOString(), ...over,
  };
}

function openBooking(p, over) {
  if (!p) return openForm(newBooking(over), true);
  openSheet(p);
}

function openForm(p, isNew) {
  const ev = p.tipo === 'evento';
  const st = S.settings;
  openModal(isNew ? (ev ? 'Nuovo evento' : 'Nuova prenotazione') : 'Modifica ' + (ev ? 'evento' : 'prenotazione'), `
  <form id="bf" autocomplete="off">
    <div class="pill-choice" style="margin-bottom:14px">
      <label><input type="radio" name="tipo" value="tavolo" ${!ev ? 'checked' : ''}>🍽️ Prenotazione tavolo</label>
      <label><input type="radio" name="tipo" value="evento" ${ev ? 'checked' : ''}>🎉 Evento / Festa</label>
    </div>

    <fieldset class="section"><legend>Cliente</legend>
      <div class="form-grid">
        <label class="field span-2">Nome e cognome / Azienda *<input name="nome" required value="${esc(p.nome)}"></label>
        <label class="field">Telefono<input name="telefono" type="tel" value="${esc(p.telefono)}"></label>
        <label class="field">Email<input name="email" type="email" value="${esc(p.email)}"></label>
        <label class="field">Canale<select name="fonte">${['Telefono', 'WhatsApp', 'Email', 'Di persona', 'Sito web', 'Social', 'Portale (TheFork…)', 'Altro'].map(f => `<option ${p.fonte === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label class="field">Stato<select name="stato">${Object.entries(STATI).map(([k, v]) => `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <div class="evt-only span-2 form-grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <label class="field">Tipo evento<select name="tipoEvento">${TIPI_EVENTO.map(t => `<option ${p.tipoEvento === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="field">Titolo evento<input name="titolo" value="${esc(p.titolo)}" placeholder="Es. 50 anni di Marco"></label>
        </div>
      </div>
    </fieldset>

    <fieldset class="section"><legend>Data, sala e coperti</legend>
      <div class="form-grid">
        <label class="field">Data *<input type="date" name="data" required value="${esc(p.data)}"></label>
        <label class="field">Ora *<input type="time" name="ora" required value="${esc(p.ora)}"></label>
        <label class="field">Turno<select name="turno">${st.turni.map(t => `<option value="${t.id}" ${p.turno === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        <label class="field">Sala<select name="salaId">${S.sale.map(s => `<option value="${s.id}" ${p.salaId === s.id ? 'selected' : ''}>${esc(s.nome)} (${s.capienza})</option>`).join('')}</select></label>
        <label class="field">Adulti<input type="number" min="0" name="adulti" value="${p.adulti}"></label>
        <label class="field">Bambini<input type="number" min="0" name="bambini" value="${p.bambini}"></label>
        <label class="field">Tavolo/i<input name="tavolo" value="${esc(p.tavolo)}" placeholder="Es. 5 oppure 5+6"></label>
        <label class="check" style="align-self:end"><input type="checkbox" name="esclusiva" ${p.esclusiva ? 'checked' : ''}>Sala in esclusiva</label>
      </div>
      <div id="availBox"></div>
    </fieldset>

    <details class="section" ${ev || p.menuId || p.piatti.length ? 'open' : ''}>
      <summary>📖 Menu e formula di servizio <span class="summary-note" id="menuNote"></span></summary>
      <div class="section-body">
        <div class="small muted" style="margin-bottom:6px">Formula</div>
        <div class="pill-choice" style="margin-bottom:12px">
          <label><input type="radio" name="formula" value="" ${!p.formula ? 'checked' : ''}>Non specificata</label>
          ${FORMULE.map(f => `<label><input type="radio" name="formula" value="${esc(f)}" ${p.formula === f ? 'checked' : ''}>${esc(f)}</label>`).join('')}
        </div>
        <div class="form-grid">
          <label class="field span-2">Menu di partenza<select name="menuId"><option value="">— Personalizzato / alla carta —</option>
            ${S.menu.map(m => `<option value="${m.id}" ${p.menuId === m.id ? 'selected' : ''}>${esc(m.nome)} · ${eur(m.prezzoPersona)}</option>`).join('')}</select></label>
          <label class="field">Prezzo adulto €<input type="number" step="0.5" min="0" name="prezzoPersona" value="${p.prezzoPersona}"></label>
          <label class="field">Prezzo bambino €<input type="number" step="0.5" min="0" name="prezzoBambini" value="${p.prezzoBambini}"></label>
        </div>
        <div class="small muted" style="margin:12px 0 4px">Composizione del menu (modifica liberamente: aggiungi o togli piatti)</div>
        <div id="dishBox"></div>
      </div>
    </details>

    <details class="section" ${ev || p.intolleranze.length ? 'open' : ''}>
      <summary>⚠️ Intolleranze, allergie e diete <span class="summary-note" id="intolNote"></span></summary>
      <div class="section-body">
        <div id="intolRows" class="row-list"></div>
        <button type="button" class="btn sm" id="addIntol">+ Aggiungi esigenza</button>
        <div id="conflBox"></div>
        <label class="field" style="margin-top:10px">Note per la cucina<textarea name="noteCucina" placeholder="Es. tavolo 5: piatto del celiaco servito per primo…">${esc(p.noteCucina)}</textarea></label>
      </div>
    </details>

    <details class="section" ${ev || p.intrattenimento.length || p.musica ? 'open' : ''}>
      <summary>🎵 Musica e intrattenimento <span class="summary-note" id="intrNote"></span></summary>
      <div class="section-body">
        <div class="small muted" style="margin-bottom:6px">Musica</div>
        <div class="pill-choice" style="margin-bottom:12px">
          <label><input type="radio" name="musica" value="" ${!p.musica ? 'checked' : ''}>Da definire</label>
          <label><input type="radio" name="musica" value="si" ${p.musica === 'si' ? 'checked' : ''}>🎶 Sì, con musica</label>
          <label><input type="radio" name="musica" value="no" ${p.musica === 'no' ? 'checked' : ''}>🔇 No musica</label>
        </div>
        <div id="intrBox" class="check-grid">${INTRATTENIMENTO.map(i => `<label class="check"><input type="checkbox" name="intrattenimento" value="${esc(i)}" ${p.intrattenimento.includes(i) ? 'checked' : ''}>${esc(i)}</label>`).join('')}</div>
        <label class="field" style="margin-top:10px;max-width:260px">Costo intrattenimento extra €<input type="number" step="1" min="0" name="costoIntrattenimento" value="${p.costoIntrattenimento}"></label>
      </div>
    </details>

    <details class="section" ${p.servizi.length || ev ? 'open' : ''}>
      <summary>✨ Servizi aggiuntivi <span class="summary-note" id="svNote"></span></summary>
      <div class="section-body">
        ${CATEGORIE_SERVIZI.map(cat => {
          const svs = S.servizi.filter(s => (s.categoria || 'Altro') === cat);
          return svs.length ? `<div class="course-title">${cat}</div><div class="check-grid">${svs.map(s => `<label class="check"><input type="checkbox" name="servizi" value="${s.id}" ${p.servizi.includes(s.id) ? 'checked' : ''}>${esc(s.nome)} <span class="small muted">${eur(s.prezzo)}${s.tipoPrezzo === 'persona' ? '/p' : ''}</span></label>`).join('')}</div>` : '';
        }).join('') || '<div class="muted small">Nessun servizio a catalogo: aggiungili dalla sezione Servizi.</div>'}
      </div>
    </details>

    <fieldset class="section"><legend>💶 Preventivo e note</legend>
      <div class="grid cols-2">
        <div>
          <div class="form-grid" style="grid-template-columns:1fr 1fr">
            <label class="field">Caparra versata €<input type="number" step="1" min="0" name="caparra" value="${p.caparra}"></label>
            <label class="field">Sconto €<input type="number" step="1" min="0" name="sconto" value="${p.sconto}"></label>
          </div>
          <label class="field" style="margin-top:10px">Note (allestimento, torta, orari, richieste…)<textarea name="note">${esc(p.note)}</textarea></label>
        </div>
        <div id="totBox"></div>
      </div>
    </fieldset>

    <div class="modal-foot">
      ${isNew ? '' : '<button type="button" class="btn danger" id="bDel">Elimina</button><button type="button" class="btn" id="bDup">Duplica</button>'}
      <span class="spacer"></span>
      <button type="button" class="btn" data-close>Annulla</button>
      <button type="submit" class="btn primary">${isNew ? 'Salva' : 'Salva modifiche'}</button>
    </div>
  </form>`);

  const f = $('#bf');
  const draft = JSON.parse(JSON.stringify(p));

  const readForm = () => {
    const fd = new FormData(f);
    draft.tipo = fd.get('tipo');
    ['nome', 'telefono', 'email', 'fonte', 'stato', 'tipoEvento', 'titolo', 'data', 'ora', 'turno', 'salaId', 'tavolo',
      'menuId', 'formula', 'musica', 'note', 'noteCucina'].forEach(k => (draft[k] = (fd.get(k) ?? '').toString()));
    ['adulti', 'bambini'].forEach(k => (draft[k] = Math.max(0, parseInt(fd.get(k)) || 0)));
    ['prezzoPersona', 'prezzoBambini', 'costoIntrattenimento', 'caparra', 'sconto'].forEach(k => (draft[k] = num(fd.get(k))));
    draft.esclusiva = !!fd.get('esclusiva');
    draft.intrattenimento = fd.getAll('intrattenimento');
    draft.servizi = fd.getAll('servizi');
    draft.piatti = $$('.pick-dish', f).filter(c => c.checked).map(c => c.value);
    draft.intolleranze = $$('.intol-row', f).map(r => ({
      tipo: $('[data-i=tipo]', r).value, n: Math.max(1, parseInt($('[data-i=n]', r).value) || 1), note: $('[data-i=note]', r).value,
    }));
    return draft;
  };

  const intolRow = (it = { tipo: 'Celiachia', n: 1, note: '' }) => `<div class="row intol-row">
      <select data-i="tipo">${INTOLLERANZE.map(t => `<option ${it.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <input type="number" min="1" data-i="n" value="${esc(it.n)}" title="Numero persone">
      <input data-i="note" class="intol-note" value="${esc(it.note)}" placeholder="Chi / dettagli (es. Marco, tavolo 3)">
      <button type="button" class="btn sm danger" data-rm>✕</button></div>`;
  $('#intolRows').innerHTML = p.intolleranze.map(intolRow).join('');

  const renderDishes = () => {
    const d = readForm();
    const flagged = new Set(menuConflicts(d).flatMap(c => c.piatti.map(x => x.id)));
    $('#dishBox').innerHTML = S.piatti.length ? dishPicker(d.piatti, flagged) : '<div class="muted small">Nessun piatto: aggiungili dalla sezione Menu.</div>';
  };

  const refresh = () => {
    const d = readForm();
    f.querySelectorAll('.evt-only').forEach(x => (x.style.display = d.tipo === 'evento' ? '' : 'none'));
    // disponibilità
    $('#availBox').innerHTML = checkAvailability(d).map(w => `<div class="alert ${w.lvl}">${esc(w.msg)}</div>`).join('');
    // conflitti menu
    const conf = menuConflicts(d);
    $('#conflBox').innerHTML = conf.length
      ? conf.map(c => `<div class="alert danger">⚠️ <b>${esc(c.intol.tipo)}</b> (${c.intol.n} pers.): verificare ${c.piatti.map(x => esc(x.nome)).join(', ')} — prevedere alternativa.</div>`).join('')
      : (d.intolleranze.length && d.piatti.length ? '<div class="alert ok">✓ Nessun conflitto evidente con i piatti selezionati.</div>' : '');
    $$('.pick-dish', f).forEach(c => c.closest('.dish').classList.toggle('flagged', conf.some(x => x.piatti.some(pp => pp.id === c.value))));
    // riepiloghi
    const menu = byId(S.menu, d.menuId);
    $('#menuNote').textContent = [d.formula, menu?.nome || (d.piatti.length ? `${d.piatti.length} piatti` : '')].filter(Boolean).join(' · ');
    const nInt = d.intolleranze.reduce((a, x) => a + x.n, 0);
    $('#intolNote').textContent = nInt ? `${nInt} persone` : '';
    $('#intrNote').textContent = d.musica === 'no' ? 'Niente musica' : d.intrattenimento.join(', ');
    $('#svNote').textContent = d.servizi.length ? `${d.servizi.length} selezionati` : '';
    $('#intrBox').style.opacity = d.musica === 'no' ? .5 : 1;
    // totali
    const pr = preventivo(d);
    const capSugg = Math.round(pr.totale * (S.settings.caparraPerc || 0) / 100);
    $('#totBox').innerHTML = `<div class="totals">
      <span>Menu adulti (${d.adulti} × ${eur(d.prezzoPersona)})</span><span class="right">${eur(pr.menuAdulti)}</span>
      ${d.bambini ? `<span>Menu bambini (${d.bambini} × ${eur(d.prezzoBambini)})</span><span class="right">${eur(pr.menuBambini)}</span>` : ''}
      ${pr.servizi.map(x => `<span class="small">${esc(x.sv.nome)}${x.sv.tipoPrezzo === 'persona' ? ` (${coperti(d)} × ${eur(x.sv.prezzo)})` : ''}</span><span class="right small">${eur(x.costo)}</span>`).join('')}
      ${pr.intr ? `<span>Intrattenimento</span><span class="right">${eur(pr.intr)}</span>` : ''}
      ${pr.sconto ? `<span>Sconto</span><span class="right">− ${eur(pr.sconto)}</span>` : ''}
      <span class="grand">Totale</span><span class="grand right">${eur(pr.totale)}</span>
      <span class="small muted">Caparra versata</span><span class="right small">${eur(pr.caparra)}</span>
      <span><b>Saldo da incassare</b></span><span class="right"><b>${eur(pr.saldo)}</b></span>
      ${pr.totale && S.settings.caparraPerc ? `<span class="small muted">Caparra suggerita (${S.settings.caparraPerc}%)</span><span class="right small muted">${eur(capSugg)}</span>` : ''}
      <span class="small muted">Media a persona</span><span class="right small muted">${coperti(d) ? eur(pr.totale / coperti(d)) : '—'}</span>
    </div>`;
  };

  renderDishes(); refresh();

  f.addEventListener('input', refresh);
  f.addEventListener('change', e => {
    const n = e.target.name;
    if (n === 'ora') { f.turno.value = turnoFromOra(e.target.value); }
    if (n === 'tipo') {
      const isEv = e.target.value === 'evento';
      if (isEv && !f.formula.value) f.querySelector('[name=formula][value="Servito al tavolo"]').checked = true;
      $$('details.section', f).forEach(d => (d.open = isEv || d.open));
    }
    if (n === 'menuId') {
      const m = byId(S.menu, e.target.value);
      if (m) {
        $$('.pick-dish', f).forEach(c => (c.checked = m.piatti.includes(c.value)));
        f.prezzoPersona.value = m.prezzoPersona; f.prezzoBambini.value = m.prezzoBambini;
      }
    }
    if (n === 'musica' && e.target.value === 'no') $$('[name=intrattenimento]', f).forEach(c => {
      if (['Musica di sottofondo', 'DJ set', 'Musica dal vivo', 'Piano bar', 'Karaoke', 'Ballo / Pista'].includes(c.value)) c.checked = false;
    });
    if (n === 'intrattenimento' && e.target.checked && ['Musica di sottofondo', 'DJ set', 'Musica dal vivo', 'Piano bar', 'Karaoke', 'Ballo / Pista'].includes(e.target.value)) {
      f.querySelector('[name=musica][value=si]').checked = true;
    }
    if (e.target.classList.contains('pick-dish') && f.menuId.value) {
      // composizione modificata rispetto al menu base: resta collegato ma segnalato
      const m = byId(S.menu, f.menuId.value);
      const cur = $$('.pick-dish', f).filter(c => c.checked).map(c => c.value).sort().join();
      if (m && cur !== [...m.piatti].sort().join()) $('#menuNote').textContent += ' (personalizzato)';
    }
    refresh();
  });
  $('#addIntol').onclick = () => { $('#intolRows').insertAdjacentHTML('beforeend', intolRow()); refresh(); };
  $('#intolRows').addEventListener('click', e => { if (e.target.matches('[data-rm]')) { e.target.closest('.intol-row').remove(); refresh(); } });

  f.onsubmit = e => {
    e.preventDefault();
    const d = readForm();
    if (!d.nome.trim()) return toast('Inserisci il nome del cliente');
    if (!d.data || !d.ora) return toast('Data e ora sono obbligatorie');
    const hard = checkAvailability(d).filter(w => w.lvl === 'danger');
    if (hard.length && isActive(d) && !confirm(hard.map(w => '• ' + w.msg).join('\n') + '\n\nSalvare comunque?')) return;
    const i = S.prenotazioni.findIndex(x => x.id === d.id);
    d.updatedAt = new Date().toISOString();
    if (i >= 0) S.prenotazioni[i] = d; else S.prenotazioni.push(d);
    closeModal(); rerender(); toast(isNew ? 'Prenotazione salvata' : 'Modifiche salvate');
  };
  $('#bDel')?.addEventListener('click', () => {
    if (!confirm('Eliminare definitivamente? (In alternativa imposta lo stato "Annullata")')) return;
    S.prenotazioni = S.prenotazioni.filter(x => x.id !== p.id); closeModal(); rerender(); toast('Eliminata');
  });
  $('#bDup')?.addEventListener('click', () => {
    const d = { ...readForm(), id: uid(), stato: 'richiesta', caparra: 0, createdAt: new Date().toISOString() };
    openForm(d, true);
  });
}

/* ---------- Scheda (vista dettaglio + stampa) ---------- */
function openSheet(p) {
  const pr = preventivo(p), st = S.settings, menu = byId(S.menu, p.menuId);
  const dishes = (p.piatti || []).map(id => byId(S.piatti, id)).filter(Boolean);
  const conf = menuConflicts(p);
  const flagged = new Set(conf.flatMap(c => c.piatti.map(x => x.id)));
  openModal(p.tipo === 'evento' ? `🎉 ${p.titolo || p.tipoEvento || 'Evento'}` : `Prenotazione · ${p.nome}`, `
    <div class="sheet">
      <div class="card-head">
        <div><b>${esc(st.nome)}</b><div class="small muted">${esc([st.indirizzo, st.telefono, st.email].filter(Boolean).join(' · '))}</div></div>
        <div class="tags">${statoBadge(p.stato)}${p.tipo === 'evento' ? `<span class="badge primary">${esc(p.tipoEvento)}</span>` : ''}</div>
      </div>
      <h3>Dettagli</h3>
      <dl class="kv">
        <dt>Cliente</dt><dd><b>${esc(p.nome)}</b></dd>
        ${p.telefono ? `<dt>Telefono</dt><dd><a href="tel:${esc(p.telefono.replace(/\s/g, ''))}">${esc(p.telefono)}</a></dd>` : ''}
        ${p.email ? `<dt>Email</dt><dd><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></dd>` : ''}
        <dt>Data e ora</dt><dd style="text-transform:capitalize">${esc(fmtLong(p.data))} · ore ${esc(p.ora)} (${esc(turnoLabel(p.turno))})</dd>
        <dt>Sala</dt><dd>${esc(salaNome(p.salaId))}${p.tavolo ? ' · Tavolo ' + esc(p.tavolo) : ''}${p.esclusiva ? ' · <b>in esclusiva</b>' : ''}</dd>
        <dt>Ospiti</dt><dd><b>${coperti(p)}</b> — ${p.adulti} adulti${p.bambini ? `, ${p.bambini} bambini` : ''}</dd>
        <dt>Canale</dt><dd>${esc(p.fonte || '—')}</dd>
        ${p.formula ? `<dt>Formula</dt><dd>${esc(p.formula)}</dd>` : ''}
        <dt>Musica</dt><dd>${p.musica === 'no' ? '🔇 No musica' : p.musica === 'si' ? '🎶 Sì' : 'Da definire'}${p.intrattenimento?.length ? ' — ' + esc(p.intrattenimento.join(', ')) : ''}</dd>
      </dl>

      ${dishes.length ? `<h3>Menu ${menu ? '· ' + esc(menu.nome) : '(personalizzato)'}</h3>
        ${PORTATE.map(([k, lab]) => {
          const ds = dishes.filter(d => d.portata === k);
          return ds.length ? `<div class="course-title">${lab}</div>${ds.map(d => `<div class="dish ${flagged.has(d.id) ? 'flagged' : ''}"><span class="name">${esc(d.nome)}</span><span class="small muted">${esc(d.allergeni.join(', '))}</span></div>`).join('')}` : '';
        }).join('')}` : ''}

      <h3>Intolleranze e allergie</h3>
      ${p.intolleranze?.length ? `<table><thead><tr><th>Esigenza</th><th>N.</th><th>Note</th></tr></thead><tbody>
        ${p.intolleranze.map(i => `<tr><td><b>${esc(i.tipo)}</b></td><td>${esc(i.n)}</td><td>${esc(i.note)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Nessuna segnalata</p>'}
      ${conf.map(c => `<div class="alert danger">⚠️ ${esc(c.intol.tipo)}: verificare ${c.piatti.map(x => esc(x.nome)).join(', ')}</div>`).join('')}
      ${p.noteCucina ? `<div class="alert info"><b>Note cucina:</b> ${esc(p.noteCucina)}</div>` : ''}

      ${pr.servizi.length ? `<h3>Servizi aggiuntivi</h3><ul style="margin:0;padding-left:18px">${pr.servizi.map(x => `<li>${esc(x.sv.nome)} — ${eur(x.costo)}</li>`).join('')}</ul>` : ''}

      ${p.note ? `<h3>Note</h3><p style="white-space:pre-wrap;margin:0">${esc(p.note)}</p>` : ''}

      ${pr.totale ? `<h3>Preventivo</h3><div class="totals" style="max-width:420px">
        <span>Menu adulti (${p.adulti} × ${eur(p.prezzoPersona)})</span><span class="right">${eur(pr.menuAdulti)}</span>
        ${p.bambini ? `<span>Menu bambini (${p.bambini} × ${eur(p.prezzoBambini)})</span><span class="right">${eur(pr.menuBambini)}</span>` : ''}
        ${pr.totServizi ? `<span>Servizi aggiuntivi</span><span class="right">${eur(pr.totServizi)}</span>` : ''}
        ${pr.intr ? `<span>Intrattenimento</span><span class="right">${eur(pr.intr)}</span>` : ''}
        ${pr.sconto ? `<span>Sconto</span><span class="right">− ${eur(pr.sconto)}</span>` : ''}
        <span class="grand">Totale${st.ivaInclusa ? ' (IVA incl.)' : ''}</span><span class="grand right">${eur(pr.totale)}</span>
        <span>Caparra versata</span><span class="right">${eur(pr.caparra)}</span>
        <span><b>Saldo</b></span><span class="right"><b>${eur(pr.saldo)}</b></span>
      </div>` : ''}
    </div>
    <div class="modal-foot" style="margin-top:16px">
      <select id="qStato" style="width:auto">${Object.entries(STATI).map(([k, v]) => `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      ${p.telefono ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(p.telefono))}?text=${encodeURIComponent(confirmText(p))}">WhatsApp</a>` : ''}
      <button class="btn" id="shCopy">Copia conferma</button>
      <span class="spacer"></span>
      <button class="btn" id="shPrint">🖨 Stampa</button>
      <button class="btn primary" id="shEdit">Modifica</button>
    </div>`);
  $('#shEdit').onclick = () => openForm(p, false);
  $('#shPrint').onclick = () => window.print();
  $('#qStato').onchange = e => { p.stato = e.target.value; save(); route(); toast('Stato aggiornato'); };
  $('#shCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(confirmText(p)); toast('Testo copiato'); }
    catch { prompt('Copia il testo:', confirmText(p)); }
  };
}
function waNumber(t) { let n = t.replace(/\D/g, ''); if (n.length <= 10 && !n.startsWith('39')) n = '39' + n; return n; }
function confirmText(p) {
  const st = S.settings;
  return `Gentile ${p.nome}, confermiamo la ${p.tipo === 'evento' ? 'prenotazione dell\'evento "' + (p.titolo || p.tipoEvento) + '"' : 'prenotazione'} presso ${st.nome} ` +
    `per ${fmtLong(p.data)} alle ore ${p.ora}, ${coperti(p)} persone.` +
    (p.intolleranze?.length ? ` Abbiamo preso nota di: ${p.intolleranze.map(i => `${i.n}× ${i.tipo.replace('Allergia: ', 'allergia ')}`).join(', ')}.` : '') +
    (p.caparra ? ` Caparra ricevuta: ${eur(p.caparra)}.` : '') + ' A presto!';
}

/* =========================================================
   Modal, export
   ========================================================= */
function openModal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $$('[data-close]', $('#modalBody')).forEach(b => (b.onclick = closeModal));
  $('#modal').scrollTop = 0;
}
function closeModal() {
  $('#modal').hidden = true; $('#modalBody').innerHTML = ''; document.body.style.overflow = '';
  if (typeof onModalClosed === 'function') onModalClosed();
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCSV(list) {
  const cols = ['Data', 'Ora', 'Turno', 'Tipo', 'Tipo evento', 'Titolo', 'Cliente', 'Telefono', 'Email', 'Adulti', 'Bambini', 'Sala', 'Tavolo',
    'Stato', 'Formula', 'Menu', 'Musica', 'Intrattenimento', 'Servizi', 'Intolleranze', 'Totale', 'Caparra', 'Saldo', 'Note'];
  const rows = list.map(p => {
    const pr = preventivo(p);
    return [p.data, p.ora, turnoLabel(p.turno), p.tipo, p.tipoEvento, p.titolo, p.nome, p.telefono, p.email, p.adulti, p.bambini,
      salaNome(p.salaId), p.tavolo, STATI[p.stato]?.label, p.formula, byId(S.menu, p.menuId)?.nome || '', p.musica,
      (p.intrattenimento || []).join(' | '), (p.servizi || []).map(id => byId(S.servizi, id)?.nome).filter(Boolean).join(' | '),
      (p.intolleranze || []).map(i => `${i.n}x ${i.tipo}${i.note ? ' (' + i.note + ')' : ''}`).join(' | '),
      pr.totale.toFixed(2), pr.caparra.toFixed(2), pr.saldo.toFixed(2), p.note];
  });
  const csv = [cols, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  download(`prenotazioni-${todayISO()}.csv`, '﻿' + csv, 'text/csv');
}

/* =========================================================
   Avvio
   ========================================================= */
$('#modalClose').onclick = closeModal;
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
$('#btnNew').onclick = $('#btnNewSide').onclick = () => openBooking(null, {});
$('#btnNewEvent').onclick = () => openBooking(null, { tipo: 'evento' });
window.addEventListener('hashchange', route);
// avvio: boot() è definita in cloud.js (gestisce sia la modalità locale sia quella condivisa)
