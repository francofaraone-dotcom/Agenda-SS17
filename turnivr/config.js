/* Configurazione del database condiviso (Supabase) per l'app Turni.
   - Valori vuoti = MODALITÀ LOCALE (dati solo in questo browser, profilo simulabile).
   - Compilati = MULTI-UTENTE con login e livelli di accesso (vedi turni/README.md).
   Si può usare lo stesso progetto Supabase dell'agenda: le tabelle hanno nomi diversi (turni_*). */
window.TURNI_CONFIG = {
  supabaseUrl: '',      // es. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '',  // chiave "anon public"
};
