-- Turni Ufficio — schema del database condiviso (Supabase / PostgreSQL)
-- Esegui tutto lo script UNA volta: Supabase → SQL Editor → New query → incolla → Run.
-- PRIMA sostituisci in fondo  tua-email@esempio.it  con la tua email (sarai il super user).
-- Può stare nello stesso progetto dell'agenda: tutte le tabelle iniziano con turni_.

-- 1. Account abilitati e livello di accesso
--    user  = visualizza solo l'orario pubblicato
--    admin = visualizza, prepara, genera, modifica e pubblica
--    super = come admin + regole, orari, qualifiche e utenti
create table if not exists public.turni_utenti (
  email      text primary key check (email = lower(email)),
  nome       text,
  livello    text not null default 'user' check (livello in ('user', 'admin', 'super')),
  created_at timestamptz not null default now()
);

-- 2. Dati: un documento JSON per impostazioni, persona, preparazione settimanale, orario settimanale
create table if not exists public.turni_docs (
  id         text primary key,
  kind       text not null check (kind in ('settings', 'persona', 'preparazione', 'settimana')),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  client_id  text
);
create index if not exists turni_docs_kind_idx on public.turni_docs (kind);

-- 3. Livello dell'utente collegato (null = non abilitato)
create or replace function public.turni_livello() returns text
language sql stable security definer set search_path = public as $$
  select livello from public.turni_utenti where email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
revoke execute on function public.turni_livello() from anon;

-- 4. Regole di sicurezza (Row Level Security)
alter table public.turni_utenti enable row level security;
alter table public.turni_docs   enable row level security;

drop policy if exists "utenti: lettura"           on public.turni_utenti;
drop policy if exists "utenti: gestione super"    on public.turni_utenti;
drop policy if exists "docs: lettura"             on public.turni_docs;
drop policy if exists "docs: inserimento"         on public.turni_docs;
drop policy if exists "docs: modifica"            on public.turni_docs;
drop policy if exists "docs: eliminazione"        on public.turni_docs;

-- ognuno vede il proprio account; il super user li vede e gestisce tutti
create policy "utenti: lettura" on public.turni_utenti for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.turni_livello() = 'super');
create policy "utenti: gestione super" on public.turni_utenti for all to authenticated
  using (public.turni_livello() = 'super') with check (public.turni_livello() = 'super');

-- lettura: impostazioni e personale per tutti gli abilitati;
-- orari solo se pubblicati (admin e super vedono anche le bozze);
-- preparazione (ferie, malattie, richieste) solo admin e super
create policy "docs: lettura" on public.turni_docs for select to authenticated using (
  public.turni_livello() is not null and (
    kind in ('settings', 'persona')
    or (kind = 'settimana' and (data ->> 'stato' = 'pubblicata' or public.turni_livello() in ('admin', 'super')))
    or (kind = 'preparazione' and public.turni_livello() in ('admin', 'super'))
  )
);
-- scrittura: impostazioni/regole solo super; il resto admin e super; gli utenti mai
create policy "docs: inserimento" on public.turni_docs for insert to authenticated with check (
  case when kind = 'settings' then public.turni_livello() = 'super' else public.turni_livello() in ('admin', 'super') end
);
create policy "docs: modifica" on public.turni_docs for update to authenticated
  using      (case when kind = 'settings' then public.turni_livello() = 'super' else public.turni_livello() in ('admin', 'super') end)
  with check (case when kind = 'settings' then public.turni_livello() = 'super' else public.turni_livello() in ('admin', 'super') end);
create policy "docs: eliminazione" on public.turni_docs for delete to authenticated using (
  case when kind = 'settings' then public.turni_livello() = 'super' else public.turni_livello() in ('admin', 'super') end
);

-- 5. Aggiornamenti in tempo reale
do $$ begin
  alter publication supabase_realtime add table public.turni_docs;
exception when duplicate_object then null; end $$;

-- 6. Il primo super user (SOSTITUISCI l'email, tutta minuscola)
insert into public.turni_utenti (email, nome, livello)
values ('tua-email@esempio.it', 'Super user', 'super')
on conflict (email) do update set livello = 'super';
