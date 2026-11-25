/* Turni Ufficio — database condiviso (Supabase) con login e livelli di accesso.
   Attivo solo se config.js è compilato. Ogni elemento è un documento della tabella turni_docs:
   'settings', 'p-<id>' (persona), 'prep-<settimana>' (stati, solo admin), 'w-<settimana>' (orario).
   Le regole di sicurezza del database (supabase/schema.sql) fanno sì che gli Utenti vedano
   solo gli orari pubblicati e non possano scrivere nulla. */
'use strict';
window.Cloud = (() => {
  const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const DOCS = 'turni_docs', USERS = 'turni_utenti';
  const CLIENT_ID = uid();
  let sb = null, channel = null, timer = null, busy = false, again = false, pendingRemote = false;
  const synced = new Map(); // id -> contenuto presente sul server (stringa stabile)

  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v ?? null);
  }
  const kindOf = id => id === 'settings' ? 'settings' : id.startsWith('p-') ? 'persona' : id.startsWith('prep-') ? 'preparazione' : id.startsWith('w-') ? 'settimana' : null;
  function docs(s) {
    const m = new Map();
    m.set('settings', s.settings);
    for (const p of s.persone) m.set('p-' + p.id, p);
    for (const [k, v] of Object.entries(s.settimane)) m.set(k, v);
    for (const [k, v] of Object.entries(s.prep)) m.set(k, v);
    return m;
  }
  function apply(id, data) {
    switch (kindOf(id)) {
      case 'settings': if (data) state.settings = migraSettings(data); break;
      case 'persona': {
        const i = state.persone.findIndex(p => 'p-' + p.id === id);
        if (!data) { if (i >= 0) state.persone.splice(i, 1); } else if (i >= 0) state.persone[i] = data; else state.persone.push(data);
        break;
      }
      case 'settimana': if (data) state.settimane[id] = data; else delete state.settimane[id]; break;
      case 'preparazione': if (data) state.prep[id] = data; else delete state.prep[id]; break;
    }
  }
  function setSync(st, msg = '') {
    const el = $('#syncState');
    const map = { ok: ['ok', '● Sincronizzato'], saving: ['warn', '● Salvataggio…'], error: ['danger', '⚠ Non salvato'] };
    const [cls, label] = map[st]; el.className = 'badge ' + cls; el.textContent = label; el.title = msg; el.hidden = false;
  }
  function loadScript(src) {
    return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Impossibile caricare ' + src)); document.head.appendChild(s); });
  }

  /* ---------- salvataggio: invia solo i documenti cambiati ---------- */
  function sync() { if (!can('admin')) return; setSync('saving'); clearTimeout(timer); timer = setTimeout(flush, 400); }
  async function flush() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const cur = docs(state); const up = []; const del = [];
      for (const [id, data] of cur) {
        if (id === 'settings' && !can('super')) continue;
        const s = stable(data);
        if (synced.get(id) !== s) up.push({ row: { id, kind: kindOf(id), data, updated_at: new Date().toISOString(), updated_by: me.email, client_id: CLIENT_ID }, s });
      }
      for (const id of synced.keys()) if (!cur.has(id)) del.push(id);
      if (up.length) {
        const { error } = await sb.from(DOCS).upsert(up.map(u => u.row)); if (error) throw error;
        up.forEach(u => synced.set(u.row.id, u.s));
      }
      if (del.length) {
        const { error } = await sb.from(DOCS).delete().in('id', del); if (error) throw error;
        del.forEach(id => synced.delete(id));
      }
      setSync('ok');
    } catch (e) { console.error(e); setSync('error', e.message); clearTimeout(timer); timer = setTimeout(flush, 5000); }
    finally { busy = false; if (again) { again = false; flush(); } }
  }

  /* ---------- tempo reale ---------- */
  function subscribe() {
    channel = sb.channel('turni-docs').on('postgres_changes', { event: '*', schema: 'public', table: DOCS }, payload => {
      const row = payload.new && payload.new.id ? payload.new : null;
      const id = row ? row.id : payload.old?.id;
      if (!id || (row && row.client_id === CLIENT_ID)) return;
      if (payload.eventType === 'DELETE') { synced.delete(id); apply(id, null); }
      else { synced.set(id, stable(row.data)); apply(id, row.data); }
      identifica();
      if (modalOpen()) pendingRemote = true; else render();
    }).subscribe();
    // gli utenti non ricevono eventi quando un orario torna in bozza: ricarica quando la pagina torna in primo piano
    document.addEventListener('visibilitychange', () => { if (!document.hidden && me.email) reload(); });
  }
  function onModalClosed() { if (pendingRemote) { pendingRemote = false; render(); } }

  async function fetchAll() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(DOCS).select('id, data').range(from, from + 999);
      if (error) throw error;
      rows.push(...data); if (data.length < 1000) break;
    }
    return rows;
  }
  async function reload() {
    try {
      const rows = await fetchAll();
      const keepSettings = state.settings;
      state = { settings: keepSettings, persone: [], settimane: {}, prep: {} };
      synced.clear();
      for (const r of rows) { synced.set(r.id, stable(r.data)); apply(r.id, r.data); }
      identifica(); if (!modalOpen()) render();
    } catch (e) { console.warn(e); }
  }

  /* ---------- avvio e login ---------- */
  async function boot() {
    showAuth('loading');
    try {
      if (!window.supabase) await loadScript(CDN);
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
    } catch (e) { return showAuth('error', 'Connessione al database non riuscita: ' + e.message); }
    sb.auth.onAuthStateChange(ev => {
      if (ev === 'PASSWORD_RECOVERY') showAuth('newpass');
      if (ev === 'SIGNED_OUT') { me = { email: '', livello: 'user', personaId: null }; state = null; showAuth('login'); }
    });
    if (location.hash.includes('type=recovery')) return showAuth('newpass');
    const { data } = await sb.auth.getSession();
    if (data.session) await enter(data.session.user); else showAuth('login');
  }

  async function enter(user) {
    showAuth('loading', 'Caricamento…');
    const { data: liv, error } = await sb.rpc('turni_livello');
    if (error) return showAuth('error', 'Errore di accesso: ' + error.message + '. Hai eseguito turni/supabase/schema.sql?');
    if (!liv) { await sb.auth.signOut(); return showAuth('login', `L'account ${user.email} non è abilitato. Chiedi al super user di aggiungerti.`, true); }
    me = { email: user.email.toLowerCase(), livello: liv, personaId: null };
    let rows;
    try { rows = await fetchAll(); } catch (e) { return showAuth('error', 'Lettura dati non riuscita: ' + e.message); }
    state = { settings: null, persone: [], settimane: {}, prep: {} };
    synced.clear();
    for (const r of rows) { synced.set(r.id, stable(r.data)); apply(r.id, r.data); }
    if (!state.settings) {
      if (liv === 'super') return showAuth('setup');
      return showAuth('error', 'L\'app non è ancora stata configurata dal super user.');
    }
    start();
  }
  function start() {
    identifica(); subscribe(); hideAuth(); setSync('ok'); render();
  }

  function showAuth(mode, msg = '', isError = false) {
    const box = $('#auth'); box.hidden = false;
    const m = msg ? `<div class="msg ${isError ? 'err' : ''}">${esc(msg)}</div>` : '';
    const head = '<div style="font-size:40px">🗓️</div><h2>Turni Ufficio</h2>';
    const forms = {
      loading: `${head}<p class="muted">${esc(msg || 'Connessione…')}</p>`,
      error: `${head}<div class="msg err">${esc(msg)}</div><button class="btn" onclick="location.reload()">Riprova</button>`,
      login: `${head}<p class="muted">Accesso riservato</p>${m}<form id="af">
          <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="username"></div>
          <div class="field"><label>Password</label><input type="password" name="pw" required autocomplete="current-password"></div>
          <button class="btn primary full">Accedi</button></form>
        <div class="auth-links"><a href="#" data-m="signup">Primo accesso? Crea l'account</a><a href="#" data-m="reset">Password dimenticata</a></div>`,
      signup: `${head}<p class="muted">Crea l'account con l'email abilitata dal super user</p>${m}<form id="af">
          <div class="field"><label>Email</label><input type="email" name="email" required></div>
          <div class="field"><label>Password (min. 8 caratteri)</label><input type="password" name="pw" minlength="8" required autocomplete="new-password"></div>
          <button class="btn primary full">Crea account</button></form><div class="auth-links"><a href="#" data-m="login">Ho già un account</a></div>`,
      newpass: `${head}<p class="muted">Scegli una nuova password</p>${m}<form id="af">
          <div class="field"><label>Nuova password</label><input type="password" name="pw" minlength="8" required></div>
          <button class="btn primary full">Salva</button></form>`,
      setup: `${head}<p>Il database è vuoto. Come vuoi iniziare?</p>
          <button class="btn primary full" data-setup="demo">Configurazione predefinita + dati demo</button>
          <button class="btn full" data-setup="vuoto">Configurazione predefinita, senza personale</button>`,
    };
    box.innerHTML = `<div class="auth-card">${forms[mode]}</div>`;
    $$('[data-m]', box).forEach(a => a.onclick = ev => { ev.preventDefault(); a.dataset.m === 'reset' ? resetPw() : showAuth(a.dataset.m); });
    $$('[data-setup]', box).forEach(b => b.onclick = () => { state = b.dataset.setup === 'demo' ? demoState() : statoVuoto(); start(); flush(); });
    const f = $('#af', box); if (!f) return;
    f.onsubmit = async ev => {
      ev.preventDefault();
      const email = f.email?.value.trim().toLowerCase(), pw = f.pw.value;
      if (mode === 'newpass') {
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) return showAuth('newpass', error.message, true);
        history.replaceState(null, '', location.pathname);
        const { data } = await sb.auth.getUser(); return enter(data.user);
      }
      if (mode === 'signup') {
        const { error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) return showAuth('signup', error.message, true);
        return showAuth('login', 'Account creato. Conferma dal link ricevuto via email, poi accedi.');
      }
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) return showAuth('login', error.message === 'Invalid login credentials' ? 'Email o password non corretti.' : error.message, true);
      enter(data.user);
    };
  }
  async function resetPw() {
    const email = prompt('La tua email:'); if (!email) return;
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    showAuth('login', error ? error.message : 'Se l\'email è registrata riceverai il link per reimpostare la password.', !!error);
  }
  function hideAuth() { $('#auth').hidden = true; }

  /* ---------- gestione utenti (solo super user) ---------- */
  async function listUtenti() { const { data, error } = await sb.from(USERS).select('email, nome, livello').order('email'); if (error) throw error; return data; }
  async function saveUtente(u) {
    const row = { ...u }; if (row.nome === undefined) delete row.nome;
    const { error } = await sb.from(USERS).upsert(row, { onConflict: 'email' }); if (error) throw error;
  }
  async function deleteUtente(email) { const { error } = await sb.from(USERS).delete().eq('email', email); if (error) throw error; }
  async function logout() { if (channel) sb.removeChannel(channel); await sb.auth.signOut(); }

  return { boot, sync, onModalClosed, listUtenti, saveUtente, deleteUtente, logout };
})();
