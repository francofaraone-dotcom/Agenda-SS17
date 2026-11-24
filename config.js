/* Configurazione del database condiviso (Supabase).
   - Lasciando i due valori vuoti l'app funziona in MODALITÀ LOCALE (dati solo in questo browser).
   - Compilandoli l'app diventa MULTI-UTENTE con login: vedi README, sezione "Database condiviso".
   La chiave "anon public" è pensata per stare nel codice della pagina: i dati restano protetti
   dalle regole di sicurezza (Row Level Security) definite in supabase/schema.sql. */
window.AGENDA_CONFIG = {
  supabaseUrl: '',      // es. 'https://abcdefghijkl.supabase.co'  (Project Settings → API → Project URL)
  supabaseAnonKey: '',  // es. 'eyJhbGciOi...'                     (Project Settings → API → anon public)
};
