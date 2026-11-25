-- Agenda Ristorante — sincronizzazione automatica con Google Calendar
-- Esegui questo script DOPO schema.sql: Supabase → SQL Editor → New query → incolla → Run.
-- Poi incolla l'"Indirizzo segreto in formato iCal" del calendario Google nell'agenda:
-- Impostazioni → Sincronizzazione Google Calendar (solo amministratori).
--
-- Come funziona: ogni 5 minuti il database scarica il calendario Google e lo salva nella
-- tabella gcal_feed; le agende aperte ricevono l'aggiornamento e creano/aggiornano le prenotazioni.

-- 1. Estensioni: chiamate HTTP dal database e attività pianificate
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- 2. Tabella con l'indirizzo del calendario e l'ultima copia scaricata (una sola riga)
create table if not exists public.gcal_feed (
  id         int primary key default 1 check (id = 1),
  ics_url    text,
  ics        text,
  fetched_at timestamptz,   -- ultima volta in cui il calendario è CAMBIATO
  status     text,
  error      text
);
alter table public.gcal_feed add column if not exists checked_at timestamptz;  -- ultimo controllo
insert into public.gcal_feed (id) values (1) on conflict (id) do nothing;

alter table public.gcal_feed enable row level security;
drop policy if exists "gcal: lettura staff"    on public.gcal_feed;
drop policy if exists "gcal: modifica admin"   on public.gcal_feed;
create policy "gcal: lettura staff"  on public.gcal_feed for select to authenticated using (public.is_staff());
create policy "gcal: modifica admin" on public.gcal_feed for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3. Scarica il calendario (usata dalla pianificazione e dal pulsante "Sincronizza ora")
create or replace function public.gcal_fetch() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  u text;
  r extensions.http_response;
begin
  -- utenti loggati: solo lo staff; la pianificazione (nessun utente) è ammessa
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'non autorizzato';
  end if;
  select ics_url into u from public.gcal_feed where id = 1;
  if u is null or btrim(u) = '' then
    return 'nessun indirizzo configurato';
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
  r := extensions.http_get(btrim(u));
  if r.status = 200 and r.content like 'BEGIN:VCALENDAR%' then
    update public.gcal_feed set ics = r.content, fetched_at = now()
     where id = 1 and ics is distinct from r.content;
    update public.gcal_feed set checked_at = now(), status = 'ok', error = null where id = 1;
    return 'ok';
  end if;
  update public.gcal_feed
     set status = 'errore', error = 'Google ha risposto ' || r.status || ' (controlla l''indirizzo segreto)', checked_at = now()
   where id = 1;
  return 'HTTP ' || r.status;
exception when others then
  update public.gcal_feed set status = 'errore', error = sqlerrm, checked_at = now() where id = 1;
  return sqlerrm;
end $$;
revoke execute on function public.gcal_fetch() from public, anon;
grant execute on function public.gcal_fetch() to authenticated;

-- 4. Pianificazione: ogni 5 minuti
do $$ begin
  perform cron.unschedule('agenda-gcal-sync') where exists (select 1 from cron.job where jobname = 'agenda-gcal-sync');
end $$;
select cron.schedule('agenda-gcal-sync', '*/5 * * * *', $$select public.gcal_fetch()$$);

-- 5. Avvisa in tempo reale le agende aperte quando arriva una nuova versione del calendario
do $$ begin
  alter publication supabase_realtime add table public.gcal_feed;
exception when duplicate_object then null; end $$;
