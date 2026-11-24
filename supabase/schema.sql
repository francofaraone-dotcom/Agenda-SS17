-- Agenda Ristorante — schema del database condiviso (Supabase / PostgreSQL)
-- Esegui tutto questo script UNA volta in Supabase: SQL Editor → New query → incolla → Run.
-- PRIMA di eseguirlo sostituisci in fondo  TUA-EMAIL@esempio.it  con la tua email (sarai l'amministratore).

-- 1. Elenco delle persone autorizzate (solo queste email possono vedere e modificare l'agenda)
create table if not exists public.staff (
  email      text primary key check (email = lower(email)),
  nome       text,
  ruolo      text not null default 'staff' check (ruolo in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

-- 2. Dati dell'agenda: un documento JSON per ogni prenotazione, piatto, menu, servizio, sala, chiusura + impostazioni
create table if not exists public.agenda_docs (
  id         text primary key,
  kind       text not null check (kind in ('settings', 'prenotazione', 'piatto', 'menu', 'servizio', 'sala', 'chiusura')),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  client_id  text
);
create index if not exists agenda_docs_kind_idx on public.agenda_docs (kind);

-- 3. Funzioni di controllo accesso
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where email = lower(coalesce(auth.jwt() ->> 'email', '')) and ruolo = 'admin');
$$;
revoke execute on function public.is_staff() from anon;
revoke execute on function public.is_admin() from anon;

-- 4. Regole di sicurezza (Row Level Security): senza login o fuori dallo staff non si vede nulla
alter table public.staff       enable row level security;
alter table public.agenda_docs enable row level security;

drop policy if exists "staff: lettura per lo staff"   on public.staff;
drop policy if exists "staff: gestione per admin"     on public.staff;
drop policy if exists "docs: accesso completo staff"  on public.agenda_docs;

create policy "staff: lettura per lo staff" on public.staff
  for select to authenticated using (public.is_staff());
create policy "staff: gestione per admin" on public.staff
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "docs: accesso completo staff" on public.agenda_docs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 5. Aggiornamenti in tempo reale tra i dispositivi
do $$ begin
  alter publication supabase_realtime add table public.agenda_docs;
exception when duplicate_object then null; end $$;

-- 6. Il primo amministratore (SOSTITUISCI l'email, tutta minuscola)
insert into public.staff (email, nome, ruolo)
values ('TUA-EMAIL@esempio.it', 'Titolare', 'admin')
on conflict (email) do update set ruolo = 'admin';
