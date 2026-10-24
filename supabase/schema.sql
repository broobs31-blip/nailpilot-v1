-- NailPilot V2 — Lot 1 bootstrap schema (F1..F12, R1..R8). See docs/ARCHITECTURE.md.
-- Apply ONLY to a NEW, dedicated NailPilot preview project (PostgreSQL >= 15).
-- Not yet applied anywhere. Reviewed bootstrap script, not migration history.
--
-- Security model
--   * Every table has RLS; authenticated pros only see rows where owner_id = auth.uid().
--   * anon has NO table privilege. It may only execute three SECURITY DEFINER functions:
--     np_public_page, np_available_slots, np_request_booking. They return public profile
--     data, free start times, or the requester's own booking summary — never other clients.
--   * Supabase grants anon/authenticated on new objects by default: every object below is
--     revoked first, then granted explicitly.
--
-- Scheduling model (R1, R8)
--   * Service time = [starts_at, ends_at); ends_at = starts_at + duration_min (trigger-derived).
--   * Blocked time  = [block_start, block_end) = service time widened by buffer_before/after.
--   * Two live appointments A, B conflict iff A.block && B.service or A.service && B.block.
--     This yields gap(A,B) >= max(A.after, B.before) — buffers never stack (R1, bullet 3).
--   * Hard backstop: GiST exclusion on service time. Buffer rule: trigger under a per-owner
--     advisory lock (race-free in READ COMMITTED). Both raise SQLSTATE 23P01.
--
-- Custom SQLSTATEs raised by public functions: NP404 not found, NP403 location/zone refused,
-- NP409 slot no longer available, NP422 invalid input, NP429 rate limited.
begin;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.np_normalize_phone(p_phone text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := regexp_replace(coalesce(p_phone, ''), '[[:space:].()-]', '', 'g');
begin
  v := regexp_replace(v, '^00', '+');
  if v = '' then return ''; end if;
  if v ~ '^0[1-9][0-9]{8}$' then return '+33' || substr(v, 2); end if;
  if v ~ '^\+[1-9][0-9]{7,14}$' then return v; end if;
  raise exception using errcode = 'NP422', message = 'Téléphone invalide.';
end;
$$;

create function public.np_stamp_update() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pro profile (private) and public page (F2)
-- ---------------------------------------------------------------------------
create table public.np_profiles (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  trades text[] not null default '{}' check (trades <@ array['nails','hair','makeup']::text[]),
  work_mode text not null default 'home_studio' check (work_mode in ('home_studio','mobile','both')),
  base_address_line text not null default '' check (length(base_address_line) <= 200),
  base_postal_code text not null default '' check (base_postal_code = '' or base_postal_code ~ '^[0-9]{5}$'),
  base_city text not null default '' check (length(base_city) <= 80),
  base_access_info text not null default '' check (length(base_access_info) <= 300),
  zone_postal_codes text[] not null default '{}' check (cardinality(zone_postal_codes) <= 200 and array_to_string(zone_postal_codes, ',') ~ '^([0-9]{5}(,[0-9]{5})*)?$'),
  zone_radius_km integer check (zone_radius_km between 1 and 200),
  travel_buffer_min integer not null default 30 check (travel_buffer_min between 0 and 120),
  min_notice_min integer not null default 720 check (min_notice_min between 0 and 10080),
  max_horizon_days integer not null default 60 check (max_horizon_days between 7 and 366),
  slot_step_min integer not null default 30 check (slot_step_min in (15, 30, 60)),
  auto_confirm boolean not null default false,
  -- Empty template = use DEFAULT_TEMPLATES from src/domain.js.
  template_confirmation text not null default '' check (length(template_confirmation) <= 1000),
  template_decline text not null default '' check (length(template_decline) <= 1000),
  template_reminder text not null default '' check (length(template_reminder) <= 1000),
  template_refill text not null default '' check (length(template_refill) <= 1000),
  onboarded_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (onboarded_at is null or cardinality(trades) > 0),
  check (onboarded_at is null or work_mode = 'mobile' or (base_address_line <> '' and base_postal_code <> '' and base_city <> ''))
);

create table public.np_public_profiles (
  owner_id uuid primary key default auth.uid() references public.np_profiles(owner_id) on delete cascade,
  slug text not null unique check (
    slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and slug !~ '--'
    and slug <> all (array['admin','api','app','auth','login','logout','signup','inscription','connexion','reset',
      'www','mail','support','aide','help','static','assets','public','nailpilot','confidentialite',
      'mentions-legales','cgu','agenda','clientes','reglages','demandes'])),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  city text not null default '' check (length(city) <= 80),
  bio text not null default '' check (length(bio) <= 300),
  instagram text not null default '' check (instagram = '' or instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Opening hours and closures (F3). Minutes from local midnight, Europe/Paris.
-- ---------------------------------------------------------------------------
create table public.np_opening_hours (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekday integer not null check (weekday between 1 and 7), -- ISO: 1 = lundi
  start_min integer not null check (start_min between 0 and 1435),
  end_min integer not null check (end_min between 5 and 1440),
  check (end_min > start_min and start_min % 5 = 0 and end_min % 5 = 0),
  exclude using gist (owner_id with =, weekday with =, int4range(start_min, end_min) with &&)
);
create index np_opening_hours_owner_idx on public.np_opening_hours(owner_id, weekday);

create table public.np_closures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (length(reason) <= 120),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '366 days')
);
create index np_closures_owner_idx on public.np_closures(owner_id, starts_at);

-- ---------------------------------------------------------------------------
-- Service catalogue (F4)
-- ---------------------------------------------------------------------------
create table public.np_services (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trade text check (trade in ('nails','hair','makeup')),
  name text not null check (length(btrim(name)) between 1 and 80),
  category text not null default '' check (length(category) <= 40),
  description text not null default '' check (length(description) <= 300),
  duration_min integer not null check (duration_min between 15 and 480 and duration_min % 5 = 0),
  price_cents integer check (price_cents between 0 and 200000), -- null = « sur devis »
  allowed_locations text not null default 'both' check (allowed_locations in ('pro','client','both')),
  online boolean not null default true,
  prep_min integer not null default 10 check (prep_min between 0 and 60),
  refill_enabled boolean not null default true,
  refill_days integer check (refill_days between 7 and 90), -- null = client's own delay
  position integer not null default 0 check (position >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index np_services_owner_idx on public.np_services(owner_id, archived, position);

-- ---------------------------------------------------------------------------
-- Clients (F7) and their intervention addresses
-- ---------------------------------------------------------------------------
create table public.np_clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  preferred_name text not null default '' check (length(preferred_name) <= 60),
  phone text not null default '' check (phone = '' or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text not null default '' check (length(email) <= 254 and (email = '' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  notes text not null default '' check (length(notes) <= 2000),
  source text not null default 'manual' check (source in ('manual','instagram','referral','online','other')),
  refill_days integer not null default 21 check (refill_days between 7 and 90),
  reminder_opt_in boolean not null default false,
  refill_opt_in boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index np_clients_owner_idx on public.np_clients(owner_id, archived);
create index np_clients_phone_idx on public.np_clients(owner_id, phone) where phone <> '';

create table public.np_client_addresses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null,
  label text not null default '' check (length(label) <= 40),
  address_line text not null check (length(btrim(address_line)) between 1 and 200),
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  city text not null check (length(btrim(city)) between 1 and 80),
  access_info text not null default '' check (length(access_info) <= 300),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, owner_id) references public.np_clients(id, owner_id) on delete cascade
);
create unique index np_client_addresses_primary_idx on public.np_client_addresses(client_id) where is_primary;
create index np_client_addresses_client_idx on public.np_client_addresses(client_id, owner_id);

-- Consent journal (F12). Written only by trigger on np_clients.
create table public.np_consents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  kind text not null check (kind in ('reminders','refills')),
  granted boolean not null,
  source text not null check (source in ('pro','online_form')),
  recorded_at timestamptz not null default now(),
  foreign key (client_id, owner_id) references public.np_clients(id, owner_id) on delete cascade
);
create index np_consents_client_idx on public.np_consents(client_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Appointments (F5, F6, F9) — snapshots of service name/duration/price (R8)
-- ---------------------------------------------------------------------------
create table public.np_appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid, -- null only once anonymized (client deleted, F12)
  service_id uuid,
  service_name text not null check (length(btrim(service_name)) between 1 and 80),
  duration_min integer not null check (duration_min between 5 and 480),
  price_cents integer check (price_cents between 0 and 200000),
  refill_enabled boolean not null default true,
  refill_days integer check (refill_days between 7 and 90),
  location_type text not null default 'pro' check (location_type in ('pro','client')),
  address_line text not null default '' check (length(address_line) <= 200),
  postal_code text not null default '' check (postal_code = '' or postal_code ~ '^[0-9]{5}$'),
  city text not null default '' check (length(city) <= 80),
  access_info text not null default '' check (length(access_info) <= 300),
  buffer_before_min integer not null default 0 check (buffer_before_min between 0 and 120),
  buffer_after_min integer not null default 0 check (buffer_after_min between 0 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,    -- derived: starts_at + duration_min
  block_start timestamptz not null, -- derived: starts_at - buffer_before_min
  block_end timestamptz not null,   -- derived: ends_at + buffer_after_min
  status text not null default 'booked' check (status in ('pending','booked','done','cancelled','no_show')),
  source text not null default 'pro' check (source in ('pro','online')),
  client_message text not null default '' check (length(client_message) <= 300),
  cancel_reason text not null default '' check (length(cancel_reason) <= 300),
  expires_at timestamptz,
  expired boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and block_start <= starts_at and block_end >= ends_at),
  check (status <> 'pending' or expires_at is not null),
  check (client_id is not null or anonymized_at is not null),
  check (location_type = 'pro' or anonymized_at is not null or (address_line <> '' and postal_code <> '' and city <> '')),
  foreign key (client_id, owner_id) references public.np_clients(id, owner_id),
  foreign key (service_id, owner_id) references public.np_services(id, owner_id) on delete set null (service_id),
  unique (id, owner_id),
  exclude using gist (owner_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('pending','booked','done','no_show'))
);
create index np_appointments_owner_block_idx on public.np_appointments(owner_id, block_start);
create index np_appointments_client_idx on public.np_appointments(client_id, owner_id, ends_at desc);
create index np_appointments_pending_idx on public.np_appointments(owner_id, expires_at) where status = 'pending';

-- In-app suggestions only. Nothing here sends SMS or e-mail.
create table public.np_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid,
  appointment_id uuid not null,
  kind text not null check (kind in ('reminder','refill','confirmation','new_request','request_expired')),
  due_at timestamptz not null,
  reference_at timestamptz not null,
  status text not null default 'ready' check (status in ('ready','dismissed','invalidated')),
  created_at timestamptz not null default now(),
  foreign key (client_id, owner_id) references public.np_clients(id, owner_id) on delete cascade,
  foreign key (appointment_id, owner_id) references public.np_appointments(id, owner_id) on delete cascade,
  unique (appointment_id, kind)
);
create index np_notifications_owner_due_idx on public.np_notifications(owner_id, status, due_at);

-- Rate-limit ledger for public booking (R5, F8). No client access at all.
create table public.np_booking_attempts (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  phone_key text not null,
  ip_key text,
  created_at timestamptz not null default now()
);
create index np_booking_attempts_phone_idx on public.np_booking_attempts(phone_key, created_at);
create index np_booking_attempts_ip_idx on public.np_booking_attempts(ip_key, created_at) where ip_key is not null;
create index np_booking_attempts_owner_idx on public.np_booking_attempts(owner_id, created_at);

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.np_profiles enable row level security;
alter table public.np_public_profiles enable row level security;
alter table public.np_opening_hours enable row level security;
alter table public.np_closures enable row level security;
alter table public.np_services enable row level security;
alter table public.np_clients enable row level security;
alter table public.np_client_addresses enable row level security;
alter table public.np_consents enable row level security;
alter table public.np_appointments enable row level security;
alter table public.np_notifications enable row level security;
alter table public.np_booking_attempts enable row level security;

revoke all on public.np_profiles, public.np_public_profiles, public.np_opening_hours, public.np_closures,
  public.np_services, public.np_clients, public.np_client_addresses, public.np_consents,
  public.np_appointments, public.np_notifications, public.np_booking_attempts from public, anon, authenticated;
-- Supabase default privileges also grant sequences to anon/authenticated.
revoke all on sequence public.np_booking_attempts_id_seq from public, anon, authenticated;

grant select, insert, update on public.np_profiles, public.np_public_profiles to authenticated;
grant select, insert, update, delete on public.np_opening_hours, public.np_closures, public.np_services,
  public.np_clients, public.np_client_addresses to authenticated;
grant select on public.np_consents to authenticated;
grant select, insert on public.np_appointments to authenticated;
grant update (client_id, service_id, service_name, duration_min, price_cents, refill_enabled, refill_days,
  location_type, address_line, postal_code, city, access_info, buffer_before_min, buffer_after_min,
  starts_at, status, cancel_reason) on public.np_appointments to authenticated;
grant select, insert on public.np_notifications to authenticated;
grant update (status, due_at, reference_at) on public.np_notifications to authenticated;
grant all on public.np_profiles, public.np_public_profiles, public.np_opening_hours, public.np_closures,
  public.np_services, public.np_clients, public.np_client_addresses, public.np_consents,
  public.np_appointments, public.np_notifications, public.np_booking_attempts to service_role;

create policy np_profiles_select on public.np_profiles for select to authenticated using (owner_id = (select auth.uid()));
create policy np_profiles_insert on public.np_profiles for insert to authenticated with check (owner_id = (select auth.uid()));
create policy np_profiles_update on public.np_profiles for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy np_public_profiles_select on public.np_public_profiles for select to authenticated using (owner_id = (select auth.uid()));
create policy np_public_profiles_insert on public.np_public_profiles for insert to authenticated with check (owner_id = (select auth.uid()));
create policy np_public_profiles_update on public.np_public_profiles for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy np_consents_select on public.np_consents for select to authenticated using (owner_id = (select auth.uid()));
create policy np_appointments_select on public.np_appointments for select to authenticated using (owner_id = (select auth.uid()));
create policy np_appointments_insert on public.np_appointments for insert to authenticated with check (owner_id = (select auth.uid()));
create policy np_appointments_update on public.np_appointments for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy np_notifications_select on public.np_notifications for select to authenticated using (owner_id = (select auth.uid()));
create policy np_notifications_insert on public.np_notifications for insert to authenticated with check (owner_id = (select auth.uid()));
create policy np_notifications_update on public.np_notifications for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
do $$
declare t text;
begin
  foreach t in array array['np_opening_hours','np_closures','np_services','np_clients','np_client_addresses'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (owner_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger np_profiles_stamp before update on public.np_profiles for each row execute function public.np_stamp_update();
create trigger np_public_profiles_stamp before update on public.np_public_profiles for each row execute function public.np_stamp_update();
create trigger np_services_stamp before update on public.np_services for each row execute function public.np_stamp_update();
create trigger np_clients_stamp before update on public.np_clients for each row execute function public.np_stamp_update();
create trigger np_client_addresses_stamp before update on public.np_client_addresses for each row execute function public.np_stamp_update();
create trigger np_appointments_stamp before update on public.np_appointments for each row execute function public.np_stamp_update();

-- F3: at most 3 opening ranges per weekday.
create function public.np_opening_hours_guard() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.np_opening_hours h where h.owner_id = new.owner_id and h.weekday = new.weekday and h.id <> new.id) >= 3 then
    raise exception using errcode = 'NP422', message = 'Trois plages horaires maximum par jour.';
  end if;
  return new;
end;
$$;
create trigger np_opening_hours_guard before insert or update on public.np_opening_hours for each row execute function public.np_opening_hours_guard();

-- Archiving a client with upcoming bookings or requests is refused (V1 rule, extended to pending).
create function public.np_client_archive_guard() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.archived and not old.archived and exists (
    select 1 from public.np_appointments a where a.client_id = new.id and a.status in ('booked','pending') and a.ends_at > now()
  ) then
    raise exception 'Annulez les rendez-vous à venir avant d’archiver cette cliente.';
  end if;
  return new;
end;
$$;
create trigger np_clients_archive_guard before update of archived on public.np_clients for each row execute function public.np_client_archive_guard();

-- F12 consent journal. Source comes from the transaction setting np.consent_source.
create function public.np_log_consent() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_source text := coalesce(nullif(current_setting('np.consent_source', true), ''), 'pro');
begin
  if tg_op = 'INSERT' or new.reminder_opt_in is distinct from old.reminder_opt_in then
    insert into public.np_consents(owner_id, client_id, kind, granted, source) values (new.owner_id, new.id, 'reminders', new.reminder_opt_in, v_source);
  end if;
  if tg_op = 'INSERT' or new.refill_opt_in is distinct from old.refill_opt_in then
    insert into public.np_consents(owner_id, client_id, kind, granted, source) values (new.owner_id, new.id, 'refills', new.refill_opt_in, v_source);
  end if;
  return null;
end;
$$;
create trigger np_clients_consent_log after insert or update of reminder_opt_in, refill_opt_in on public.np_clients for each row execute function public.np_log_consent();

-- R5: expire pending requests. An authenticated caller is always narrowed to her own rows;
-- p_owner = null (service_role / cron) sweeps every account.
create function public.np_expire_pending(p_owner uuid default null, p_except uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if (select auth.uid()) is not null then p_owner := (select auth.uid()); end if;
  perform set_config('np.sweeping', 'on', true);
  update public.np_appointments a set status = 'cancelled', expired = true, cancel_reason = 'Demande expirée'
  where a.status = 'pending' and a.expires_at <= now()
    and (p_owner is null or a.owner_id = p_owner)
    and (p_except is null or a.id <> p_except);
  get diagnostics v_count = row_count;
  perform set_config('np.sweeping', '', true);
  return v_count;
end;
$$;

-- Core appointment rules (R1, R6, R8): derived times, transitions, buffer-aware conflicts.
create function public.np_appointment_rules() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_min);
  new.block_start := new.starts_at - make_interval(mins => new.buffer_before_min);
  new.block_end := new.ends_at + make_interval(mins => new.buffer_after_min);
  if new.status <> 'pending' then new.expires_at := null; end if;

  if tg_op = 'INSERT' then
    if new.status = 'pending' and new.source <> 'online' then
      raise exception using errcode = 'NP422', message = 'Seule une réservation en ligne peut être en attente.';
    end if;
  else
    new.source := old.source;
    new.expired := new.expired or old.expired;
    if old.status in ('done','no_show') and new.status = 'cancelled' then
      raise exception using errcode = 'NP422', message = 'Un rendez-vous terminé ou non honoré ne peut plus être annulé.';
    end if;
    if new.status = 'pending' and old.status <> 'pending' then
      raise exception using errcode = 'NP422', message = 'Statut invalide.';
    end if;
    if old.status = 'pending' and new.status <> 'pending' and old.expires_at <= now() and not new.expired then
      raise exception using errcode = 'NP422', message = 'Cette demande a expiré.';
    end if;
    if old.starts_at < now() and (new.starts_at <> old.starts_at or new.duration_min <> old.duration_min) then
      raise exception using errcode = 'NP422', message = 'Un rendez-vous passé ne peut pas être déplacé.';
    end if;
  end if;
  if new.status = 'no_show' and new.starts_at > now() then
    raise exception using errcode = 'NP422', message = 'Une absence ne peut être notée qu’après l’heure du rendez-vous.';
  end if;

  if new.client_id is not null and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    perform 1 from public.np_clients c where c.id = new.client_id and c.owner_id = new.owner_id and not c.archived for update;
    if not found then raise exception 'Cliente introuvable ou archivée.'; end if;
  end if;

  if new.status in ('pending','booked','done','no_show') and (tg_op = 'INSERT'
      or new.status is distinct from old.status or new.block_start <> old.block_start or new.block_end <> old.block_end) then
    perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
    -- Expired requests must not block (GiST included). Skipped while a sweep is running.
    if coalesce(current_setting('np.sweeping', true), '') <> 'on' then
      perform public.np_expire_pending(new.owner_id, new.id);
    end if;
    if exists (
      select 1 from public.np_appointments a
      where a.owner_id = new.owner_id and a.id <> new.id
        and (a.status in ('booked','done','no_show') or (a.status = 'pending' and a.expires_at > now()))
        and (tstzrange(new.block_start, new.block_end, '[)') && tstzrange(a.starts_at, a.ends_at, '[)')
          or tstzrange(new.starts_at, new.ends_at, '[)') && tstzrange(a.block_start, a.block_end, '[)'))
    ) then
      raise exception using errcode = '23P01', message = 'Ce créneau chevauche un rendez-vous existant (trajet ou préparation compris).';
    end if;
  end if;
  return new;
end;
$$;
create trigger np_appointments_rules before insert or update on public.np_appointments for each row execute function public.np_appointment_rules();

-- Lifecycle notifications for online bookings (F9).
create function public.np_appointment_events() returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_kind text;
begin
  if new.source <> 'online' or new.client_id is null then return null; end if;
  if tg_op = 'INSERT' then
    insert into public.np_notifications(owner_id, client_id, appointment_id, kind, due_at, reference_at)
    values (new.owner_id, new.client_id, new.id, 'new_request', now(), new.starts_at) on conflict (appointment_id, kind) do nothing;
    if new.status = 'booked' then v_kind := 'confirmation'; end if;
  elsif old.status = 'pending' and new.status = 'booked' then v_kind := 'confirmation';
  elsif old.status = 'pending' and new.status = 'cancelled' then
    v_kind := case when new.expired then 'request_expired' else 'confirmation' end;
  end if;
  if v_kind is not null then
    insert into public.np_notifications(owner_id, client_id, appointment_id, kind, due_at, reference_at)
    values (new.owner_id, new.client_id, new.id, v_kind, now(), new.starts_at)
    on conflict (appointment_id, kind) do update set status = 'ready', due_at = excluded.due_at, reference_at = excluded.reference_at;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pending' and new.status <> 'pending' then
    update public.np_notifications n set status = 'dismissed' where n.appointment_id = new.id and n.kind = 'new_request' and n.status = 'ready';
  end if;
  return null;
end;
$$;
create trigger np_appointments_events after insert or update of status on public.np_appointments for each row execute function public.np_appointment_events();

revoke all on function public.np_normalize_phone(text), public.np_stamp_update(), public.np_opening_hours_guard(),
  public.np_client_archive_guard(), public.np_log_consent(), public.np_appointment_rules(),
  public.np_appointment_events() from public, anon, authenticated;
revoke all on function public.np_expire_pending(uuid, uuid) from public, anon;
grant execute on function public.np_expire_pending(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reminders and refills (F10, F11) — V1 engine, generalised
-- ---------------------------------------------------------------------------
create view public.np_due_notifications with (security_invoker = true) as
select a.owner_id, a.client_id, a.id as appointment_id, 'reminder'::text as kind,
  a.starts_at - interval '24 hours' as due_at, a.starts_at as reference_at
from public.np_appointments a join public.np_clients c on c.id = a.client_id and c.owner_id = a.owner_id
where not c.archived and c.reminder_opt_in and a.status = 'booked' and a.starts_at > now() and a.starts_at - interval '24 hours' <= now()
union all
select a.owner_id, a.client_id, a.id, 'refill'::text,
  ((a.ends_at at time zone 'Europe/Paris') + make_interval(days => coalesce(a.refill_days, c.refill_days))) at time zone 'Europe/Paris', a.ends_at
from public.np_appointments a join public.np_clients c on c.id = a.client_id and c.owner_id = a.owner_id
where not c.archived and c.refill_opt_in and a.refill_enabled and a.status = 'done' and a.ends_at <= now()
  and ((a.ends_at at time zone 'Europe/Paris') + make_interval(days => coalesce(a.refill_days, c.refill_days))) at time zone 'Europe/Paris' <= now()
  and not exists (select 1 from public.np_appointments newer where newer.client_id = a.client_id and newer.owner_id = a.owner_id and newer.status = 'done' and newer.ends_at <= now() and (newer.ends_at, newer.id) > (a.ends_at, a.id))
  and not exists (select 1 from public.np_appointments future where future.client_id = a.client_id and future.owner_id = a.owner_id and future.status in ('booked','pending') and future.ends_at > now());
revoke all on public.np_due_notifications from public, anon, authenticated;
grant select on public.np_due_notifications to authenticated, service_role;

create function public.np_refresh_notifications() returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('nailpilot-notifications', 0));
  perform public.np_expire_pending((select auth.uid()));
  update public.np_notifications n set status = 'invalidated'
  where n.kind in ('reminder','refill') and n.status <> 'invalidated' and not exists (
    select 1 from public.np_due_notifications d where d.appointment_id = n.appointment_id and d.kind = n.kind and d.reference_at = n.reference_at
  );
  insert into public.np_notifications(owner_id, client_id, appointment_id, kind, due_at, reference_at)
  select d.owner_id, d.client_id, d.appointment_id, d.kind, d.due_at, d.reference_at from public.np_due_notifications d
  on conflict (appointment_id, kind) do update set
    due_at = excluded.due_at,
    reference_at = excluded.reference_at,
    status = case when np_notifications.status = 'dismissed' and np_notifications.reference_at = excluded.reference_at then 'dismissed' else 'ready' end;
end;
$$;
revoke all on function public.np_refresh_notifications() from public, anon, authenticated;
grant execute on function public.np_refresh_notifications() to authenticated, service_role;
comment on function public.np_refresh_notifications() is 'Builds in-app suggestions only. No SMS or email is sent.';

-- ---------------------------------------------------------------------------
-- Public booking (F8) — the only surface reachable by anon
-- ---------------------------------------------------------------------------
create function public.np_public_page(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'slug', pp.slug, 'display_name', pp.display_name, 'city', pp.city, 'bio', pp.bio, 'instagram', pp.instagram,
    'trades', p.trades, 'work_mode', p.work_mode,
    'zone_postal_codes', p.zone_postal_codes, 'zone_radius_km', p.zone_radius_km,
    'min_notice_min', p.min_notice_min, 'max_horizon_days', p.max_horizon_days, 'slot_step_min', p.slot_step_min,
    'auto_confirm', p.auto_confirm,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'trade', s.trade, 'name', s.name, 'category', s.category,
        'description', s.description, 'duration_min', s.duration_min, 'price_cents', s.price_cents,
        'allowed_locations', s.allowed_locations) order by s.position, s.name)
      from public.np_services s
      where s.owner_id = pp.owner_id and s.online and not s.archived
        and (s.allowed_locations = 'both' or (s.allowed_locations = 'pro' and p.work_mode <> 'mobile') or (s.allowed_locations = 'client' and p.work_mode <> 'home_studio'))
    ), '[]'::jsonb))
  from public.np_public_profiles pp join public.np_profiles p on p.owner_id = pp.owner_id
  where pp.slug = lower(btrim(p_slug)) and pp.published and p.onboarded_at is not null and p.deletion_requested_at is null;
$$;

-- Free start times only (R1-R4). Each row: one bookable start instant.
create function public.np_available_slots(p_slug text, p_service_id uuid, p_location text, p_from date, p_to date, p_postal_code text default null)
returns table (slot_start timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile public.np_profiles;
  v_service public.np_services;
  v_before integer;
  v_after integer;
begin
  select p.* into v_profile from public.np_public_profiles pp join public.np_profiles p on p.owner_id = pp.owner_id
  where pp.slug = lower(btrim(p_slug)) and pp.published and p.onboarded_at is not null and p.deletion_requested_at is null;
  if not found then raise exception using errcode = 'NP404', message = 'Page de réservation introuvable.'; end if;
  select s.* into v_service from public.np_services s where s.id = p_service_id and s.owner_id = v_profile.owner_id and s.online and not s.archived;
  if not found then raise exception using errcode = 'NP404', message = 'Prestation introuvable.'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception using errcode = 'NP422', message = 'Période invalide (31 jours maximum).';
  end if;
  if p_location = 'pro' then
    if v_profile.work_mode = 'mobile' or v_service.allowed_locations = 'client' then
      raise exception using errcode = 'NP403', message = 'Cette prestation n’est pas proposée sur place.';
    end if;
    v_before := 0; v_after := v_service.prep_min;
  elsif p_location = 'client' then
    if v_profile.work_mode = 'home_studio' or v_service.allowed_locations = 'pro' then
      raise exception using errcode = 'NP403', message = 'Cette prestation n’est pas proposée à domicile.';
    end if;
    if p_postal_code is not null and cardinality(v_profile.zone_postal_codes) > 0 and not (p_postal_code = any (v_profile.zone_postal_codes)) then
      raise exception using errcode = 'NP403', message = 'Cette adresse est en dehors de la zone d’intervention.';
    end if;
    v_before := v_profile.travel_buffer_min; v_after := v_profile.travel_buffer_min;
  else
    raise exception using errcode = 'NP422', message = 'Lieu invalide.';
  end if;

  return query
  with days as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ), candidates as (
    select local_start, (local_start at time zone 'Europe/Paris') as s, range_end
    from (
      select (dd.day + make_interval(mins => m)) as local_start,
             ((dd.day + make_interval(mins => h.end_min)) at time zone 'Europe/Paris') as range_end
      from days dd
      join public.np_opening_hours h on h.owner_id = v_profile.owner_id and h.weekday = extract(isodow from dd.day)::integer
      cross join lateral generate_series(h.start_min, h.end_min - v_service.duration_min, v_profile.slot_step_min) m
    ) raw
  ), valid as (
    select c.s, c.s + make_interval(mins => v_service.duration_min) as e from candidates c
    where (c.s at time zone 'Europe/Paris') = c.local_start                                    -- R2: DST gap
      and ((c.s - interval '1 hour') at time zone 'Europe/Paris') <> c.local_start             -- R2: DST
      and ((c.s + interval '1 hour') at time zone 'Europe/Paris') <> c.local_start             --     ambiguity
      and c.s + make_interval(mins => v_service.duration_min) <= c.range_end
      and c.s >= now() + make_interval(mins => v_profile.min_notice_min)                      -- R3
      and c.s <= now() + make_interval(days => v_profile.max_horizon_days)
  )
  select v.s from valid v
  where not exists (
      select 1 from public.np_closures cl where cl.owner_id = v_profile.owner_id
        and tstzrange(cl.starts_at, cl.ends_at, '[)') && tstzrange(v.s, v.e, '[)'))
    and not exists (
      select 1 from public.np_appointments a where a.owner_id = v_profile.owner_id
        and (a.status in ('booked','done','no_show') or (a.status = 'pending' and a.expires_at > now()))
        and (tstzrange(v.s - make_interval(mins => v_before), v.e + make_interval(mins => v_after), '[)') && tstzrange(a.starts_at, a.ends_at, '[)')
          or tstzrange(v.s, v.e, '[)') && tstzrange(a.block_start, a.block_end, '[)')))
  group by v.s
  order by v.s;
end;
$$;

-- Atomic public request: validates everything server-side, then creates or attaches the client.
create function public.np_request_booking(
  p_slug text, p_service_id uuid, p_location text, p_starts_at timestamptz,
  p_first_name text, p_last_name text, p_phone text, p_email text default '', p_message text default '',
  p_address_line text default '', p_postal_code text default '', p_city text default '', p_access_info text default '',
  p_reminder_opt_in boolean default false, p_refill_opt_in boolean default false, p_website text default ''
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_profile public.np_profiles;
  v_city text;
  v_service public.np_services;
  v_phone text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := left(btrim(coalesce(p_first_name, '')) || ' ' || btrim(coalesce(p_last_name, '')), 120);
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  -- Audit 2026-10: the left-most X-Forwarded-For entry is client-controlled. Prefer cf-connecting-ip,
  -- which Cloudflare (in front of Supabase) overwrites; fall back to X-Forwarded-For. Anything that is
  -- not an IP literal is ignored. The per-pro caps below hold even when the IP is spoofed.
  v_ip text := nullif(btrim(coalesce(nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1))), '');
  v_phone_key text;
  v_ip_key text;
  v_client uuid;
  v_status text;
  v_appointment public.np_appointments;
begin
  if coalesce(p_website, '') <> '' then
    raise exception using errcode = 'NP422', message = 'Demande refusée.';
  end if;
  select p.* into v_profile from public.np_public_profiles pp join public.np_profiles p on p.owner_id = pp.owner_id
  where pp.slug = lower(btrim(p_slug)) and pp.published and p.onboarded_at is not null and p.deletion_requested_at is null;
  select pp.city into v_city from public.np_public_profiles pp where pp.owner_id = v_profile.owner_id;
  if v_profile.owner_id is null then raise exception using errcode = 'NP404', message = 'Page de réservation introuvable.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_profile.owner_id::text, 0));
  perform public.np_expire_pending(v_profile.owner_id);

  if length(btrim(coalesce(p_first_name, ''))) not between 1 and 60 or length(btrim(coalesce(p_last_name, ''))) not between 1 and 60 then
    raise exception using errcode = 'NP422', message = 'Indiquez votre prénom et votre nom.';
  end if;
  v_phone := public.np_normalize_phone(p_phone);
  if v_phone = '' then raise exception using errcode = 'NP422', message = 'Téléphone obligatoire.'; end if;
  if v_email <> '' and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception using errcode = 'NP422', message = 'Adresse e-mail invalide.';
  end if;
  if length(coalesce(p_message, '')) > 300 then raise exception using errcode = 'NP422', message = 'Message limité à 300 caractères.'; end if;
  if p_location = 'client' and (btrim(coalesce(p_address_line, '')) = '' or coalesce(p_postal_code, '') !~ '^[0-9]{5}$' or btrim(coalesce(p_city, '')) = '') then
    raise exception using errcode = 'NP422', message = 'Adresse d’intervention incomplète.';
  end if;
  -- Explicit bounds: a CHECK violation would echo the failing row (owner_id, client_id) to anon.
  if p_location = 'client' and (length(btrim(p_address_line)) > 200 or length(btrim(p_city)) > 80) then
    raise exception using errcode = 'NP422', message = 'Adresse d’intervention trop longue.';
  end if;
  if v_ip is not null and (length(v_ip) > 45 or v_ip !~ '^[0-9A-Fa-f:.]+$') then v_ip := null; end if;

  -- Rate limits (F8, R5). Rows inserted by a failed request roll back with it.
  -- Per phone and per IP: 5/hour. Per pro (audit 2026-10, spoofable IP + rotating phones):
  -- 20 successful online requests/hour and 15 live pending requests at most, so a bot
  -- cannot fill the agenda nor the client list. Raise both once Turnstile is in place.
  delete from public.np_booking_attempts b where b.created_at < now() - interval '1 day';
  v_phone_key := md5('np-phone:' || v_phone);
  v_ip_key := case when v_ip is null then null else md5('np-ip:' || v_ip) end;
  if (select count(*) from public.np_booking_attempts b where b.phone_key = v_phone_key and b.created_at > now() - interval '1 hour') >= 5
     or (v_ip_key is not null and (select count(*) from public.np_booking_attempts b where b.ip_key = v_ip_key and b.created_at > now() - interval '1 hour') >= 5)
     or (select count(*) from public.np_booking_attempts b where b.owner_id = v_profile.owner_id and b.created_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.np_appointments a where a.owner_id = v_profile.owner_id and a.source = 'online'
         and a.status = 'pending' and a.expires_at > now()) >= 15
     or (select count(*) from public.np_appointments a join public.np_clients c on c.id = a.client_id
         where a.owner_id = v_profile.owner_id and a.status = 'pending' and c.phone = v_phone) >= 3 then
    raise exception using errcode = 'NP429', message = 'Trop de demandes. Réessayez plus tard ou contactez directement la professionnelle.';
  end if;
  insert into public.np_booking_attempts(owner_id, phone_key, ip_key) values (v_profile.owner_id, v_phone_key, v_ip_key);

  -- Same rules as the slot list, evaluated after the lock (single source of truth).
  if not exists (
    select 1 from public.np_available_slots(p_slug, p_service_id, p_location, (p_starts_at at time zone 'Europe/Paris')::date,
      (p_starts_at at time zone 'Europe/Paris')::date, case when p_location = 'client' then p_postal_code end) s
    where s.slot_start = p_starts_at
  ) then
    raise exception using errcode = 'NP409', message = 'Ce créneau vient d’être réservé ou n’est plus disponible.';
  end if;
  select s.* into v_service from public.np_services s where s.id = p_service_id and s.owner_id = v_profile.owner_id;

  perform set_config('np.consent_source', 'online_form', true);
  -- Audit 2026-10: the phone alone is not proof of identity. Attach to an existing record only when
  -- the phone AND the name match (case/spacing-insensitive); otherwise create a separate record and let
  -- the pro decide (spec F7 « en cas de doute »). Prevents a stranger who knows a client's number from
  -- booking under her identity, filling her e-mail or granting consents on her behalf.
  select c.id into v_client from public.np_clients c
  where c.owner_id = v_profile.owner_id and c.phone = v_phone and not c.archived
    and lower(regexp_replace(btrim(c.name), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(v_name), '[[:space:]]+', ' ', 'g'))
  order by c.created_at limit 1;
  if v_client is null then
    insert into public.np_clients(owner_id, name, phone, email, source, reminder_opt_in, refill_opt_in)
    values (v_profile.owner_id, v_name, v_phone, v_email, 'online', coalesce(p_reminder_opt_in, false), coalesce(p_refill_opt_in, false))
    returning id into v_client;
  else
    -- Ticking a box grants consent; an unticked box never withdraws an earlier consent.
    update public.np_clients c set
      reminder_opt_in = c.reminder_opt_in or coalesce(p_reminder_opt_in, false),
      refill_opt_in = c.refill_opt_in or coalesce(p_refill_opt_in, false),
      email = case when c.email = '' then v_email else c.email end
    where c.id = v_client;
  end if;
  perform set_config('np.consent_source', '', true);
  if p_location = 'client' and not exists (select 1 from public.np_client_addresses ad where ad.client_id = v_client) then
    insert into public.np_client_addresses(owner_id, client_id, address_line, postal_code, city, access_info, is_primary)
    values (v_profile.owner_id, v_client, btrim(p_address_line), p_postal_code, btrim(p_city), left(coalesce(p_access_info, ''), 300), true);
  end if;

  v_status := case when v_profile.auto_confirm then 'booked' else 'pending' end;
  insert into public.np_appointments(owner_id, client_id, service_id, service_name, duration_min, price_cents, refill_enabled, refill_days,
    location_type, address_line, postal_code, city, access_info, buffer_before_min, buffer_after_min,
    starts_at, status, source, client_message, expires_at)
  values (v_profile.owner_id, v_client, v_service.id, v_service.name, v_service.duration_min, v_service.price_cents,
    v_service.refill_enabled, v_service.refill_days, p_location,
    case when p_location = 'client' then btrim(p_address_line) else '' end,
    case when p_location = 'client' then p_postal_code else '' end,
    case when p_location = 'client' then btrim(p_city) else '' end,
    case when p_location = 'client' then left(coalesce(p_access_info, ''), 300) else '' end,
    case when p_location = 'client' then v_profile.travel_buffer_min else 0 end,
    case when p_location = 'client' then v_profile.travel_buffer_min else v_service.prep_min end,
    p_starts_at, v_status, 'online', coalesce(p_message, ''),
    case when v_status = 'pending' then least(now() + interval '24 hours', p_starts_at - make_interval(mins => v_profile.min_notice_min)) end)
  returning * into v_appointment;

  return jsonb_build_object('status', v_appointment.status, 'starts_at', v_appointment.starts_at, 'ends_at', v_appointment.ends_at,
    'service_name', v_appointment.service_name, 'price_cents', v_appointment.price_cents, 'location_type', v_appointment.location_type,
    'city', case when p_location = 'client' then v_appointment.city else v_city end, 'expires_at', v_appointment.expires_at);
end;
$$;

revoke all on function public.np_public_page(text), public.np_available_slots(text, uuid, text, date, date, text),
  public.np_request_booking(text, uuid, text, timestamptz, text, text, text, text, text, text, text, text, text, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.np_public_page(text), public.np_available_slots(text, uuid, text, date, date, text),
  public.np_request_booking(text, uuid, text, timestamptz, text, text, text, text, text, text, text, text, text, boolean, boolean, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pro-side helpers (authenticated only)
-- ---------------------------------------------------------------------------
create function public.np_slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.np_public_profiles pp where pp.slug = lower(btrim(p_slug)) and pp.owner_id <> (select auth.uid()));
$$;

-- F7/F12: export one client with history and consent journal.
create function public.np_export_client(p_client_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'client', to_jsonb(c),
    'addresses', coalesce((select jsonb_agg(to_jsonb(ad)) from public.np_client_addresses ad where ad.client_id = c.id), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(to_jsonb(a) order by a.starts_at) from public.np_appointments a where a.client_id = c.id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(to_jsonb(k) order by k.recorded_at) from public.np_consents k where k.client_id = c.id), '[]'::jsonb))
  from public.np_clients c where c.id = p_client_id;
$$;

-- F12: permanent deletion; past appointments are kept anonymized (snapshots only).
create function public.np_delete_client(p_client_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.np_appointments a where a.client_id = p_client_id and a.status in ('booked','pending') and a.ends_at > now()) then
    raise exception using errcode = 'NP422', message = 'Annulez les rendez-vous à venir avant de supprimer cette cliente.';
  end if;
  -- Notifications, addresses and consent journal go with the client (on delete cascade).
  update public.np_appointments a set client_id = null, address_line = '', postal_code = '', city = '', access_info = ''
  where a.client_id = p_client_id;
  delete from public.np_clients c where c.id = p_client_id;
  if not found then raise exception using errcode = 'NP404', message = 'Cliente introuvable.'; end if;
end;
$$;

-- anonymized_at and client_message are not client-updatable columns: set them here.
create function public.np_anonymize_guard() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.client_id is null and old.client_id is not null then
    new.anonymized_at := now();
    new.client_message := '';
  end if;
  return new;
end;
$$;
revoke all on function public.np_anonymize_guard() from public, anon, authenticated;
create trigger np_appointments_anonymize before update of client_id on public.np_appointments for each row execute function public.np_anonymize_guard();

-- F12: full account export.
create function public.np_export_account() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.np_profiles p where p.owner_id = (select auth.uid())),
    'public_profile', (select to_jsonb(pp) from public.np_public_profiles pp where pp.owner_id = (select auth.uid())),
    'opening_hours', coalesce((select jsonb_agg(to_jsonb(h)) from public.np_opening_hours h), '[]'::jsonb),
    'closures', coalesce((select jsonb_agg(to_jsonb(x)) from public.np_closures x), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(to_jsonb(s)) from public.np_services s), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(to_jsonb(c)) from public.np_clients c), '[]'::jsonb),
    'client_addresses', coalesce((select jsonb_agg(to_jsonb(ad)) from public.np_client_addresses ad), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(to_jsonb(k)) from public.np_consents k), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(to_jsonb(a)) from public.np_appointments a), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from public.np_notifications n), '[]'::jsonb));
$$;

-- F12: deletion request. The page is unpublished now; a service_role job erases within 30 days.
create function public.np_request_account_deletion() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.np_profiles p set deletion_requested_at = now() where p.owner_id = (select auth.uid());
  update public.np_public_profiles pp set published = false where pp.owner_id = (select auth.uid());
end;
$$;

-- F3: replace the whole week atomically (delete + insert in one transaction, guards still apply).
create function public.np_save_opening_hours(p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'NP422', message = 'Horaires invalides.';
  end if;
  delete from public.np_opening_hours h where h.owner_id = (select auth.uid());
  insert into public.np_opening_hours(owner_id, weekday, start_min, end_min)
  select (select auth.uid()), r.weekday, r.start_min, r.end_min
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(weekday integer, start_min integer, end_min integer);
end;
$$;

-- F4: complete ordering of the catalogue (position = index in p_ids). RLS limits it to own rows.
create function public.np_reorder_services(p_ids uuid[]) returns void
language sql security invoker set search_path = '' as $$
  update public.np_services s set position = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where s.id = o.id;
$$;

revoke all on function public.np_slug_available(text), public.np_export_client(uuid), public.np_delete_client(uuid),
  public.np_export_account(), public.np_request_account_deletion(), public.np_save_opening_hours(jsonb),
  public.np_reorder_services(uuid[]) from public, anon, authenticated;
grant execute on function public.np_slug_available(text), public.np_export_client(uuid), public.np_delete_client(uuid),
  public.np_export_account(), public.np_request_account_deletion(), public.np_save_opening_hours(jsonb),
  public.np_reorder_services(uuid[]) to authenticated, service_role;
commit;
