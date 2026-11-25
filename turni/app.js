/* Turni Ufficio — generazione automatica dei turni settimanali.
   Dati:
   - settings: orari dei turni, qualifiche (con livello di accesso e turnazione), regole di popolamento
   - persone: anagrafica dei colleghi
   - prep['prep-AAAA-MM-GG']: stati, richieste ed esigenze aziendali della settimana (solo admin)
   - settimane['w-AAAA-MM-GG']: orario generato/modificato, in bozza o pubblicato */
'use strict';

const CFG = window.TURNI_CONFIG || {};
const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const LS_KEY = 'turni-ufficio-v1';
const LS_PROFILO = 'turni-ufficio-profilo';

/* ---------- utilità ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------- date (settimana = lunedì in formato AAAA-MM-GG) ---------- */
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const GIORNI_L = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function dataBreve(wk, d) { const x = parseYmd(addDays(wk, d)); return `${x.getDate()} ${MESI[x.getMonth()]}`; }
function labelSettimana(wk) {
  const a = parseYmd(wk), b = parseYmd(addDays(wk, 6));
  return `${a.getDate()} ${MESI[a.getMonth()]} – ${b.getDate()} ${MESI[b.getMonth()]} ${b.getFullYear()}`;
}
const settimanaProssima = () => ymd(mondayOf(parseYmd(addDays(ymd(new Date()), 7))));

/* ---------- costanti di dominio ---------- */
const LIVELLI = { user: 'Utente', admin: 'Admin', super: 'Super user' };
const RANK = { user: 0, admin: 1, super: 2 };
const TURNAZIONI = { alternata: 'Alternata mattina / pomeriggio', M: 'Solo mattina', P: 'Solo pomeriggio', esclusa: 'Esclusa dalla generazione' };

// Stati / richieste / esigenze impostabili per ogni collega e giorno in "Preparazione"
const STATI = [
  { code: '', label: 'Disponibile', short: '', cat: 'disp' },
  { code: 'RM', label: 'Richiesta personale: mattina', short: 'Rich. M', cat: 'richiesta', turno: 'M' },
  { code: 'RP', label: 'Richiesta personale: pomeriggio', short: 'Rich. P', cat: 'richiesta', turno: 'P' },
  { code: 'AM', label: 'Esigenza aziendale: mattina', short: 'Az. M', cat: 'aziendale', turno: 'M' },
  { code: 'AP', label: 'Esigenza aziendale: pomeriggio', short: 'Az. P', cat: 'aziendale', turno: 'P' },
  { code: 'CO', label: 'Corso / formazione (assente)', short: 'Corso', cat: 'assenza' },
  { code: 'FE', label: 'Ferie', short: 'Ferie', cat: 'assenza' },
  { code: 'PE', label: 'Permesso', short: 'Permesso', cat: 'assenza' },
  { code: 'MA', label: 'Malattia', short: 'Malattia', cat: 'assenza' },
  { code: 'RI', label: 'Riposo', short: 'Riposo', cat: 'assenza' },
  { code: 'AL', label: 'Altra assenza', short: 'Assente', cat: 'assenza' },
];
const STATO = Object.fromEntries(STATI.map(s => [s.code, s]));

function defaultSettings() {
  const feriale = (a, b) => ({ 0: [a, b], 1: [a, b], 2: [a, b], 3: [a, b], 4: [a, b] });
  return {
    ufficio: 'Ufficio',
    turni: [
      { id: 'M', nome: 'Mattina', orari: { ...feriale('08:00', '14:10'), 5: ['08:00', '13:10'] } },
      { id: 'P', nome: 'Pomeriggio', orari: feriale('13:30', '19:40') },
    ],
    qualifiche: [
      { code: 'DIR', nome: 'Direttore', livello: 'admin', turnazione: 'alternata' },
      { code: 'COLL', nome: 'Collaboratore', livello: 'admin', turnazione: 'alternata' },
      { code: 'RGOZ', nome: 'RGOZ', livello: 'admin', turnazione: 'esclusa' },
      { code: 'OSP', nome: 'Operatore sportellista', livello: 'user', turnazione: 'alternata' },
      { code: 'SCF', nome: 'SCF', livello: 'user', turnazione: 'alternata' },
      { code: 'SCFI', nome: 'SCFI', livello: 'user', turnazione: 'alternata' },
      { code: 'OFE', nome: 'OFE', livello: 'user', turnazione: 'alternata' },
      { code: 'RCE', nome: 'RCE', livello: 'user', turnazione: 'alternata' },
    ],
    regole: {
      aziendali: { on: true },
      copertura: { on: true, min: { OSP: { M: 3, P: 3, 'M@5': 3 } } },
      richieste: { on: true, vincolanti: false },
      alternanza: { on: true, modo: 'settimanale' },
      sabato: { modo: 'tutti', persone: 6 },
      bilanciamento: { on: true, maxDiff: 1 },
    },
  };
}
function migraSettings(s) {
  const d = defaultSettings();
  if (!s) return d;
  const out = { ...d, ...s, regole: { ...d.regole } };
  for (const k of Object.keys(d.regole)) out.regole[k] = { ...d.regole[k], ...(s.regole?.[k] || {}) };
  return out;
}

function demoState() {
  const nomi = [
    ['Bianchi Laura', 'DIR'], ['Russo Marco', 'COLL'], ['Giordano Roberto', 'RGOZ'],
    ['Esposito Anna', 'OSP'], ['Romano Luca', 'OSP'], ['Colombo Sara', 'OSP'], ['Ricci Paolo', 'OSP'],
    ['Marino Giulia', 'OSP'], ['Greco Davide', 'OSP'], ['Bruno Elena', 'OSP'], ['Gallo Matteo', 'OSP'],
    ['Conti Chiara', 'SCF'], ['De Luca Andrea', 'SCF'], ['Mancini Federica', 'SCFI'], ['Costa Simone', 'OFE'],
  ];
  const persone = nomi.map(([nome, qualifica]) => ({ id: uid(), nome, qualifica, email: '', attivo: true }));
  const wk = settimanaProssima();
  const by = n => persone.find(p => p.nome.startsWith(n)).id;
  const stati = {
    [by('Ricci')]: { 0: 'FE', 1: 'FE', 2: 'FE', 3: 'FE', 4: 'FE', 5: 'FE' },
    [by('Marino')]: { 1: 'RP' },
    [by('Conti')]: { 2: 'CO' },
    [by('Gallo')]: { 3: 'PE' },
  };
  return {
    settings: defaultSettings(),
    persone,
    prep: { ['prep-' + wk]: { id: 'prep-' + wk, settimana: wk, stati, note: { [by('Marino')]: 'Visita medica martedì mattina' } } },
    settimane: {},
  };
}
const statoVuoto = () => ({ settings: defaultSettings(), persone: [], prep: {}, settimane: {} });

/* ---------- stato applicazione ---------- */
let state = null;
let me = { email: '', livello: 'super', personaId: null };
let curWeek = settimanaProssima();
let orarioMode = 'persone';

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const s = JSON.parse(raw); s.settings = migraSettings(s.settings); return s; }
  } catch (e) { console.warn(e); }
  return demoState();
}
function save() {
  if (CLOUD) return window.Cloud && Cloud.sync();
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { toast('Salvataggio non riuscito: ' + e.message); }
}
const can = lvl => RANK[me.livello] >= RANK[lvl];

/* ---------- helpers di dominio ---------- */
const S = () => state.settings;
const qual = code => S().qualifiche.find(q => q.code === code) || { code, nome: code, livello: 'user', turnazione: 'alternata' };
const turno = id => S().turni.find(t => t.id === id);
const altro = t => (t === 'M' ? 'P' : 'M');
const giorniAttivi = () => [0, 1, 2, 3, 4, 5, 6].filter(d => S().turni.some(t => t.orari[d]));
const turniDelGiorno = d => S().turni.filter(t => t.orari[d]).map(t => t.id);
const minKey = (d, t) => (d < 5 ? t : `${t}@${d}`);
function need(q, d, t) {
  const R = S().regole;
  return R.copertura.on ? +(R.copertura.min[q]?.[minKey(d, t)] || 0) : 0;
}
function colonneCopertura() {
  const cols = [];
  for (const t of S().turni) {
    if ([0, 1, 2, 3, 4].some(d => t.orari[d])) cols.push({ key: t.id, label: `${t.nome} (Lun–Ven)` });
    for (const d of [5, 6]) if (t.orari[d]) cols.push({ key: `${t.id}@${d}`, label: `${t.nome} ${GIORNI[d]}` });
  }
  return cols;
}
function orarioTxt(t, d) { const o = turno(t)?.orari[d]; return o ? `${o[0]}–${o[1]}` : ''; }
function personeOrdinate(list = state.persone) {
  const idx = c => { const i = S().qualifiche.findIndex(q => q.code === c); return i < 0 ? 99 : i; };
  return [...list].sort((a, b) => idx(a.qualifica) - idx(b.qualifica) || a.nome.localeCompare(b.nome, 'it'));
}
const weekDoc = wk => state.settimane['w-' + wk];
function prepDoc(wk, create) {
  const id = 'prep-' + wk;
  if (!state.prep[id] && create) state.prep[id] = { id, settimana: wk, stati: {}, note: {} };
  return state.prep[id];
}
function contaMP(row) {
  const c = { M: 0, P: 0 };
  for (let d = 0; d < 5; d++) { const x = row?.[d]; if (x && !x.a && (x.t === 'M' || x.t === 'P')) c[x.t]++; }
  return c;
}

/* =====================================================================
   ALGORITMO DI GENERAZIONE
   Priorità: 1 assenze → 2 esigenze aziendali → 3 copertura minima →
             4 richieste personali → 5 alternanza → 6 sabato → 7 bilanciamento
   ===================================================================== */
function genera(wk, mantieniManuali) {
  const R = S().regole;
  const prep = prepDoc(wk) || { stati: {} };
  const prev = weekDoc(addDays(wk, -7));
  const old = weekDoc(wk);
  const giorni = giorniAttivi();
  const persone = personeOrdinate().filter(p => p.attivo !== false);
  const note = [];
  const ass = {};
  const moves = {};

  // 1) gruppo base della settimana (mattina o pomeriggio)
  const base = {};
  const nuovi = [];
  for (const p of persone) {
    const tz = qual(p.qualifica).turnazione || 'alternata';
    if (tz === 'esclusa') continue;
    if (tz === 'M' || tz === 'P') { base[p.id] = tz; continue; }
    const c = contaMP(prev?.ass?.[p.id]);
    if (c.M || c.P) {
      const prevalente = c.M >= c.P ? 'M' : 'P';
      base[p.id] = R.alternanza.on ? altro(prevalente) : prevalente;
    } else nuovi.push(p);
  }
  // senza storico: nel gruppo meno numeroso della stessa qualifica; a parità, in quello meno numeroso in assoluto
  const totale = t => Object.values(base).filter(x => x === t).length;
  for (const p of nuovi) {
    const stessi = persone.filter(x => x.qualifica === p.qualifica && base[x.id]);
    const nM = stessi.filter(x => base[x.id] === 'M').length, nP = stessi.length - nM;
    base[p.id] = nM !== nP ? (nM < nP ? 'M' : 'P') : (totale('M') <= totale('P') ? 'M' : 'P');
  }

  // storico giorni a turno unico (sabato) delle ultime 8 settimane, per la rotazione
  const unici = {};
  for (let k = 1; k <= 8; k++) {
    const w = weekDoc(addDays(wk, -7 * k)); if (!w) continue;
    for (const pid in w.ass) for (const d of [5, 6]) { const c = w.ass[pid][d]; if (c && c.t && !c.a) unici[pid] = (unici[pid] || 0) + 1; }
  }

  giorni.forEach((d, gi) => {
    const tg = turniDelGiorno(d);
    const L = {}; // vincolo del giorno: 'hard' | 'soft' | 'moved'
    for (const p of persone) {
      const row = (ass[p.id] ||= {});
      const oldCell = old?.ass?.[p.id]?.[d];
      if (mantieniManuali && oldCell?.man) { row[d] = { ...oldCell }; L[p.id] = 'hard'; continue; }
      if ((qual(p.qualifica).turnazione || 'alternata') === 'esclusa') { row[d] = { t: '', r: p.qualifica, x: 1 }; continue; }
      const st = STATO[prep.stati?.[p.id]?.[d] || ''] || STATO[''];
      const c = { t: '', r: p.qualifica };
      if (st.cat === 'assenza') { c.a = 1; row[d] = c; continue; }
      let t, lk = '';
      if (st.cat === 'aziendale' && R.aziendali.on) { t = st.turno; lk = 'hard'; }
      else if (st.cat === 'richiesta' && R.richieste.on) { t = st.turno; lk = R.richieste.vincolanti ? 'hard' : 'soft'; }
      else {
        t = base[p.id];
        if (R.alternanza.on && R.alternanza.modo === 'giornaliera' && gi % 2) t = altro(t);
      }
      if (!tg.includes(t)) {
        if (lk && tg.length > 1) note.push(`${GIORNI[d]}: turno richiesto per ${p.nome} non previsto`);
        t = tg[0];
        if (lk === 'soft') lk = '';
      }
      c.t = t; row[d] = c;
      if (lk) L[p.id] = lk;
    }

    const lavora = t => persone.filter(p => ass[p.id][d].t === t && !ass[p.id][d].a);
    const cnt = (q, t) => lavora(t).filter(p => ass[p.id][d].r === q).length;
    const sposta = (p, t, motivo) => {
      const c = ass[p.id][d];
      if (L[p.id] === 'soft') { note.push(`${GIORNI_L[d]}: richiesta di ${p.nome} non soddisfatta (${motivo})`); c.w = 1; }
      c.t = t; L[p.id] = 'moved'; moves[p.id] = (moves[p.id] || 0) + 1;
    };

    if (tg.length === 1) {
      // giorno a turno unico (es. sabato)
      const t = tg[0];
      if (R.sabato.modo === 'rotazione') {
        const disp = lavora(t);
        const scelti = new Set(disp.filter(p => L[p.id] === 'hard').map(p => p.id));
        const ordina = arr => arr.sort((a, b) => (unici[a.id] || 0) - (unici[b.id] || 0) || a.nome.localeCompare(b.nome, 'it'));
        for (const q of S().qualifiche) {
          const n = need(q.code, d, t);
          let have = disp.filter(p => scelti.has(p.id) && ass[p.id][d].r === q.code).length;
          for (const p of ordina(disp.filter(p => !scelti.has(p.id) && ass[p.id][d].r === q.code))) { if (have >= n) break; scelti.add(p.id); have++; }
        }
        for (const p of ordina(disp.filter(p => !scelti.has(p.id)))) { if (scelti.size >= (+R.sabato.persone || 0)) break; scelti.add(p.id); }
        for (const p of disp) {
          if (scelti.has(p.id)) unici[p.id] = (unici[p.id] || 0) + 1;
          else ass[p.id][d] = { t: '', r: ass[p.id][d].r, rp: 1 };
        }
      }
      return;
    }

    // giorno con due turni: copertura minima
    if (R.copertura.on) {
      for (const T of tg) {
        const O = tg.find(x => x !== T);
        for (const q of S().qualifiche) {
          const n = need(q.code, d, T); if (!n) continue;
          while (cnt(q.code, T) < n) {
            const cand = lavora(O).filter(p => ass[p.id][d].r === q.code && L[p.id] !== 'hard' && L[p.id] !== 'moved'
              && cnt(q.code, O) - 1 >= need(q.code, d, O));
            if (!cand.length) break;
            cand.sort((a, b) => (L[a.id] === 'soft') - (L[b.id] === 'soft') || (moves[a.id] || 0) - (moves[b.id] || 0) || a.nome.localeCompare(b.nome, 'it'));
            sposta(cand[0], T, `copertura minima ${q.code}`);
          }
        }
      }
    }
    // bilanciamento numerico tra i due turni
    if (R.bilanciamento.on) {
      const [T1, T2] = tg;
      for (let guard = 0; guard < 60; guard++) {
        const a = lavora(T1).length, b = lavora(T2).length;
        const diff = Math.abs(a - b);
        if (diff <= (+R.bilanciamento.maxDiff || 0) || diff < 2) break; // con meno di 2 uno spostamento non migliora
        const [from, to] = a > b ? [T1, T2] : [T2, T1];
        const surplus = p => { const r = ass[p.id][d].r; return cnt(r, from) - need(r, d, from); };
        const cand = lavora(from).filter(p => !L[p.id] && surplus(p) >= 1);
        if (!cand.length) break;
        cand.sort((x, y) => surplus(y) - surplus(x) || (moves[x.id] || 0) - (moves[y.id] || 0) || x.nome.localeCompare(y.nome, 'it'));
        sposta(cand[0], to, 'bilanciamento');
      }
    }
  });

  return {
    id: 'w-' + wk, settimana: wk, stato: 'bozza',
    generataIl: new Date().toISOString(), generataDa: me.email || '',
    persone: persone.map(p => ({ id: p.id, nome: p.nome, q: p.qualifica })),
    ass, note,
  };
}

/* copertura effettiva di un turno in un giorno */
function copertura(doc, d, t) {
  const res = { tot: 0, per: {} };
  for (const pid in doc.ass) {
    const c = doc.ass[pid][d];
    if (c && c.t === t && !c.a) { res.tot++; (res.per[c.r] ||= { n: 0, need: 0 }).n++; }
  }
  for (const q of S().qualifiche) { const n = need(q.code, d, t); if (n) (res.per[q.code] ||= { n: 0, need: 0 }).need = n; }
  return res;
}
function avvisiCopertura(doc) {
  const out = [];
  for (const d of giorniAttivi()) for (const t of turniDelGiorno(d)) {
    const c = copertura(doc, d, t);
    for (const [q, v] of Object.entries(c.per)) if (v.need && v.n < v.need)
      out.push(`${GIORNI_L[d]} ${dataBreve(doc.settimana, d)}, ${turno(t).nome.toLowerCase()}: ${q} ${v.n} su ${v.need} richiesti`);
  }
  return out;
}

/* ---------- navigazione ---------- */
const VIEWS = {
  orario: { titolo: 'Orario settimanale', icon: '🗓️', min: 'user', render: renderOrario },
  preparazione: { titolo: 'Preparazione settimana', icon: '📝', min: 'admin', render: renderPrep },
  personale: { titolo: 'Personale', icon: '👥', min: 'admin', render: renderPersonale },
  regole: { titolo: 'Regole di popolamento', icon: '⚙️', min: 'admin', render: renderRegole },
  utenti: { titolo: 'Utenti e permessi', icon: '🔐', min: 'admin', render: renderUtenti },
  impostazioni: { titolo: 'Impostazioni', icon: '🛠️', min: 'super', render: renderImpostazioni },
};
function currentView() {
  const v = location.hash.slice(1);
  return VIEWS[v] && can(VIEWS[v].min) ? v : 'orario';
}
function render() {
  if (!state) return;
  const v = currentView();
  $('#brandName').textContent = S().ufficio || 'Turni Ufficio';
  document.title = 'Turni — ' + (S().ufficio || 'Ufficio');
  $('#nav').innerHTML = Object.entries(VIEWS).filter(([, x]) => can(x.min))
    .map(([k, x]) => `<a href="#${k}" class="${k === v ? 'active' : ''}"><span>${x.icon}</span><b>${x.titolo.split(' ')[0]}</b></a>`).join('');
  $('#viewTitle').textContent = VIEWS[v].titolo;
  renderMe();
  VIEWS[v].render($('#view'));
}
function renderMe() {
  const p = state.persone.find(x => x.id === me.personaId);
  $('#meBox').innerHTML = CLOUD
    ? `<div>${esc(me.email)}</div><div>Livello: <span class="lvl">${LIVELLI[me.livello]}</span></div>${p ? `<div>${esc(p.nome)}</div>` : ''}
       <button class="btn sm" data-act="logout">Esci</button>`
    : `<div>Modalità locale — profilo simulato:</div>
       <select data-change="profilo">${Object.entries(LIVELLI).map(([k, l]) => `<option value="${k}" ${k === me.livello ? 'selected' : ''}>${l}</option>`).join('')}</select>
       <div class="small" style="opacity:.7">Con il database condiviso il livello dipende dall'account.</div>`;
}
window.addEventListener('hashchange', render);

function weekNav() {
  return `<div class="weeknav">
    <button class="btn" data-act="week" data-n="-7" title="Settimana precedente">◀</button>
    <span class="label">${labelSettimana(curWeek)}</span>
    <button class="btn" data-act="week" data-n="7" title="Settimana successiva">▶</button>
    <button class="btn sm" data-act="week-next">Prossima settimana</button>
  </div>`;
}

/* ---------- vista ORARIO ---------- */
function renderOrario(el) {
  const doc = weekDoc(curWeek);
  const edit = can('admin');
  const pubblicato = doc?.stato === 'pubblicata';
  const stato = !doc ? '<span class="badge">Non generato</span>'
    : pubblicato ? '<span class="badge ok">Pubblicato</span>' : '<span class="badge warn">Bozza</span>';

  let toolbar = `<div class="row noprint">${weekNav()}<span class="spacer"></span>${stato}</div>`;
  if (edit) {
    toolbar += `<div class="row noprint">
      <button class="btn primary" data-act="genera">⚡ ${doc ? 'Rigenera bozza' : 'Genera bozza'}</button>
      ${doc ? (pubblicato ? '<button class="btn" data-act="ritira">Ritira pubblicazione</button>' : '<button class="btn ok" data-act="pubblica">✓ Pubblica</button>') : ''}
      <a class="btn" href="#preparazione">📝 Stati e richieste</a>
      <span class="spacer"></span>
      ${doc ? `<div class="seg">${['persone', 'turni'].map(m => `<button data-act="mode" data-m="${m}" class="${orarioMode === m ? 'on' : ''}">Per ${m === 'persone' ? 'persona' : 'turno'}</button>`).join('')}</div>
      <button class="btn" data-act="csv">CSV</button><button class="btn" data-act="print">Stampa</button>` : ''}
    </div>`;
  } else if (doc && pubblicato) {
    toolbar += `<div class="row noprint"><span class="spacer"></span><div class="seg">${['persone', 'turni'].map(m => `<button data-act="mode" data-m="${m}" class="${orarioMode === m ? 'on' : ''}">Per ${m === 'persone' ? 'persona' : 'turno'}</button>`).join('')}</div><button class="btn" data-act="print">Stampa</button></div>`;
  }

  if (!doc || (!edit && !pubblicato)) {
    el.innerHTML = toolbar + `<div class="card empty">${edit
      ? `<b>Nessun orario per questa settimana</b>Imposta ferie, permessi, richieste ed esigenze aziendali in <a href="#preparazione">Preparazione</a>, poi premi <b>Genera bozza</b>.`
      : `<b>Orario non ancora pubblicato</b>L'orario di questa settimana sarà visibile appena verrà pubblicato.`}</div>`;
    return;
  }

  const avvisi = avvisiCopertura(doc);
  const alerts = edit && (avvisi.length || doc.note?.length) ? `<div class="card noprint"><h3>Da verificare</h3><ul class="alerts">
    ${avvisi.map(a => `<li class="bad">⚠ Copertura insufficiente — ${esc(a)}</li>`).join('')}
    ${(doc.note || []).map(a => `<li>ℹ ${esc(a)}</li>`).join('')}</ul></div>` : '';

  const head = `<h2 style="font-size:16px" class="print-only">${esc(S().ufficio)} — turni ${labelSettimana(curWeek)}${pubblicato ? '' : ' (bozza)'}</h2>`;
  el.innerHTML = toolbar + alerts + head + (orarioMode === 'turni' ? tabellaPerTurno(doc, edit) : tabellaPerPersona(doc, edit));
}

function nomePersona(pid, doc) { return state.persone.find(p => p.id === pid)?.nome || doc.persone.find(p => p.id === pid)?.nome || '—'; }
function motivoAssenza(pid, d) { return STATO[prepDoc(curWeek)?.stati?.[pid]?.[d] || '']?.short || 'Assente'; }

function cellHtml(doc, pid, q, d, edit) {
  const c = doc.ass[pid]?.[d];
  let inner;
  if (!c) inner = '<span class="c-x">·</span>';
  else if (c.x) inner = '<span class="c-x">—</span>';
  else if (c.a) inner = `<span class="chip c-ass">${esc(edit ? motivoAssenza(pid, d) : 'Assente')}</span>`;
  else if (c.rp) inner = '<span class="chip c-rp">Riposo</span>';
  else if (!c.t) inner = '<span class="c-x">—</span>';
  else inner = `<span class="chip t-${c.t}">${esc(turno(c.t)?.nome || c.t)}<small>${orarioTxt(c.t, d)}</small></span>`;
  const extra = (c && c.r && c.r !== q && !c.a && !c.x ? `<br><span class="tag" title="Ruolo nel turno">come ${esc(c.r)}</span>` : '')
    + (c?.w ? '<span class="flag" title="Richiesta personale non soddisfatta">⚠</span>' : '')
    + (c?.man && edit ? '<span class="flag" title="Modificato a mano">✎</span>' : '')
    + (c?.n ? `<span class="flag" title="${esc(c.n)}">💬</span>` : '');
  return `<td class="cell" ${edit ? `data-act="cell" data-p="${pid}" data-d="${d}"` : ''}>${inner}${extra}</td>`;
}

function tabellaPerPersona(doc, edit) {
  const giorni = giorniAttivi();
  const righe = personeOrdinate(doc.persone.map(p => ({ id: p.id, nome: nomePersona(p.id, doc), qualifica: state.persone.find(x => x.id === p.id)?.qualifica || p.q })));
  let grp = null, body = '';
  for (const p of righe) {
    if (p.qualifica !== grp) { grp = p.qualifica; body += `<tr class="grp"><td colspan="${giorni.length + 1}">${esc(grp)} · ${esc(qual(grp).nome)}</td></tr>`; }
    body += `<tr class="${p.id === me.personaId ? 'me-row' : ''}"><td class="name">${esc(p.nome)}${p.id === me.personaId ? ' <span class="badge">tu</span>' : ''}</td>
      ${giorni.map(d => cellHtml(doc, p.id, p.qualifica, d, edit)).join('')}</tr>`;
  }
  const foot = S().turni.map(t => `<tr><td>${esc(t.nome)}</td>${giorni.map(d => {
    if (!t.orari[d]) return '<td></td>';
    const c = copertura(doc, d, t.id);
    const det = Object.entries(c.per).filter(([, v]) => v.need).map(([q, v]) => `<span class="cov ${v.n < v.need ? 'short' : 'ok'}">${esc(q)} ${v.n}/${v.need}</span>`).join('');
    return `<td><b>${c.tot}</b> pers.${det}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="tablewrap"><table class="grid ${edit ? 'editable' : ''}">
    <thead><tr><th>Collaboratore</th>${giorni.map(d => `<th style="text-align:center">${GIORNI[d]} ${dataBreve(curWeek, d)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

function tabellaPerTurno(doc, edit) {
  const qOf = pid => doc.ass[pid] && Object.values(doc.ass[pid])[0]?.r;
  return `<div class="byshift">${giorniAttivi().map(d => {
    const blocchi = turniDelGiorno(d).map(t => {
      const pids = doc.persone.map(p => p.id).filter(pid => doc.ass[pid]?.[d]?.t === t && !doc.ass[pid][d].a);
      const c = copertura(doc, d, t);
      const short = Object.values(c.per).some(v => v.need && v.n < v.need);
      const lista = personeOrdinate(pids.map(pid => ({ id: pid, nome: nomePersona(pid, doc), qualifica: doc.ass[pid][d].r || qOf(pid) })));
      return `<div class="shift t-${t}"><div class="h"><span>${esc(turno(t).nome)} ${orarioTxt(t, d)}</span><span>${c.tot}${short ? ' ⚠' : ''}</span></div>
        <ul>${lista.map(p => `<li${p.id === me.personaId ? ' style="font-weight:700"' : ''}>${esc(p.nome)} <span class="small">(${esc(p.qualifica)})</span></li>`).join('')}</ul></div>`;
    }).join('');
    const fuori = doc.persone.filter(p => { const c = doc.ass[p.id]?.[d]; return c && (c.a || c.rp); });
    return `<div class="day"><h4>${GIORNI_L[d]} ${dataBreve(curWeek, d)}</h4>${blocchi}
      ${fuori.length ? `<div class="small muted">Non in turno: ${fuori.map(p => esc(nomePersona(p.id, doc)) + (edit ? ` (${esc(doc.ass[p.id][d].rp ? 'riposo' : motivoAssenza(p.id, d).toLowerCase())})` : '')).join(', ')}</div>` : ''}</div>`;
  }).join('')}</div>`;
}

/* ---------- vista PREPARAZIONE ---------- */
function renderPrep(el) {
  const giorni = giorniAttivi();
  const prep = prepDoc(curWeek) || { stati: {}, note: {} };
  const opts = sel => STATI.map(s => `<option value="${s.code}" ${s.code === sel ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
  const persone = personeOrdinate().filter(p => p.attivo !== false);
  let grp = null, body = '';
  for (const p of persone) {
    if (p.qualifica !== grp) { grp = p.qualifica; body += `<tr class="grp"><td colspan="${giorni.length + 3}">${esc(grp)} · ${esc(qual(grp).nome)}${qual(grp).turnazione !== 'alternata' ? ' — ' + esc(TURNAZIONI[qual(grp).turnazione]) : ''}</td></tr>`; }
    body += `<tr><td class="name">${esc(p.nome)}</td>
      <td><select data-change="prep-all" data-p="${p.id}"><option value="-">— tutta la settimana —</option>${opts('-')}</select></td>
      ${giorni.map(d => { const v = prep.stati?.[p.id]?.[d] || ''; return `<td><select class="s-${STATO[v].cat}" data-change="prep" data-p="${p.id}" data-d="${d}">${opts(v)}</select></td>`; }).join('')}
      <td><input data-change="prep-note" data-p="${p.id}" value="${esc(prep.note?.[p.id] || '')}" placeholder="Nota" style="min-width:150px"></td></tr>`;
  }
  el.innerHTML = `<div class="row">${weekNav()}<span class="spacer"></span>
      <button class="btn" data-act="prep-copy">Copia dalla settimana precedente</button>
      <button class="btn danger" data-act="prep-clear">Svuota</button>
      <button class="btn primary" data-act="genera">⚡ Genera bozza</button></div>
    <div class="card small muted">Imposta per ogni collaboratore lo stato della settimana. Chi è in <b>ferie, permesso, malattia, corso o riposo</b> non viene inserito nei turni.
      Le <b>richieste personali</b> indicano il turno preferito (vengono rispettate se possibile, o sempre se le regole le rendono vincolanti);
      le <b>esigenze aziendali</b> fissano il turno in modo obbligatorio.
      <div class="legend" style="margin-top:8px"><span class="s-richiesta">Richiesta personale</span><span class="s-aziendale">Esigenza aziendale</span><span class="s-assenza">Assenza</span></div></div>
    ${persone.length ? `<div class="tablewrap prep"><table><thead><tr><th>Collaboratore</th><th>Imposta tutti i giorni</th>
      ${giorni.map(d => `<th>${GIORNI[d]} ${dataBreve(curWeek, d)}</th>`).join('')}<th>Note</th></tr></thead><tbody>${body}</tbody></table></div>`
      : '<div class="card empty"><b>Nessun collaboratore</b>Aggiungi il personale nella sezione <a href="#personale">Personale</a>.</div>'}`;
}

/* ---------- vista PERSONALE ---------- */
function renderPersonale(el) {
  const list = personeOrdinate();
  el.innerHTML = `<div class="row"><span class="muted">${list.filter(p => p.attivo !== false).length} attivi su ${list.length}</span><span class="spacer"></span>
      <button class="btn" data-act="persona-import">Importa elenco</button>
      <button class="btn primary" data-act="persona-edit">+ Aggiungi collaboratore</button></div>
    <div class="tablewrap"><table><thead><tr><th>Nominativo</th><th>Qualifica</th><th>Turnazione</th><th>Livello di accesso</th><th>Email (login)</th><th>Stato</th><th></th></tr></thead>
    <tbody>${list.map(p => `<tr><td class="name">${esc(p.nome)}</td><td>${esc(p.qualifica)} <span class="muted small">${esc(qual(p.qualifica).nome)}</span></td>
      <td class="small">${esc(TURNAZIONI[qual(p.qualifica).turnazione] || '')}</td><td class="small">${esc(LIVELLI[qual(p.qualifica).livello])}</td>
      <td class="small">${esc(p.email || '')}</td>
      <td>${p.attivo !== false ? '<span class="badge ok">Attivo</span>' : '<span class="badge">Non attivo</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-act="persona-edit" data-p="${p.id}">Modifica</button>
        <button class="btn sm danger" data-act="persona-del" data-p="${p.id}">Elimina</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Nessun collaboratore. Usa «Aggiungi» o «Importa elenco».</td></tr>'}</tbody></table></div>`;
}

/* ---------- vista REGOLE ---------- */
function renderRegole(el) {
  const st = S(), R = st.regole, sup = can('super');
  const chk = (k, v) => `<input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}>`;
  const sel = (k, v, o) => `<select data-k="${k}">${Object.entries(o).map(([a, b]) => `<option value="${a}" ${a === v ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  const cols = colonneCopertura();
  const regole = [
    ['Assenze', '<span class="badge ok">Sempre attiva</span>', 'Chi è in ferie, permesso, malattia, corso o riposo nella settimana non viene inserito in nessun turno.', ''],
    ['Esigenze aziendali', `<label class="switch">${chk('regole.aziendali.on', R.aziendali.on)} attiva</label>`,
      'Turno imposto dall\'azienda (presidio, riunioni) o assenza per corso: ha la precedenza su tutte le altre regole.', ''],
    ['Copertura minima per qualifica', `<label class="switch">${chk('regole.copertura.on', R.copertura.on)} attiva</label>`,
      'Numero minimo di persone di ogni qualifica in ciascun turno (es. almeno 3 OSP). Se un turno è scoperto, l\'algoritmo sposta colleghi dall\'altro turno senza scoprirlo; se non basta segnala l\'avviso.',
      `<div class="tablewrap" style="width:100%"><table><thead><tr><th>Qualifica</th>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${st.qualifiche.map(q => `<tr><td><b>${esc(q.code)}</b> <span class="small muted">${esc(q.nome)}</span></td>${cols.map(c => `<td><input type="number" min="0" data-k="regole.copertura.min.${q.code}.${c.key}" value="${R.copertura.min[q.code]?.[c.key] || 0}"></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`],
    ['Richieste personali', `<label class="switch">${chk('regole.richieste.on', R.richieste.on)} attiva</label>`,
      'Il collega chiede un turno preciso (es. pomeriggio per una visita al mattino).',
      `<label>${chk('regole.richieste.vincolanti', R.richieste.vincolanti)} Vincolanti: rispettate sempre, anche a costo di lasciare scoperto un turno (altrimenti la copertura minima ha la precedenza)</label>`],
    ['Alternanza mattina / pomeriggio', `<label class="switch">${chk('regole.alternanza.on', R.alternanza.on)} attiva</label>`,
      'Chi ha fatto la mattina la settimana precedente fa il pomeriggio, e viceversa. Disattivata, ognuno resta nel turno della settimana prima.',
      `<label>Modalità ${sel('regole.alternanza.modo', R.alternanza.modo, { settimanale: 'Settimanale (cambia ogni settimana)', giornaliera: 'Giornaliera (cambia ogni giorno)' })}</label>`],
    ['Giorni a turno unico (sabato)', '', 'Il sabato c\'è solo il turno di mattina.',
      `<label>${sel('regole.sabato.modo', R.sabato.modo, { tutti: 'Tutti i disponibili lavorano', rotazione: 'Rotazione: solo il numero indicato, a turno' })}</label>
       <label>Persone in rotazione <input type="number" min="0" data-k="regole.sabato.persone" value="${R.sabato.persone}"></label>`],
    ['Bilanciamento', `<label class="switch">${chk('regole.bilanciamento.on', R.bilanciamento.on)} attiva</label>`,
      'Riequilibra il numero di persone tra mattina e pomeriggio quando le assenze lo sbilanciano, senza violare la copertura minima.',
      `<label>Differenza massima ammessa <input type="number" min="0" data-k="regole.bilanciamento.maxDiff" value="${R.bilanciamento.maxDiff}"></label>`],
  ];
  el.innerHTML = `${sup ? '' : '<div class="card small">🔒 Solo il <b>Super user</b> può modificare regole, orari e qualifiche. Qui puoi consultarle.</div>'}
  <fieldset ${sup ? '' : 'disabled'} class="rules-fs" style="display:flex;flex-direction:column;gap:16px">
    <div class="card"><h3>Regole di popolamento <span class="muted small">(in ordine di priorità)</span></h3><div class="rules">
      ${regole.map(([t, sw, d, p], i) => `<div class="rule"><div class="n">${i + 1}</div><div class="t">${t} ${sw}</div><div class="d">${d}</div>${p ? `<div class="p">${p}</div>` : '<div></div>'}</div>`).join('')}
    </div></div>

    <div class="card"><h3>Calendario: orari dei turni</h3>
      <div class="tablewrap"><table><thead><tr><th>Turno</th>${GIORNI.map(g => `<th>${g}</th>`).join('')}</tr></thead><tbody>
      ${st.turni.map((t, ti) => `<tr><td><input data-k="turni.${ti}.nome" value="${esc(t.nome)}" style="width:120px"></td>
        ${GIORNI.map((g, d) => `<td style="white-space:nowrap"><label class="switch small"><input type="checkbox" data-orario="${ti}|${d}" ${t.orari[d] ? 'checked' : ''}> attivo</label>
          ${t.orari[d] ? `<br><input class="hhmm" data-k="turni.${ti}.orari.${d}.0" value="${t.orari[d][0]}" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="hh:mm"> – <input class="hhmm" data-k="turni.${ti}.orari.${d}.1" value="${t.orari[d][1]}" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="hh:mm">` : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>

    <div class="card"><h3>Qualifiche</h3>
      <p class="small muted" style="margin-top:0">Il <b>livello di accesso</b> è quello proposto quando si abilita un account; la <b>turnazione</b> dice come la qualifica entra nella generazione automatica.</p>
      <div class="tablewrap"><table><thead><tr><th>Codice</th><th>Descrizione</th><th>Livello di accesso</th><th>Turnazione</th><th></th></tr></thead><tbody>
      ${st.qualifiche.map((q, i) => `<tr><td><b>${esc(q.code)}</b></td><td><input data-k="qualifiche.${i}.nome" value="${esc(q.nome)}"></td>
        <td>${sel(`qualifiche.${i}.livello`, q.livello, LIVELLI)}</td><td>${sel(`qualifiche.${i}.turnazione`, q.turnazione, TURNAZIONI)}</td>
        <td style="text-align:right"><button class="btn sm" data-act="qual-move" data-i="${i}" title="Sposta su">↑</button> <button class="btn sm danger" data-act="qual-del" data-i="${i}">Elimina</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn" data-act="qual-add">+ Aggiungi qualifica</button><span class="spacer"></span>
        <button class="btn danger" data-act="regole-reset">Ripristina regole predefinite</button></div></div>
  </fieldset>`;
}

/* ---------- vista UTENTI ---------- */
function renderUtenti(el) {
  const M = [
    ['Visualizzare l\'orario pubblicato', 1, 1, 1],
    ['Vedere le bozze non ancora pubblicate', 0, 1, 1],
    ['Impostare ferie, permessi, richieste ed esigenze aziendali', 0, 1, 1],
    ['Generare la bozza automatica', 0, 1, 1],
    ['Modificare a mano i turni', 0, 1, 1],
    ['Pubblicare / ritirare l\'orario', 0, 1, 1],
    ['Gestire l\'anagrafica del personale', 0, 1, 1],
    ['Consultare le regole', 0, 1, 1],
    ['Modificare regole, orari dei turni e qualifiche', 0, 0, 1],
    ['Abilitare utenti e assegnare i livelli, backup', 0, 0, 1],
  ];
  const yn = v => (v ? '<span class="yes">✓</span>' : '<span class="no">—</span>');
  const perLiv = l => S().qualifiche.filter(q => q.livello === l).map(q => q.code).join(', ') || '—';
  el.innerHTML = `<div class="card"><h3>Livelli di utilizzo</h3><div class="tablewrap"><table class="matrix">
    <thead><tr><th>Azione</th>${Object.values(LIVELLI).map(l => `<th>${l}</th>`).join('')}</tr></thead>
    <tbody>${M.map(([a, ...v]) => `<tr><td>${a}</td>${v.map(yn).join('')}</tr>`).join('')}
    <tr><td class="muted small">Qualifiche proposte</td>${Object.keys(LIVELLI).map(l => `<td class="small muted">${perLiv(l)}</td>`).join('')}</tr></tbody></table></div></div>
    <div class="card" id="utentiBox">${CLOUD ? '<span class="muted">Caricamento…</span>'
      : `<h3>Account</h3><p class="muted">In modalità locale non ci sono account: puoi simulare i tre livelli con il selettore in basso a sinistra.
         Collegando il database condiviso (vedi README) ogni persona entra con la propria email e vede solo ciò che il suo livello consente.</p>`}</div>`;
  if (CLOUD) renderUtentiCloud($('#utentiBox'));
}
async function renderUtentiCloud(box) {
  let list;
  try { list = await Cloud.listUtenti(); } catch (e) { box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  const sup = can('super');
  const personaDi = email => state.persone.find(p => (p.email || '').toLowerCase() === email);
  const senza = state.persone.filter(p => p.email && !list.some(u => u.email === p.email.toLowerCase()));
  box.innerHTML = `<h3>Account abilitati</h3>
    <div class="tablewrap"><table><thead><tr><th>Email</th><th>Nome</th><th>Livello</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.nome || personaDi(u.email)?.nome || '')}</td>
      <td>${sup && u.email !== me.email ? `<select data-change="utente-liv" data-e="${esc(u.email)}">${Object.entries(LIVELLI).map(([k, l]) => `<option value="${k}" ${k === u.livello ? 'selected' : ''}>${l}</option>`).join('')}</select>` : LIVELLI[u.livello]}</td>
      <td style="text-align:right">${sup && u.email !== me.email ? `<button class="btn sm danger" data-act="utente-del" data-e="${esc(u.email)}">Rimuovi</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${sup ? `<form class="row" id="utenteForm" style="margin-top:12px">
      <input type="email" name="email" placeholder="email@esempio.it" required style="flex:1;min-width:200px">
      <input name="nome" placeholder="Nome">
      <select name="livello">${Object.entries(LIVELLI).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button class="btn primary">Abilita</button></form>
      ${senza.length ? `<p class="small muted">Collaboratori con email non ancora abilitati: ${senza.map(p => `<a href="#" data-act="utente-da-persona" data-p="${p.id}">${esc(p.nome)}</a>`).join(', ')}</p>` : ''}
      <p class="small muted">La persona apre la pagina e crea il proprio account con quella email («Primo accesso»). Rimuovendola, il database non le mostra più nulla.</p>` : ''}`;
  const f = $('#utenteForm');
  if (f) f.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(f);
    try { await Cloud.saveUtente({ email: fd.get('email').trim().toLowerCase(), nome: fd.get('nome').trim(), livello: fd.get('livello') }); toast('Utente abilitato'); renderUtentiCloud(box); }
    catch (e) { toast('Errore: ' + e.message); }
  };
}

/* ---------- vista IMPOSTAZIONI ---------- */
function renderImpostazioni(el) {
  el.innerHTML = `<div class="card"><h3>Ufficio</h3>
      <div class="field"><label>Nome dell'ufficio</label><input data-k="ufficio" value="${esc(S().ufficio)}"></div></div>
    <div class="card"><h3>Backup</h3><div class="row">
      <button class="btn" data-act="export">⬇ Esporta backup (JSON)</button>
      <label class="btn">⬆ Importa backup<input type="file" accept=".json" data-change="import" hidden></label></div></div>
    <div class="card"><h3>Dati</h3><div class="row">
      <button class="btn" data-act="demo">Carica dati demo</button>
      <button class="btn danger" data-act="svuota">Cancella tutto</button></div>
      <p class="small muted">Operazioni non reversibili: esporta prima un backup.</p></div>`;
}

/* ---------- modal ---------- */
function openModal(title, html) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; if (window.Cloud) Cloud.onModalClosed(); }
const modalOpen = () => !$('#modal').hidden;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOpen()) closeModal(); });

function modalCella(pid, d) {
  const doc = weekDoc(curWeek); const c = doc.ass[pid]?.[d] || { t: '' };
  const p = state.persone.find(x => x.id === pid);
  const cur = c.a ? 'A' : c.rp ? 'R' : c.x || !c.t ? '-' : c.t;
  const opts = [...turniDelGiorno(d).map(t => [t, `${turno(t).nome} ${orarioTxt(t, d)}`]), ['A', 'Assente'], ['R', 'Riposo'], ['-', 'Non in turno']];
  const prepSt = prepDoc(curWeek)?.stati?.[pid]?.[d];
  openModal(`${nomePersona(pid, doc)} — ${GIORNI_L[d]} ${dataBreve(curWeek, d)}`, `<form id="cellForm">
    ${prepSt ? `<div class="msg" style="margin-bottom:12px">Impostato in preparazione: <b>${esc(STATO[prepSt].label)}</b></div>` : ''}
    <div class="field"><label>Turno</label><div class="radios">${opts.map(([v, l]) => `<label><input type="radio" name="t" value="${v}" ${v === cur ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>
    <div class="field"><label>Ruolo nel turno</label><select name="r">${S().qualifiche.map(q => `<option value="${q.code}" ${q.code === (c.r || p?.qualifica) ? 'selected' : ''}>${esc(q.code)} — ${esc(q.nome)}</option>`).join('')}</select>
      <span class="small muted">Es. un SCF che copre lo sportello conta come OSP nella copertura minima.</span></div>
    <div class="field"><label>Nota (visibile a tutti)</label><input name="n" value="${esc(c.n || '')}"></div>
    <div class="modal-actions"><button type="button" class="btn" data-act="modal-close">Annulla</button><button class="btn primary">Salva</button></div></form>`);
  $('#cellForm').onsubmit = ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target); const t = fd.get('t');
    const nc = { t: '', r: fd.get('r'), man: 1 };
    if (t === 'A') nc.a = 1; else if (t === 'R') nc.rp = 1; else if (t !== '-') nc.t = t;
    if (fd.get('n').trim()) nc.n = fd.get('n').trim();
    (doc.ass[pid] ||= {})[d] = nc;
    if (!doc.persone.some(x => x.id === pid)) doc.persone.push({ id: pid, nome: p?.nome, q: p?.qualifica });
    save(); closeModal(); render();
  };
}

function modalPersona(id) {
  const p = state.persone.find(x => x.id === id) || { nome: '', qualifica: 'OSP', email: '', attivo: true };
  openModal(id ? 'Modifica collaboratore' : 'Nuovo collaboratore', `<form id="pForm">
    <div class="field"><label>Cognome e nome</label><input name="nome" required value="${esc(p.nome)}"></div>
    <div class="field"><label>Qualifica</label><select name="qualifica">${S().qualifiche.map(q => `<option value="${q.code}" ${q.code === p.qualifica ? 'selected' : ''}>${esc(q.code)} — ${esc(q.nome)}</option>`).join('')}</select></div>
    <div class="field"><label>Email (per il login e per evidenziare i propri turni)</label><input type="email" name="email" value="${esc(p.email || '')}"></div>
    <label class="switch"><input type="checkbox" name="attivo" ${p.attivo !== false ? 'checked' : ''}> In servizio (considerato nella generazione)</label>
    <div class="modal-actions"><button type="button" class="btn" data-act="modal-close">Annulla</button><button class="btn primary">Salva</button></div></form>`);
  $('#pForm').onsubmit = ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = { nome: fd.get('nome').trim(), qualifica: fd.get('qualifica'), email: fd.get('email').trim().toLowerCase(), attivo: fd.get('attivo') === 'on' };
    if (id) Object.assign(p, data); else state.persone.push({ id: uid(), ...data });
    identifica(); save(); closeModal(); render();
  };
}

function modalImport() {
  openModal('Importa elenco collaboratori', `<p class="small muted" style="margin-top:0">Una persona per riga: <b>Cognome Nome; QUALIFICA; email</b> (qualifica ed email facoltative, separatori ; , o tabulazione — si può incollare da Excel). Qualifiche valide: ${S().qualifiche.map(q => q.code).join(', ')}.</p>
    <textarea id="impTxt" placeholder="Rossi Mario; OSP&#10;Verdi Anna; SCF; anna.verdi@esempio.it"></textarea>
    <div class="modal-actions"><button class="btn" data-act="modal-close">Annulla</button><button class="btn primary" data-act="import-run">Importa</button></div>`);
}

/* ---------- azioni ---------- */
const ACT = {
  'modal-close': closeModal,
  logout: () => Cloud.logout(),
  week: el => { curWeek = addDays(curWeek, +el.dataset.n); render(); },
  'week-next': () => { curWeek = settimanaProssima(); render(); },
  mode: el => { orarioMode = el.dataset.m; render(); },
  print: () => window.print(),
  genera: () => {
    const old = weekDoc(curWeek);
    if (!state.persone.some(p => p.attivo !== false)) return toast('Aggiungi prima il personale');
    if (old && !confirm(old.stato === 'pubblicata' ? 'L\'orario di questa settimana è già pubblicato: rigenerandolo torna in bozza. Continuare?' : 'Rigenerare la bozza di questa settimana?')) return;
    const nMan = old ? Object.values(old.ass).reduce((n, r) => n + Object.values(r).filter(c => c.man).length, 0) : 0;
    const mantieni = nMan ? confirm(`Ci sono ${nMan} modifiche fatte a mano.\nOK = mantienile, Annulla = rigenera tutto da capo.`) : false;
    state.settimane['w-' + curWeek] = genera(curWeek, mantieni);
    save();
    if (location.hash !== '#orario') location.hash = '#orario'; else render();
    toast('Bozza generata');
  },
  pubblica: () => {
    const doc = weekDoc(curWeek); const av = avvisiCopertura(doc);
    if (av.length && !confirm(`Ci sono ${av.length} turni con copertura insufficiente. Pubblicare comunque?`)) return;
    Object.assign(doc, { stato: 'pubblicata', pubblicataIl: new Date().toISOString(), pubblicataDa: me.email || '' });
    save(); render(); toast('Orario pubblicato: ora è visibile a tutti');
  },
  ritira: () => { if (!confirm('Riportare l\'orario in bozza? Gli utenti non lo vedranno più finché non verrà ripubblicato.')) return; weekDoc(curWeek).stato = 'bozza'; save(); render(); },
  cell: el => modalCella(el.dataset.p, +el.dataset.d),
  csv: () => {
    const doc = weekDoc(curWeek); const g = giorniAttivi();
    const txt = c => !c || c.x ? '' : c.a ? 'Assente' : c.rp ? 'Riposo' : '';
    const rows = [['Collaboratore', 'Qualifica', ...g.map(d => `${GIORNI[d]} ${dataBreve(curWeek, d)}`)]];
    for (const p of doc.persone) rows.push([nomePersona(p.id, doc), p.q, ...g.map(d => { const c = doc.ass[p.id]?.[d]; return c?.t && !c.a ? `${turno(c.t).nome} ${orarioTxt(c.t, d)}${c.r !== p.q ? ' (' + c.r + ')' : ''}` : txt(c); })]);
    download(`turni-${curWeek}.csv`, '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n'), 'text/csv');
  },
  'prep-clear': () => { if (!confirm('Cancellare stati e richieste di questa settimana?')) return; delete state.prep['prep-' + curWeek]; save(); render(); },
  'prep-copy': () => {
    const prev = prepDoc(addDays(curWeek, -7));
    if (!prev) return toast('Nessun dato nella settimana precedente');
    const p = prepDoc(curWeek, true); p.stati = clone(prev.stati || {}); p.note = clone(prev.note || {});
    save(); render(); toast('Copiato dalla settimana precedente');
  },
  'persona-edit': el => modalPersona(el.dataset.p),
  'persona-del': el => {
    const p = state.persone.find(x => x.id === el.dataset.p);
    if (!confirm(`Eliminare ${p.nome}? Gli orari già generati restano. In alternativa puoi segnarlo «non in servizio».`)) return;
    state.persone = state.persone.filter(x => x !== p); save(); render();
  },
  'persona-import': modalImport,
  'import-run': () => {
    const codes = S().qualifiche.map(q => q.code);
    let n = 0; const scarti = [];
    for (const line of $('#impTxt').value.split(/\r?\n/)) {
      const parts = line.split(/[;\t,]/).map(s => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      const q = (parts[1] || 'OSP').toUpperCase();
      if (!codes.includes(q)) { scarti.push(line); continue; }
      if (state.persone.some(p => p.nome.toLowerCase() === parts[0].toLowerCase())) { scarti.push(line + ' (già presente)'); continue; }
      state.persone.push({ id: uid(), nome: parts[0], qualifica: q, email: (parts[2] || '').toLowerCase(), attivo: true }); n++;
    }
    save(); closeModal(); render();
    toast(`${n} collaboratori importati` + (scarti.length ? `, ${scarti.length} righe scartate` : ''));
    if (scarti.length) alert('Righe non importate:\n' + scarti.join('\n'));
  },
  'qual-add': () => {
    const code = (prompt('Codice della nuova qualifica (es. OSP):') || '').trim().toUpperCase();
    if (!code) return;
    if (S().qualifiche.some(q => q.code === code)) return toast('Codice già esistente');
    S().qualifiche.push({ code, nome: code, livello: 'user', turnazione: 'alternata' }); save(); render();
  },
  'qual-del': el => {
    const q = S().qualifiche[+el.dataset.i];
    const n = state.persone.filter(p => p.qualifica === q.code).length;
    if (n) return alert(`Ci sono ${n} collaboratori con qualifica ${q.code}: cambiala prima di eliminarla.`);
    if (!confirm(`Eliminare la qualifica ${q.code}?`)) return;
    S().qualifiche.splice(+el.dataset.i, 1); delete S().regole.copertura.min[q.code]; save(); render();
  },
  'qual-move': el => { const i = +el.dataset.i; if (!i) return; const a = S().qualifiche; [a[i - 1], a[i]] = [a[i], a[i - 1]]; save(); render(); },
  'regole-reset': () => { if (!confirm('Ripristinare turni, qualifiche e regole predefiniti?')) return; const u = S().ufficio; state.settings = defaultSettings(); state.settings.ufficio = u; save(); render(); },
  export: () => download(`turni-backup-${ymd(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json'),
  demo: () => { if (!confirm('Sostituire tutti i dati con i dati demo?')) return; state = demoState(); identifica(); save(); render(); },
  svuota: () => { if (!confirm('Cancellare TUTTI i dati (personale, orari, regole)?')) return; state = statoVuoto(); identifica(); save(); render(); },
  'utente-del': async el => {
    if (!confirm(`Togliere l'accesso a ${el.dataset.e}?`)) return;
    try { await Cloud.deleteUtente(el.dataset.e); render(); } catch (e) { toast('Errore: ' + e.message); }
  },
  'utente-da-persona': el => {
    const p = state.persone.find(x => x.id === el.dataset.p); const f = $('#utenteForm');
    f.email.value = p.email; f.nome.value = p.nome; f.livello.value = qual(p.qualifica).livello || 'user'; f.email.focus();
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  ACT[el.dataset.act]?.(el, e);
});

function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = (o[ks[i]] ??= {});
  o[ks.at(-1)] = val;
}
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.k) {
    if (!can('super')) return;
    if (el.classList.contains('hhmm')) {
      const m = el.value.trim().match(/^(\d{1,2})[:.](\d{2})$/);
      if (!m || +m[1] > 23 || +m[2] > 59) { toast('Orario non valido: usa il formato hh:mm'); return render(); }
      el.value = pad(+m[1]) + ':' + m[2];
    }
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, +el.value || 0) : el.value;
    setPath(state.settings, el.dataset.k, v); save(); render(); return;
  }
  if (el.dataset.orario) {
    const [ti, d] = el.dataset.orario.split('|').map(Number); const t = S().turni[ti];
    if (el.checked) t.orari[d] = t.id === 'M' ? ['08:00', d === 5 ? '13:10' : '14:10'] : ['13:30', '19:40']; else delete t.orari[d];
    save(); render(); return;
  }
  switch (el.dataset.change) {
    case 'profilo': me.livello = el.value; try { localStorage.setItem(LS_PROFILO, el.value); } catch { } render(); break;
    case 'prep': {
      const p = prepDoc(curWeek, true); const pid = el.dataset.p, d = el.dataset.d;
      p.stati[pid] ||= {}; if (el.value) p.stati[pid][d] = el.value; else delete p.stati[pid][d];
      el.className = 's-' + STATO[el.value].cat; save(); break;
    }
    case 'prep-all': {
      if (el.value === '-') return;
      const p = prepDoc(curWeek, true); const pid = el.dataset.p;
      p.stati[pid] = {}; if (el.value) for (const d of giorniAttivi()) p.stati[pid][d] = el.value;
      save(); render(); break;
    }
    case 'prep-note': { const p = prepDoc(curWeek, true); p.note ||= {}; if (el.value.trim()) p.note[el.dataset.p] = el.value.trim(); else delete p.note[el.dataset.p]; save(); break; }
    case 'import': {
      const f = el.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data.settings || !Array.isArray(data.persone)) throw new Error('file non valido');
        if (!confirm('Sostituire tutti i dati con il backup?')) return;
        state = { settings: migraSettings(data.settings), persone: data.persone, prep: data.prep || {}, settimane: data.settimane || {} };
        identifica(); save(); render(); toast('Backup importato');
      } catch (err) { toast('Importazione non riuscita: ' + err.message); }
      break;
    }
    case 'utente-liv':
      try { await Cloud.saveUtente({ email: el.dataset.e, livello: el.value }); toast('Livello aggiornato'); } catch (err) { toast('Errore: ' + err.message); }
      break;
  }
});

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function identifica() {
  me.personaId = me.email ? state.persone.find(p => (p.email || '').toLowerCase() === me.email.toLowerCase())?.id || null : null;
}

/* ---------- avvio ---------- */
function startLocal() {
  state = loadLocal();
  try { const l = localStorage.getItem(LS_PROFILO); if (LIVELLI[l]) me.livello = l; } catch { }
  save(); render();
}
window.addEventListener('DOMContentLoaded', () => { if (CLOUD) Cloud.boot(); else startLocal(); });
