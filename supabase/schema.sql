-- Apply ONLY to a NEW, dedicated NailPilot preview project.
-- Not yet applied. This is a reviewed bootstrap script, not migration history.
begin;
create extension if not exists btree_gist with schema extensions;

create table public.np_clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  phone text not null default '' check (phone = '' or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text not null default '' check (length(email) <= 254 and (email = '' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  notes text not null default '' check (length(notes) <= 2000),
  refill_days integer not null default 21 check (refill_days between 7 and 90),
  reminder_opt_in boolean not null default false,
  refill_opt_in boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, owner_id)
);

create table public.np_appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  client_id uuid not null,
  service text not null check(service in ('Pose complète','Remplissage','Semi-permanent','Dépose','Soin des ongles')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked' check(status in ('booked','done','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at > starts_at and ends_at <= starts_at + interval '8 hours'),
  foreign key(client_id, owner_id) references public.np_clients(id, owner_id),
  unique(id, owner_id),
  exclude using gist (owner_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where(status <> 'cancelled')
);
create index np_appointments_client_idx on public.np_appointments(client_id,owner_id,ends_at desc);
create index np_appointments_owner_date_idx on public.np_appointments(owner_id,starts_at);
create index np_clients_owner_idx on public.np_clients(owner_id,archived);

create table public.np_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  client_id uuid not null,
  appointment_id uuid not null,
  kind text not null check(kind in ('reminder','refill')),
  due_at timestamptz not null,
  reference_at timestamptz not null,
  status text not null default 'ready' check(status in ('ready','dismissed','invalidated')),
  created_at timestamptz not null default now(),
  foreign key(client_id,owner_id) references public.np_clients(id,owner_id),
  foreign key(appointment_id,owner_id) references public.np_appointments(id,owner_id),
  unique(appointment_id,kind)
);
create index np_notifications_owner_due_idx on public.np_notifications(owner_id,status,due_at);

alter table public.np_clients enable row level security;
alter table public.np_appointments enable row level security;
alter table public.np_notifications enable row level security;
revoke all on public.np_clients, public.np_appointments, public.np_notifications from public, anon, authenticated;
grant select,insert,update on public.np_clients, public.np_appointments to authenticated;
grant select,insert on public.np_notifications to authenticated;
grant update(status,due_at,reference_at) on public.np_notifications to authenticated;
grant all on public.np_clients, public.np_appointments, public.np_notifications to service_role;

create policy np_clients_select on public.np_clients for select to authenticated using(owner_id = (select auth.uid()));
create policy np_clients_insert on public.np_clients for insert to authenticated with check(owner_id = (select auth.uid()));
create policy np_clients_update on public.np_clients for update to authenticated using(owner_id = (select auth.uid())) with check(owner_id = (select auth.uid()));
create policy np_appointments_select on public.np_appointments for select to authenticated using(owner_id = (select auth.uid()));
create policy np_appointments_insert on public.np_appointments for insert to authenticated with check(owner_id = (select auth.uid()));
create policy np_appointments_update on public.np_appointments for update to authenticated using(owner_id = (select auth.uid())) with check(owner_id = (select auth.uid()));
create policy np_notifications_select on public.np_notifications for select to authenticated using(owner_id = (select auth.uid()));
create policy np_notifications_insert on public.np_notifications for insert to authenticated with check(owner_id = (select auth.uid()));
create policy np_notifications_update on public.np_notifications for update to authenticated using(owner_id = (select auth.uid())) with check(owner_id = (select auth.uid()));

create function public.np_stamp_update() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.np_stamp_update() from public,anon,authenticated;
create trigger np_clients_stamp before update on public.np_clients for each row execute function public.np_stamp_update();
create trigger np_appointments_stamp before update on public.np_appointments for each row execute function public.np_stamp_update();

-- Prevent a cross-tab race between archiving a client and booking a new slot.
create function public.np_validate_client_state() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'np_clients' then
    if new.archived and not old.archived and exists(select 1 from public.np_appointments a where a.client_id = new.id and a.status = 'booked' and a.ends_at > now()) then
      raise exception 'Annulez les rendez-vous à venir avant d’archiver cette cliente.';
    end if;
  else
    perform 1 from public.np_clients c where c.id = new.client_id and c.owner_id = new.owner_id and not c.archived for update;
    if not found then raise exception 'Cliente introuvable ou archivée.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.np_validate_client_state() from public,anon,authenticated;
create trigger np_clients_archive_guard before update of archived on public.np_clients for each row execute function public.np_validate_client_state();
create trigger np_appointments_client_guard before insert or update on public.np_appointments for each row execute function public.np_validate_client_state();

-- Internal view retains RLS. Only applicable notifications are represented.
create view public.np_due_notifications with (security_invoker = true) as
select a.owner_id, a.client_id, a.id as appointment_id, 'reminder'::text as kind,
  a.starts_at - interval '24 hours' as due_at, a.starts_at as reference_at
from public.np_appointments a join public.np_clients c on c.id = a.client_id and c.owner_id = a.owner_id
where not c.archived and c.reminder_opt_in and a.status = 'booked' and a.starts_at > now() and a.starts_at - interval '24 hours' <= now()
union all
select a.owner_id, a.client_id, a.id, 'refill'::text,
  ((a.ends_at at time zone 'Europe/Paris') + make_interval(days => c.refill_days)) at time zone 'Europe/Paris', a.ends_at
from public.np_appointments a join public.np_clients c on c.id = a.client_id and c.owner_id = a.owner_id
where not c.archived and c.refill_opt_in and a.status = 'done' and a.ends_at <= now()
  and ((a.ends_at at time zone 'Europe/Paris') + make_interval(days => c.refill_days)) at time zone 'Europe/Paris' <= now()
  and not exists(select 1 from public.np_appointments newer where newer.client_id = a.client_id and newer.owner_id = a.owner_id and newer.status = 'done' and newer.ends_at <= now() and (newer.ends_at,newer.id) > (a.ends_at,a.id))
  and not exists(select 1 from public.np_appointments future where future.client_id = a.client_id and future.owner_id = a.owner_id and future.status = 'booked' and future.ends_at > now());
revoke all on public.np_due_notifications from public,anon;
grant select on public.np_due_notifications to authenticated,service_role;

create function public.np_refresh_notifications() returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- Serialize refreshes per owner (cron takes the global lock too).
  perform pg_advisory_xact_lock(hashtextextended('nailpilot-notifications',0));
  update public.np_notifications n set status = 'invalidated'
  where n.status <> 'invalidated' and not exists (
    select 1 from public.np_due_notifications d where d.appointment_id = n.appointment_id and d.kind = n.kind and d.reference_at = n.reference_at
  );
  insert into public.np_notifications(owner_id,client_id,appointment_id,kind,due_at,reference_at)
  select d.owner_id,d.client_id,d.appointment_id,d.kind,d.due_at,d.reference_at from public.np_due_notifications d
  on conflict(appointment_id,kind) do update set
    due_at = excluded.due_at,
    reference_at = excluded.reference_at,
    status = case when np_notifications.status = 'dismissed' and np_notifications.reference_at = excluded.reference_at then 'dismissed' else 'ready' end;
end;
$$;
revoke all on function public.np_refresh_notifications() from public,anon;
grant execute on function public.np_refresh_notifications() to authenticated,service_role;
comment on function public.np_refresh_notifications() is 'Builds in-app suggestions only. No SMS or email is sent.';
commit;
