/* Agenda Ristorante — database condiviso (Supabase) con accesso riservato allo staff.
   Se config.js è vuoto l'app funziona in modalità locale (solo questo browser).

   Modello dati: una tabella `agenda_docs` con un documento per ogni elemento
   (prenotazione, piatto, menu, servizio, sala, chiusura) + un documento `settings`.
   Ogni modifica salva solo gli elementi cambiati, così più persone possono lavorare
   insieme senza sovrascriversi; le modifiche degli altri arrivano in tempo reale. */
'use strict';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const TABLE = 'agenda_docs';
const KINDS = { prenotazione: 'prenotazioni', piatto: 'piatti', menu: 'menu', servizio: 'servizi', sala: 'sale', chiusura: 'chiusure' };
const CLIENT_ID = uid();

let sb = null;            // client Supabase
let me = null;            // { email, ruolo }
let cloudReady = false;   // dati caricati e sincronizzazione attiva
let channel = null;
const synced = new Map(); // id -> contenuto (stringa stabile) presente sul server
let syncTimer = null, syncing = false, syncAgain = false, remotePending = false;

/* ---------- utilità ---------- */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
function loadScript(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Impossibile caricare ' + src));
    document.head.appendChild(s);
  });
}
function setSync(state, msg = '') {
  const el = $('#syncState'); if (!el) return;
  const map = { ok: ['ok', '● Sincronizzato'], saving: ['warn', '● Salvataggio…'], error: ['danger', '⚠ Non salvato'], off: ['danger', '⚠ Offline'] };
  const [cls, label] = map[state] || map.ok;
  el.className = 'badge ' + cls; el.textContent = label; el.title = msg; el.hidden = false;
}

/* ---------- avvio ---------- */
async function boot() {
  if (!CLOUD) { save(); route(); return; }
  showAuth('loading');
  try {
    if (!window.supabase) await loadScript(SUPABASE_CDN);
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  } catch (e) {
    return showAuth('error', 'Connessione al database non riuscita. Controlla la connessione internet e config.js. (' + e.message + ')');
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') return showAuth('newpass');
    if (event === 'SIGNED_OUT') signedOut();
  });
  const { data } = await sb.auth.getSession();
  if (location.hash.includes('type=recovery')) return showAuth('newpass');
  if (data.session) await enterCloud(data.session.user);
  else showAuth('login');
}

async function enterCloud(user) {
  showAuth('loading', 'Caricamento dati…');
  const { data: ok, error } = await sb.rpc('is_staff');
  if (error) return showAuth('error', 'Errore di accesso al database: ' + error.message + '. Hai eseguito lo script supabase/schema.sql?');
  if (!ok) {
    await sb.auth.signOut();
    return showAuth('login', `L'account ${user.email} non è autorizzato. Chiedi all'amministratore di aggiungerti allo staff.`, true);
  }
  const { data: isAdm } = await sb.rpc('is_admin');
  me = { email: user.email, ruolo: isAdm ? 'admin' : 'staff' };

  // carica tutti i documenti (a pagine da 1000)
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: e2 } = await sb.from(TABLE).select('id, kind, data').range(from, from + 999);
    if (e2) return showAuth('error', 'Lettura dati non riuscita: ' + e2.message);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  synced.clear();
  S = emptyState();
  for (const r of rows) {
    synced.set(r.id, stable(r.data));
    putDoc(r.kind, r.data);
  }
  S = normalize(S);
  subscribeRealtime();
  hideAuth();
  cloudReady = true;
  setSync('ok');
  route();
  if (!rows.length) firstRun();
}

// uscita: niente dati in memoria, si torna alla schermata di accesso
function signedOut() {
  cloudReady = false; me = null;
  if (channel) { sb.removeChannel(channel); channel = null; }
  synced.clear(); S = emptyState();
  if (!$('#modal').hidden) closeModal();
  $('#view').innerHTML = '';
  showAuth('login');
}

function putDoc(kind, data) {
  if (kind === 'settings') { S.settings = { ...emptyState().settings, ...data }; return; }
  const coll = KINDS[kind]; if (!coll) return;
  const i = S[coll].findIndex(x => x.id === data.id);
  if (i >= 0) S[coll][i] = data; else S[coll].push(data);
}
function removeDoc(id) {
  for (const coll of Object.values(KINDS)) {
    const i = S[coll].findIndex(x => x.id === id);
    if (i >= 0) { S[coll].splice(i, 1); return; }
  }
}
function docsOf(state) {
  const out = new Map([['settings', { kind: 'settings', data: state.settings }]]);
  for (const [kind, coll] of Object.entries(KINDS)) for (const x of state[coll] || []) out.set(x.id, { kind, data: x });
  return out;
}

/* ---------- primo avvio con database vuoto ---------- */
function firstRun() {
  let local = null;
  try { const raw = localStorage.getItem(DB_KEY); if (raw) local = normalize(JSON.parse(raw)); } catch { /* niente */ }
  openModal('Benvenuto nel database condiviso', `
    <p>Il database è vuoto. Come vuoi iniziare?</p>
    <div class="grid" style="gap:10px">
      ${local ? `<button class="btn primary" id="frLocal">⬆ Carica i dati di questo browser (${local.prenotazioni.length} prenotazioni)</button>` : ''}
      <button class="btn ${local ? '' : 'primary'}" id="frDemo">Carica i dati demo (da cancellare poi)</button>
      <button class="btn" id="frEmpty">Inizia da zero (3 sale e turni standard)</button>
    </div>
    <p class="small muted" style="margin-top:12px">Puoi anche importare un backup JSON in qualsiasi momento da Impostazioni.</p>`);
  const go = st => { S = st; closeModal(); save(); route(); toast('Dati caricati nel database'); };
  $('#frLocal')?.addEventListener('click', () => go(local));
  $('#frDemo').onclick = () => go(seed());
  $('#frEmpty').onclick = () => {
    const st = emptyState();
    st.sale = [{ id: uid(), nome: 'Sala principale', capienza: 60, tavoli: 15, note: '' }];
    go(st);
  };
}

/* ---------- salvataggio (solo differenze) ---------- */
function cloudSave() {
  if (!cloudReady) return;
  setSync('saving');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 250);
}
async function syncNow() {
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  try {
    const docs = docsOf(S), up = [], del = [];
    for (const [id, d] of docs) {
      const j = stable(d.data);
      if (synced.get(id) !== j) up.push({ row: { id, kind: d.kind, data: d.data, updated_at: new Date().toISOString(), updated_by: me.email, client_id: CLIENT_ID }, j });
    }
    for (const id of synced.keys()) if (!docs.has(id)) del.push(id);
    for (let i = 0; i < up.length; i += 500) {
      const chunk = up.slice(i, i + 500);
      const { error } = await sb.from(TABLE).upsert(chunk.map(x => x.row));
      if (error) throw error;
      chunk.forEach(x => synced.set(x.row.id, x.j));
    }
    for (let i = 0; i < del.length; i += 200) {
      const chunk = del.slice(i, i + 200);
      const { error } = await sb.from(TABLE).delete().in('id', chunk);
      if (error) throw error;
      chunk.forEach(id => synced.delete(id));
    }
    setSync('ok');
  } catch (e) {
    setSync('error', e.message || String(e));
    toast('⚠️ Salvataggio non riuscito: ' + (e.message || e) + ' — riprovo alla prossima modifica');
    clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 8000);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; syncNow(); }
  }
}
window.addEventListener('beforeunload', e => {
  if (CLOUD && cloudReady && (syncing || syncTimer && $('#syncState')?.textContent.includes('Salvataggio'))) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- tempo reale ---------- */
function subscribeRealtime() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('agenda')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, applyRemote)
    .subscribe(status => {
      if (status === 'SUBSCRIBED') setSync('ok');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSync('off', 'Aggiornamenti in tempo reale non disponibili: ricarica la pagina');
    });
}
function applyRemote(payload) {
  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id; if (!id || !synced.has(id)) return;
    synced.delete(id); removeDoc(id);
  } else {
    const r = payload.new;
    if (!r || r.client_id === CLIENT_ID) return; // eco delle mie modifiche
    const j = stable(r.data);
    if (synced.get(r.id) === j) return;
    synced.set(r.id, j); putDoc(r.kind, r.data);
  }
  remoteRefresh();
}
function remoteRefresh() {
  if (!$('#modal').hidden) { remotePending = true; return; } // non disturbare chi sta compilando
  const q = document.activeElement?.id === 'fQ';
  route();
  if (q) { const i = $('#fQ'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
}
function onModalClosed() {
  if (remotePending) { remotePending = false; route(); }
}
// quando la pagina torna in primo piano dopo molto tempo, ricarica per sicurezza
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (!CLOUD || !cloudReady) return;
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000 && $('#modal').hidden) sb.auth.getUser().then(({ data }) => data.user && enterCloud(data.user));
});

/* ---------- schermata di accesso ---------- */
function showAuth(mode, msg = '', isError = false) {
  const box = $('#auth');
  box.hidden = false;
  document.body.classList.add('locked');
  const name = 'Agenda Ristorante';
  const head = `<div class="auth-logo">🍽️</div><h2>${esc(name)}</h2><p class="muted small">Area riservata allo staff</p>`;
  const note = msg ? `<div class="alert ${isError || mode === 'error' ? 'danger' : 'info'}">${esc(msg)}</div>` : '';
  if (mode === 'loading' || mode === 'error') {
    box.innerHTML = `<div class="auth-card">${head}${note || '<p class="muted">Connessione in corso…</p>'}
      ${mode === 'error' ? '<button class="btn" onclick="location.reload()">Riprova</button>' : ''}</div>`;
    return;
  }
  if (mode === 'newpass') {
    box.innerHTML = `<form class="auth-card" id="authForm">${head}${note}
      <label class="field">Nuova password<input type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
      <button class="btn primary full">Salva password</button></form>`;
    $('#authForm').onsubmit = async e => {
      e.preventDefault();
      const { data, error } = await sb.auth.updateUser({ password: e.target.pw.value });
      if (error) return showAuth('newpass', error.message, true);
      history.replaceState(null, '', location.pathname + '#oggi');
      enterCloud(data.user);
    };
    return;
  }
  const signup = mode === 'signup';
  box.innerHTML = `<form class="auth-card" id="authForm">${head}${note}
    <label class="field">Email<input type="email" name="email" required autocomplete="username"></label>
    <label class="field">Password<input type="password" name="pw" ${signup ? 'minlength="8"' : ''} required autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
    <button class="btn primary full">${signup ? 'Crea account' : 'Accedi'}</button>
    <div class="auth-links">
      ${signup ? '<a href="#" data-m="login">Ho già un account</a>' : '<a href="#" data-m="signup">Primo accesso? Crea l\'account</a><a href="#" data-m="reset">Password dimenticata?</a>'}
    </div>
    ${signup ? '<p class="small muted">Puoi creare l\'account solo con un\'email che l\'amministratore ha già aggiunto allo staff.</p>' : ''}
  </form>`;
  $$('[data-m]', box).forEach(a => a.onclick = ev => { ev.preventDefault(); a.dataset.m === 'reset' ? resetPassword() : showAuth(a.dataset.m); });
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const email = e.target.email.value.trim().toLowerCase(), password = e.target.pw.value;
    const btn = $('button.primary', e.target); btn.disabled = true; btn.textContent = 'Attendere…';
    if (signup) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } });
      if (error) return showAuth('signup', error.message, true);
      if (data.session) return enterCloud(data.user);
      return showAuth('login', 'Account creato. Controlla la tua email e clicca il link di conferma, poi accedi.');
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return showAuth('login', error.message === 'Invalid login credentials' ? 'Email o password non corretti.' : error.message, true);
    enterCloud(data.user);
  };
  setTimeout(() => $('#authForm [name=email]')?.focus(), 50);
}
async function resetPassword() {
  const email = (prompt('Inserisci la tua email: riceverai un link per impostare una nuova password') || '').trim();
  if (!email) return;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  showAuth('login', error ? error.message : 'Se l\'email è registrata riceverai a breve il link per reimpostare la password.', !!error);
}
function hideAuth() {
  $('#auth').hidden = true; $('#auth').innerHTML = '';
  document.body.classList.remove('locked');
}

/* ---------- impostazioni: account e staff ---------- */
async function renderCloudSettings(box) {
  box.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>👤 Il tuo account</h3></div>
      <p>${esc(me?.email || '')} <span class="badge ${me?.ruolo === 'admin' ? 'primary' : ''}">${me?.ruolo === 'admin' ? 'Amministratore' : 'Staff'}</span></p>
      <div class="toolbar"><button class="btn" id="chgPw">Cambia password</button><button class="btn danger" id="logout">Esci</button></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>👥 Staff autorizzato</h3></div>
      <div id="staffList" class="small muted">Caricamento…</div>
      ${me?.ruolo === 'admin' ? `
      <div class="form-grid" style="margin-top:10px">
        <label class="field span-2">Email<input type="email" id="stEmail" placeholder="nome@esempio.it"></label>
        <label class="field">Nome<input id="stNome"></label>
        <label class="field">Ruolo<select id="stRuolo"><option value="staff">Staff</option><option value="admin">Amministratore</option></select></label>
        <button class="btn primary" id="stAdd">Autorizza</button>
      </div>
      <p class="small muted">Dopo averla autorizzata, la persona apre l'agenda, sceglie “Primo accesso? Crea l'account” e usa la stessa email.</p>` : '<p class="small muted">Solo un amministratore può aggiungere o rimuovere persone.</p>'}
    </div>`;
  $('#logout').onclick = async () => {
    await syncNow();
    await sb.auth.signOut();
    signedOut();
  };
  $('#chgPw').onclick = async () => {
    const pw = prompt('Nuova password (almeno 8 caratteri)'); if (!pw) return;
    const { error } = await sb.auth.updateUser({ password: pw });
    toast(error ? 'Errore: ' + error.message : 'Password aggiornata');
  };
  const loadStaff = async () => {
    const { data, error } = await sb.from('staff').select('email, nome, ruolo').order('email');
    if (error) { $('#staffList').textContent = 'Errore: ' + error.message; return; }
    $('#staffList').innerHTML = `<table><tbody>${data.map(s => `<tr><td>${esc(s.email)}${s.nome ? `<div class="small muted">${esc(s.nome)}</div>` : ''}</td>
      <td><span class="badge ${s.ruolo === 'admin' ? 'primary' : ''}">${s.ruolo === 'admin' ? 'Admin' : 'Staff'}</span></td>
      <td class="right">${me?.ruolo === 'admin' && s.email !== me.email ? `<button class="btn sm danger" data-rmstaff="${esc(s.email)}">Rimuovi</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
    $$('[data-rmstaff]', box).forEach(b => b.onclick = async () => {
      if (!confirm(`Togliere l'accesso a ${b.dataset.rmstaff}?`)) return;
      const { error: e } = await sb.from('staff').delete().eq('email', b.dataset.rmstaff);
      toast(e ? 'Errore: ' + e.message : 'Accesso rimosso'); loadStaff();
    });
  };
  $('#stAdd')?.addEventListener('click', async () => {
    const email = $('#stEmail').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Email non valida');
    const { error } = await sb.from('staff').upsert({ email, nome: $('#stNome').value.trim(), ruolo: $('#stRuolo').value });
    toast(error ? 'Errore: ' + error.message : 'Persona autorizzata');
    $('#stEmail').value = ''; $('#stNome').value = ''; loadStaff();
  });
  loadStaff();
}

boot();
