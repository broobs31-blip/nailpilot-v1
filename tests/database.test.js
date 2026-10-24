import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

// Executes the actual bootstrap SQL in isolated PostgreSQL/WASM. This does not
// connect to Supabase, does not test PostgREST/Auth, and creates no hosted DB.
// Architect baseline for V2: V1 behaviours ported + smoke tests of the public
// booking surface. The Backend developer extends this file (see docs/ARCHITECTURE.md).
let db;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const client = '00000000-0000-4000-8000-000000000003';
const foreignClient = '00000000-0000-4000-8000-000000000004';
const appointment = '00000000-0000-4000-8000-000000000005';
const service = '00000000-0000-4000-8000-000000000006';
const slug = 'ines-ongles';
const TABLES = ['np_profiles', 'np_public_profiles', 'np_opening_hours', 'np_closures', 'np_services', 'np_clients',
  'np_client_addresses', 'np_consents', 'np_appointments', 'np_notifications', 'np_booking_attempts'];

// A Paris calendar day one week ahead, so slots are inside notice/horizon windows.
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date(Date.now() + 7 * 86400000));
const at = time => `('${day} ${time}'::timestamp at time zone 'Europe/Paris')`;
const iso = async time => (await db.query(`select ${at(time)} as t`)).rows[0].t.toISOString();

async function as(user) { await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`); }
async function asAnon() { await db.exec(`set role anon; set request.jwt.claim.sub = '';`); }
async function asAdmin() { await db.exec('set role none;'); }
async function book(status = 'booked', start = "now() + interval '2 hours'", extra = {}) {
  const cols = { id: `'${appointment}'`, client_id: `'${client}'`, service_name: "'Remplissage'", duration_min: 60, starts_at: start, status: `'${status}'`, ...extra };
  await db.exec(`insert into public.np_appointments(${Object.keys(cols)}) values(${Object.values(cols)});`);
}
async function slots(location = 'pro', postal = null) {
  const rows = (await db.query(`select slot_start from public.np_available_slots($1,$2,$3,$4::date,$4::date,$5)`, [slug, service, location, day, postal])).rows;
  return rows.map(r => r.slot_start.toISOString());
}
function request(startsAt, overrides = {}) {
  const p = { p_slug: slug, p_service_id: service, p_location: 'pro', p_starts_at: startsAt, p_first_name: 'Nora', p_last_name: 'Test', p_phone: '06 11 22 33 44', p_reminder_opt_in: true, ...overrides };
  const keys = Object.keys(p);
  return db.query(`select public.np_request_booking(${keys.map((k, i) => `${k} => $${i + 1}`)}) as r`, Object.values(p));
}

before(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create schema auth; create schema extensions; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => {
  await asAdmin();
  await db.exec(`truncate ${TABLES.map(t => `public.${t}`).join(',')}, auth.users cascade;
    insert into auth.users(id) values('${owner}'),('${other}');
    insert into public.np_profiles(owner_id,trades,work_mode,base_address_line,base_postal_code,base_city,zone_postal_codes,min_notice_min,onboarded_at)
      values('${owner}','{nails}','both','1 rue Privée','31000','Toulouse','{31000,31200}',0,now()),('${other}','{hair}','mobile','','','','{}',0,now());
    insert into public.np_public_profiles(owner_id,slug,display_name,city,published) values('${owner}','${slug}','Inès Ongles','Toulouse',true),('${other}','sofia-coiffure','Sofia','Lyon',false);
    insert into public.np_opening_hours(owner_id,weekday,start_min,end_min) select '${owner}', d, 540, 1140 from generate_series(1,7) d;
    insert into public.np_services(id,owner_id,trade,name,duration_min,price_cents,prep_min) values('${service}','${owner}','nails','Remplissage',60,4000,10);
    insert into public.np_clients(id,owner_id,name,phone,reminder_opt_in,refill_opt_in) values('${client}','${owner}','Cliente test','+33600000001',true,true),('${foreignClient}','${other}','Autre test','',true,true);`);
  await as(owner);
});
after(async () => { await db?.close(); });

test('database: RLS isolates every private table between pros', async () => {
  await book(); await db.exec('select public.np_refresh_notifications();');
  assert.equal((await db.query('select * from public.np_clients')).rows.length, 1);
  await as(other);
  for (const table of ['np_appointments', 'np_notifications', 'np_due_notifications', 'np_services', 'np_opening_hours', 'np_consents'])
    assert.equal((await db.query(`select * from public.${table} where owner_id = '${owner}'`)).rows.length, 0, table);
  assert.equal((await db.query(`select * from public.np_profiles`)).rows.length, 1);
  assert.equal((await db.query(`update public.np_clients set name='Intrusion' where id='${client}' returning *`)).rows.length, 0);
  await assert.rejects(db.exec(`insert into public.np_clients(owner_id,name) values('${owner}','Intrusion')`), /row-level security/);
});
test('database: anonymous role has no table access, only public functions', async () => {
  await asAnon();
  for (const table of TABLES) await assert.rejects(db.query(`select * from public.${table}`), /permission denied/, table);
  await assert.rejects(db.exec('select public.np_refresh_notifications()'), /permission denied/);
  await assert.rejects(db.exec(`select public.np_delete_client('${client}')`), /permission denied/);
  const page = (await db.query('select public.np_public_page($1) as p', [slug])).rows[0].p;
  assert.equal(page.display_name, 'Inès Ongles'); assert.equal(page.services.length, 1);
  assert.doesNotMatch(JSON.stringify(page), /Privée|31000.*rue|owner_id/);
  assert.equal((await db.query(`select public.np_public_page('sofia-coiffure') as p`)).rows[0].p, null);
});
test('database: owner reassignment and foreign-client references rejected', async () => {
  await assert.rejects(db.exec(`update public.np_clients set owner_id='${other}' where id='${client}'`), /row-level security|permission denied/);
  await assert.rejects(db.exec(`insert into public.np_appointments(client_id,service_name,duration_min,starts_at) values('${foreignClient}','Remplissage',60,now())`), /Cliente introuvable/);
});
test('database: GiST prevents collisions and allows adjacent slots', async () => {
  await book();
  await assert.rejects(db.exec(`insert into public.np_appointments(client_id,service_name,duration_min,starts_at) values('${client}','Remplissage',60,now()+interval '2 hours 30 minutes')`), /chevauche|exclusion/);
  await db.exec(`insert into public.np_appointments(client_id,service_name,duration_min,starts_at) values('${client}','Remplissage',60,now()+interval '4 hours')`);
  await db.exec(`insert into public.np_appointments(client_id,service_name,duration_min,starts_at) select client_id,service_name,60,ends_at from public.np_appointments where id='${appointment}'`);
});
test('database: travel buffers do not stack (R1 max rule)', async () => {
  const home = { location_type: "'client'", address_line: "'2 rue A'", postal_code: "'31000'", city: "'Toulouse'", buffer_before_min: 30, buffer_after_min: 30 };
  await book('booked', at('10:00'), home);
  const second = (start, id) => db.exec(`insert into public.np_appointments(id,client_id,service_name,duration_min,starts_at,location_type,address_line,postal_code,city,buffer_before_min,buffer_after_min)
    values('${id}','${client}','Coupe',45,${at(start)},'client','3 rue B','31200','Toulouse',30,30)`);
  await assert.rejects(second('11:20', '00000000-0000-4000-8000-0000000000a1'), /chevauche/);
  await second('11:30', '00000000-0000-4000-8000-0000000000a2');
  const row = (await db.query(`select ends_at, block_start, block_end from public.np_appointments where id='${appointment}'`)).rows[0];
  assert.equal(row.ends_at.toISOString(), await iso('11:00'));
  assert.equal(row.block_end.toISOString(), await iso('11:30'));
});
test('database: available slots respect hours, grid and buffered appointments', async () => {
  await book('booked', at('14:00'), { location_type: "'client'", address_line: "'2 rue A'", postal_code: "'31000'", city: "'Toulouse'", buffer_before_min: 30, buffer_after_min: 30 });
  await asAnon();
  const free = await slots();
  assert.equal(free[0], await iso('09:00'));
  assert.equal(free.at(-1), await iso('18:00'));
  assert.ok(free.includes(await iso('12:30')) && free.includes(await iso('15:30')));
  for (const t of ['13:00', '13:30', '14:00', '15:00']) assert.ok(!free.includes(await iso(t)), t);
  await assert.rejects(slots('client', '75001'), /zone/);
  assert.ok((await slots('client', '31200')).length > 0);
});
test('database: public booking is atomic, attaches client data and logs consent', async () => {
  await asAnon();
  const start = await iso('10:00');
  const result = (await request(start)).rows[0].r;
  assert.equal(result.status, 'pending'); assert.equal(result.city, 'Toulouse');
  await assert.rejects(request(start, { p_phone: '0699999999' }), /vient d’être réservé/);
  await assert.rejects(request(await iso('10:10')), /n’est plus disponible/);
  await assert.rejects(request(await iso('15:00'), { p_website: 'spam' }), /refusée/);
  await as(owner);
  const appt = (await db.query(`select * from public.np_appointments where source='online'`)).rows[0];
  assert.equal(appt.status, 'pending'); assert.equal(appt.service_name, 'Remplissage'); assert.equal(appt.price_cents, 4000);
  assert.equal(appt.buffer_after_min, 10); assert.ok(appt.expires_at);
  const clients = (await db.query(`select * from public.np_clients where source='online'`)).rows;
  assert.equal(clients.length, 1); assert.equal(clients[0].phone, '+33611223344');
  assert.deepEqual((await db.query(`select kind, granted, source from public.np_consents where client_id=$1 order by kind`, [clients[0].id])).rows,
    [{ kind: 'refills', granted: false, source: 'online_form' }, { kind: 'reminders', granted: true, source: 'online_form' }]);
  assert.equal((await db.query(`select * from public.np_notifications where kind='new_request'`)).rows.length, 1);
  await db.exec(`update public.np_appointments set status='booked' where id='${appt.id}'`);
  assert.equal((await db.query(`select * from public.np_notifications where kind='confirmation' and status='ready'`)).rows.length, 1);
});
test('database: reminders idempotent, dismissed preserved, reschedule regenerates', async () => {
  await book();
  await db.exec('select public.np_refresh_notifications(); select public.np_refresh_notifications();');
  assert.equal((await db.query('select * from public.np_notifications')).rows.length, 1);
  await db.exec("update public.np_notifications set status='dismissed'; select public.np_refresh_notifications();");
  assert.equal((await db.query('select status from public.np_notifications')).rows[0].status, 'dismissed');
  await db.exec(`update public.np_appointments set starts_at=starts_at+interval '1 hour' where id='${appointment}'; select public.np_refresh_notifications();`);
  assert.equal((await db.query('select status from public.np_notifications')).rows[0].status, 'ready');
});
test('database: cancellation and withdrawn consent invalidate reminders', async () => {
  await book(); await db.exec('select public.np_refresh_notifications();');
  await db.exec(`update public.np_clients set reminder_opt_in=false where id='${client}'; select public.np_refresh_notifications();`);
  assert.equal((await db.query('select status from public.np_notifications')).rows[0].status, 'invalidated');
  await db.exec(`update public.np_clients set reminder_opt_in=true where id='${client}'; update public.np_appointments set status='cancelled' where id='${appointment}'; select public.np_refresh_notifications();`);
  assert.equal((await db.query('select status from public.np_notifications')).rows[0].status, 'invalidated');
});
test('database: refill due, suppressed by future booking, restored by cancellation', async () => {
  await book('done', "now() - interval '25 days'");
  await db.exec('select public.np_refresh_notifications();');
  assert.equal((await db.query("select * from public.np_notifications where kind='refill' and status='ready'")).rows.length, 1);
  await db.exec(`insert into public.np_appointments(client_id,service_name,duration_min,starts_at) values('${client}','Remplissage',60,now()+interval '7 days'); select public.np_refresh_notifications();`);
  assert.equal((await db.query("select * from public.np_notifications where kind='refill' and status='ready'")).rows.length, 0);
  await db.exec("update public.np_appointments set status='cancelled' where status='booked'; select public.np_refresh_notifications();");
  assert.equal((await db.query("select * from public.np_notifications where kind='refill' and status='ready'")).rows.length, 1);
});
test('database: status transitions follow R6', async () => {
  await book('done', "now() - interval '2 days'");
  await assert.rejects(db.exec(`update public.np_appointments set status='cancelled' where id='${appointment}'`), /ne peut plus être annulé/);
  await assert.rejects(db.exec(`update public.np_appointments set starts_at=starts_at+interval '1 hour' where id='${appointment}'`), /passé/);
  await assert.rejects(db.exec(`insert into public.np_appointments(client_id,service_name,duration_min,starts_at,status) values('${client}','X',60,now()+interval '3 days','no_show')`), /absence/);
});
test('database: archive guard, archived client guard and anonymizing deletion', async () => {
  await book();
  await assert.rejects(db.exec(`update public.np_clients set archived=true where id='${client}'`), /Annulez/);
  await assert.rejects(db.exec(`select public.np_delete_client('${client}')`), /Annulez/);
  await db.exec(`update public.np_appointments set status='cancelled' where id='${appointment}'; update public.np_clients set archived=true where id='${client}';`);
  await assert.rejects(db.exec(`insert into public.np_appointments(client_id,service_name,duration_min,starts_at) values('${client}','Remplissage',60,now())`), /archivée/);
  await db.exec(`select public.np_delete_client('${client}')`);
  const row = (await db.query(`select client_id, anonymized_at, service_name from public.np_appointments where id='${appointment}'`)).rows[0];
  assert.equal(row.client_id, null); assert.ok(row.anonymized_at); assert.equal(row.service_name, 'Remplissage');
  assert.equal((await db.query('select * from public.np_consents')).rows.length, 0);
});
