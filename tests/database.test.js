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

// ===========================================================================
// Backend V2 extensions: RLS on every table, anon surface, slots mirror with domain.js,
// R2/R3/R5 rules, atomic booking, export and deletion (F12).
// ===========================================================================
import * as D from '../src/domain.js';

const plain = rows => JSON.parse(JSON.stringify(rows));
async function domainSlots({ location = 'pro', postal = null, from = day, to = day } = {}) {
  await asAdmin();
  const [profile] = plain((await db.query(`select * from public.np_profiles where owner_id=$1`, [owner])).rows);
  const openingHours = plain((await db.query(`select * from public.np_opening_hours where owner_id=$1`, [owner])).rows);
  const closures = plain((await db.query(`select * from public.np_closures where owner_id=$1`, [owner])).rows);
  const appointments = plain((await db.query(`select * from public.np_appointments where owner_id=$1`, [owner])).rows);
  const [svc] = plain((await db.query(`select * from public.np_services where id=$1`, [service])).rows);
  return D.availableSlots({ profile, openingHours, closures, appointments, service: svc, location, from, to, postalCode: postal, now: new Date() });
}
async function sqlSlots({ location = 'pro', postal = null, from = day, to = day } = {}) {
  await asAnon();
  const rows = (await db.query(`select slot_start from public.np_available_slots($1,$2,$3,$4::date,$5::date,$6)`, [slug, service, location, from, to, postal])).rows;
  return rows.map(r => r.slot_start.toISOString());
}
const errCode = code => e => e.code === code;
// Last Sunday of a month, strictly in the future (DST switch days in Europe/Paris).
function nextLastSunday(month) {
  const now = new Date();
  for (let year = now.getUTCFullYear(); ; year++) {
    const last = new Date(Date.UTC(year, month, 0));
    last.setUTCDate(last.getUTCDate() - last.getUTCDay());
    if (last.getTime() > now.getTime()) return last.toISOString().slice(0, 10);
  }
}

test('database V2: RLS isolates select/update/delete/insert on every private table', async () => {
  await asAdmin();
  await db.exec(`insert into public.np_closures(owner_id,starts_at,ends_at) values('${other}',now(),now()+interval '1 day');
    insert into public.np_opening_hours(owner_id,weekday,start_min,end_min) values('${other}',1,540,600);
    insert into public.np_services(owner_id,name,duration_min) values('${other}','Coupe',45);
    insert into public.np_client_addresses(owner_id,client_id,address_line,postal_code,city) values('${other}','${foreignClient}','1 rue B','69000','Lyon');
    insert into public.np_appointments(owner_id,client_id,service_name,duration_min,starts_at) values('${other}','${foreignClient}','Coupe',45,now()+interval '1 day');`);
  await db.exec(`insert into public.np_notifications(owner_id,client_id,appointment_id,kind,due_at,reference_at)
    select owner_id,client_id,id,'reminder',now(),starts_at from public.np_appointments where owner_id='${other}'`);
  await as(owner);
  const writable = { np_profiles: 'trades', np_public_profiles: 'display_name', np_opening_hours: 'weekday', np_closures: 'reason', np_services: 'name',
    np_clients: 'name', np_client_addresses: 'label', np_appointments: 'status', np_notifications: 'status' };
  for (const table of [...TABLES.filter(t => t !== 'np_booking_attempts'), 'np_due_notifications'])
    assert.equal((await db.query(`select * from public.${table} where owner_id='${other}'`)).rows.length, 0, `select ${table}`);
  for (const [table, column] of Object.entries(writable))
    assert.equal((await db.query(`update public.${table} set ${column}=${column} where owner_id='${other}' returning 1`)).rows.length, 0, `update ${table}`);
  for (const table of ['np_opening_hours', 'np_closures', 'np_services', 'np_clients', 'np_client_addresses'])
    assert.equal((await db.query(`delete from public.${table} where owner_id='${other}' returning 1`)).rows.length, 0, `delete ${table}`);
  for (const table of ['np_appointments', 'np_notifications', 'np_consents', 'np_profiles', 'np_public_profiles'])
    await assert.rejects(db.exec(`delete from public.${table} where owner_id='${other}'`), /permission denied/, `delete ${table}`);
  await assert.rejects(db.exec(`insert into public.np_services(owner_id,name,duration_min) values('${other}','X',30)`), /row-level security/);
  await assert.rejects(db.exec(`insert into public.np_closures(owner_id,starts_at,ends_at) values('${other}',now(),now()+interval '1 hour')`), /row-level security/);
  await assert.rejects(db.exec(`insert into public.np_consents(owner_id,client_id,kind,granted,source) values('${owner}','${client}','reminders',true,'pro')`), /permission denied/);
  await assert.rejects(db.query('select * from public.np_booking_attempts'), /permission denied/);
  await assert.rejects(db.exec(`update public.np_appointments set source='online', expires_at=now() where owner_id='${owner}'`), /permission denied/);
  await as(other);
  assert.equal((await db.query(`select public.np_export_client('${client}') as x`)).rows[0].x, null);
  const account = (await db.query('select public.np_export_account() as x')).rows[0].x;
  assert.deepEqual(account.clients.map(c => c.id), [foreignClient]); assert.equal(account.profile.owner_id, other);
  assert.ok(account.appointments.every(a => a.owner_id === other) && account.services.every(s => s.owner_id === other));
});
test('database V2: anon reaches no private function nor view', async () => {
  await asAnon();
  for (const sql of ['select public.np_slug_available($$x$$)', 'select public.np_export_account()', `select public.np_export_client('${client}')`,
    'select public.np_expire_pending()', 'select public.np_request_account_deletion()', `select public.np_save_opening_hours('[]'::jsonb)`,
    'select public.np_reorder_services(array[]::uuid[])', 'select * from public.np_due_notifications', `select public.np_normalize_phone('0611223344')`])
    await assert.rejects(db.exec(sql), /permission denied/, sql);
  await assert.rejects(db.query(`select * from public.np_available_slots('sofia-coiffure',$1,'client',current_date,current_date)`, [service]), errCode('NP404'));
  await assert.rejects(db.query(`select * from public.np_available_slots($1,$2,'pro',current_date,current_date + 40)`, [slug, service]), errCode('NP422'));
});
test('database V2: column defaults equal domain DEFAULT_PROFILE', async () => {
  await asAdmin();
  await db.exec(`delete from public.np_profiles where owner_id='${other}'; insert into public.np_profiles(owner_id) values('${other}')`);
  const row = (await db.query(`select * from public.np_profiles where owner_id='${other}'`)).rows[0];
  for (const [k, v] of Object.entries(D.DEFAULT_PROFILE)) assert.deepEqual(row[k], v, k);
});
test('database V2: domain.availableSlots mirrors np_available_slots (buffers, pending, closures, client)', async () => {
  await book('booked', at('14:00'), { location_type: "'client'", address_line: "'2 rue A'", postal_code: "'31000'", city: "'Toulouse'", buffer_before_min: 30, buffer_after_min: 30 });
  await asAdmin();
  await db.exec(`insert into public.np_appointments(owner_id,client_id,service_name,duration_min,starts_at,status,source,expires_at,buffer_after_min)
      values('${owner}','${client}','Pose',90,${at('10:00')},'pending','online',now()+interval '1 hour',10);
    insert into public.np_closures(owner_id,starts_at,ends_at) values('${owner}',${at('17:00')},${at('19:00')});`);
  for (const args of [{}, { location: 'client', postal: '31200' }, { location: 'client' }]) {
    const sql = await sqlSlots(args);
    assert.ok(sql.length >= 4, `${JSON.stringify(args)} ${sql.map(D.parisLocal)}`);
    assert.deepEqual(await domainSlots(args), sql, JSON.stringify(args));
  }
  const free = (await sqlSlots()).map(D.parisLocal).map(x => x.slice(11));
  assert.deepEqual(free, ['12:00', '12:30', '15:30', '16:00']); // pending 10:00-11:30 (+10), client 14:00 (±30), closure 17:00
});
test('database V2: DST days — no slot in the missing or repeated hour, SQL = domain', async () => {
  await asAdmin();
  await db.exec(`update public.np_profiles set max_horizon_days=366 where owner_id='${owner}';
    delete from public.np_opening_hours where owner_id='${owner}' and weekday=7;
    insert into public.np_opening_hours(owner_id,weekday,start_min,end_min) values('${owner}',7,0,360);`);
  const within = [nextLastSunday(3), nextLastSunday(10)].filter(d => Date.parse(d) < Date.now() + 360 * 86400000);
  assert.ok(within.length >= 1);
  for (const sunday of within) {
    const sql = await sqlSlots({ from: sunday, to: sunday });
    assert.deepEqual(await domainSlots({ from: sunday, to: sunday }), sql, sunday);
    const times = sql.map(D.parisLocal).map(x => x.slice(11));
    assert.ok(!times.includes('02:00') && !times.includes('02:30') && times.includes('01:00') && times.includes('03:00'), `${sunday}: ${times}`);
  }
});
test('database V2: R3 notice and horizon bound the slot list', async () => {
  await asAdmin();
  await db.exec(`update public.np_profiles set max_horizon_days=7, min_notice_min=10080 where owner_id='${owner}'`);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
  assert.deepEqual(await sqlSlots({ from: today, to: today }), []);
  assert.deepEqual(await sqlSlots({ from: D.addDays(day, 2), to: D.addDays(day, 2) }), []);
});
test('database V2: location rules — mobile pro, service restricted to studio, address required', async () => {
  await asAdmin();
  await db.exec(`update public.np_services set allowed_locations='pro' where id='${service}'`);
  await assert.rejects(sqlSlots({ location: 'client' }), errCode('NP403'));
  await asAdmin();
  await db.exec(`update public.np_services set allowed_locations='both' where id='${service}'; update public.np_profiles set work_mode='mobile' where owner_id='${owner}'`);
  await assert.rejects(sqlSlots({ location: 'pro' }), errCode('NP403'));
  await asAnon();
  await assert.rejects(request(await iso('10:00'), { p_location: 'client' }), errCode('NP422'));
  const ok = (await request(await iso('10:00'), { p_location: 'client', p_address_line: '5 rue C', p_postal_code: '31200', p_city: 'Toulouse', p_access_info: 'Bât B' })).rows[0].r;
  assert.equal(ok.location_type, 'client'); assert.equal(ok.city, 'Toulouse');
  await as(owner);
  const a = (await db.query(`select * from public.np_appointments where source='online'`)).rows[0];
  assert.equal(a.buffer_before_min, 30); assert.equal(a.buffer_after_min, 30); assert.equal(a.access_info, 'Bât B');
  assert.equal((await db.query(`select * from public.np_client_addresses where client_id=$1 and is_primary`, [a.client_id])).rows.length, 1);
});
test('database V2: concurrent requests for one slot — exactly one succeeds', async () => {
  await asAnon();
  const start = await iso('11:00');
  const results = await Promise.allSettled([request(start, { p_phone: '0611111111' }), request(start, { p_phone: '0622222222' }), request(start, { p_phone: '0633333333' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'NP409'));
  await as(owner);
  assert.equal((await db.query(`select * from public.np_appointments where starts_at=$1`, [start])).rows.length, 1);
  // Direct pro insert on top of the pending request is refused too (buffers included).
  await assert.rejects(db.exec(`insert into public.np_appointments(client_id,service_name,duration_min,starts_at) values('${client}','X',30,${at('12:05')})`), errCode('23P01'));
});
test('database V2: R5 pending expiry frees the slot, notifies, and blocks acceptance', async () => {
  await asAnon();
  const start = await iso('10:00');
  await request(start);
  await asAdmin();
  await db.exec(`update public.np_appointments set expires_at=now()-interval '1 minute' where source='online'`);
  await as(owner);
  const id = (await db.query(`select id from public.np_appointments where source='online'`)).rows[0].id;
  await assert.rejects(db.exec(`update public.np_appointments set status='booked' where id='${id}'`), /expiré/);
  assert.ok((await sqlSlots()).includes(start), 'expired request no longer blocks');
  await as(owner);
  await db.exec('select public.np_refresh_notifications()');
  const row = (await db.query(`select status, expired, cancel_reason, expires_at from public.np_appointments where id='${id}'`)).rows[0];
  assert.deepEqual([row.status, row.expired, row.cancel_reason, row.expires_at], ['cancelled', true, 'Demande expirée', null]);
  assert.deepEqual((await db.query(`select kind, status from public.np_notifications where appointment_id='${id}' order by kind`)).rows,
    [{ kind: 'new_request', status: 'dismissed' }, { kind: 'request_expired', status: 'ready' }]);
  await asAnon();
  assert.equal((await request(start, { p_phone: '0644444444' })).rows[0].r.status, 'pending');
});
test('database V2: pending expiry = min(24 h, start − notice) and declining notifies', async () => {
  await asAdmin();
  await db.exec(`update public.np_profiles set min_notice_min=10070 where owner_id='${owner}'`); // ≈ 7 days minus 10 min
  await asAnon();
  const start = await iso('18:00');
  const r = (await request(start)).rows[0].r;
  assert.ok(Date.parse(r.expires_at) <= Date.parse(start) - 10070 * 60000 + 1000);
  await as(owner);
  await db.exec(`update public.np_appointments set status='cancelled', cancel_reason='Indisponible' where source='online'`);
  assert.equal((await db.query(`select * from public.np_notifications where kind='confirmation' and status='ready'`)).rows.length, 1);
});
test('database V2: R5 cap of 3 pending per phone and 5 requests/hour per phone', async () => {
  await asAnon();
  for (const t of ['09:00', '10:30', '12:00']) await request(await iso(t));
  await assert.rejects(request(await iso('14:00')), errCode('NP429'));
  await asAdmin();
  await db.exec(`truncate public.np_booking_attempts; delete from public.np_appointments; update public.np_profiles set auto_confirm=true where owner_id='${owner}'`);
  await asAnon();
  for (const t of ['09:00', '10:30', '12:00', '14:00', '15:30']) assert.equal((await request(await iso(t), { p_phone: '0655555555' })).rows[0].r.status, 'booked');
  await assert.rejects(request(await iso('17:00'), { p_phone: '0655555555' }), errCode('NP429'));
  await as(owner);
  assert.equal((await db.query(`select * from public.np_clients where phone='+33655555555'`)).rows.length, 1, 'same phone attaches one client');
  assert.equal((await db.query(`select * from public.np_notifications where kind='confirmation'`)).rows.length, 5);
});
test('database V2: returning client keeps earlier consent, gains new one, e-mail filled once', async () => {
  await asAdmin();
  await db.exec(`update public.np_clients set refill_opt_in=false where id='${client}'`);
  await asAnon();
  await request(await iso('09:00'), { p_phone: '0600000001', p_first_name: ' cliente ', p_last_name: 'TEST', p_reminder_opt_in: false, p_refill_opt_in: true, p_email: 'a@b.fr' });
  await as(owner);
  const c = (await db.query(`select * from public.np_clients where id='${client}'`)).rows[0];
  assert.deepEqual([c.reminder_opt_in, c.refill_opt_in, c.email, c.source], [true, true, 'a@b.fr', 'manual']);
  assert.deepEqual((await db.query(`select kind, granted, source from public.np_consents where client_id='${client}' and source='online_form'`)).rows, [{ kind: 'refills', granted: true, source: 'online_form' }]);
});
test('database V2: opening hours and catalogue helpers are atomic and owner-scoped', async () => {
  await db.exec(`select public.np_save_opening_hours('[{"weekday":1,"start_min":540,"end_min":720},{"weekday":1,"start_min":810,"end_min":1140}]'::jsonb)`);
  assert.equal((await db.query('select * from public.np_opening_hours')).rows.length, 2);
  await assert.rejects(db.exec(`select public.np_save_opening_hours('[{"weekday":2,"start_min":540,"end_min":720},{"weekday":2,"start_min":700,"end_min":800}]'::jsonb)`), /exclusion|conflicting/);
  assert.equal((await db.query('select * from public.np_opening_hours')).rows.length, 2, 'rolled back');
  await assert.rejects(db.exec(`select public.np_save_opening_hours('${JSON.stringify([0, 1, 2, 3].map(i => ({ weekday: 3, start_min: i * 120, end_min: i * 120 + 60 })))}'::jsonb)`), /Trois plages/);
  await db.exec(`insert into public.np_services(id,trade,name,duration_min) values('00000000-0000-4000-8000-0000000000b1','nails','Pose',120)`);
  await db.exec(`select public.np_reorder_services(array['00000000-0000-4000-8000-0000000000b1','${service}']::uuid[])`);
  assert.deepEqual((await db.query('select name, position from public.np_services order by position')).rows, [{ name: 'Pose', position: 0 }, { name: 'Remplissage', position: 1 }]);
  const page = (await db.query('select public.np_public_page($1) as p', [slug])).rows[0].p;
  assert.deepEqual(page.services.map(s => s.name), ['Pose', 'Remplissage']);
});
test('database V2: slugs — reserved refused, availability, case-insensitive lookup', async () => {
  await assert.rejects(db.exec(`update public.np_public_profiles set slug='admin'`), /check constraint/);
  await assert.rejects(db.exec(`update public.np_public_profiles set slug='a--b'`), /check constraint/);
  assert.equal((await db.query(`select public.np_slug_available('sofia-coiffure') as x`)).rows[0].x, false);
  assert.equal((await db.query(`select public.np_slug_available($1) as x`, [slug])).rows[0].x, true, 'own slug');
  assert.equal((await db.query(`select public.np_slug_available('nouveau-lien') as x`)).rows[0].x, true);
  await asAnon();
  assert.equal((await db.query(`select public.np_public_page(' INES-ONGLES ') as p`)).rows[0].p.slug, slug);
});
test('database V2: client deletion cascades addresses/notifications; account deletion unpublishes', async () => {
  await book('done', "now() - interval '30 days'", { location_type: "'client'", address_line: "'2 rue A'", postal_code: "'31000'", city: "'Toulouse'" });
  await db.exec(`insert into public.np_client_addresses(client_id,address_line,postal_code,city,is_primary) values('${client}','2 rue A','31000','Toulouse',true);
    select public.np_refresh_notifications();`);
  const exported = (await db.query(`select public.np_export_client('${client}') as x`)).rows[0].x;
  assert.equal(exported.addresses.length, 1); assert.equal(exported.appointments.length, 1); assert.equal(exported.consents.length, 2);
  await db.exec(`select public.np_delete_client('${client}')`);
  for (const table of ['np_clients', 'np_client_addresses', 'np_notifications', 'np_consents'])
    assert.equal((await db.query(`select * from public.${table} where owner_id='${owner}'`)).rows.length, 0, table);
  const a = (await db.query(`select client_id, address_line, city, anonymized_at, price_cents from public.np_appointments`)).rows[0];
  assert.deepEqual([a.client_id, a.address_line, a.city], [null, '', '']); assert.ok(a.anonymized_at);
  await assert.rejects(db.exec(`select public.np_delete_client('${client}')`), errCode('NP404'));
  await db.exec('select public.np_request_account_deletion()');
  await asAnon();
  assert.equal((await db.query('select public.np_public_page($1) as p', [slug])).rows[0].p, null);
  await assert.rejects(sqlSlots(), errCode('NP404'));
  await assert.rejects(request(await iso('10:00')), errCode('NP404'));
});

// ===========================================================================
// Audit sécurité 2026-10 (docs/AUDIT-SECURITE.md) — non-régression
// ===========================================================================
test('audit: a known phone with another name never hijacks the existing client record', async () => {
  await asAdmin();
  await db.exec(`update public.np_clients set refill_opt_in=false, email='' where id='${client}'`);
  await asAnon();
  await request(await iso('09:00'), { p_phone: '0600000001', p_first_name: 'Intrus', p_last_name: 'Inconnu', p_refill_opt_in: true, p_email: 'pirate@evil.test' });
  await as(owner);
  const victim = (await db.query(`select email, refill_opt_in from public.np_clients where id='${client}'`)).rows[0];
  assert.deepEqual([victim.email, victim.refill_opt_in], ['', false], 'victim record untouched');
  assert.equal((await db.query(`select * from public.np_consents where client_id='${client}' and source='online_form'`)).rows.length, 0);
  const appt = (await db.query(`select a.client_id, c.name, c.phone from public.np_appointments a join public.np_clients c on c.id=a.client_id where a.source='online'`)).rows[0];
  assert.notEqual(appt.client_id, client); assert.equal(appt.name, 'Intrus Inconnu'); assert.equal(appt.phone, '+33600000001');
});
test('audit: spoofed X-Forwarded-For does not bypass the IP limit when cf-connecting-ip is present', async () => {
  await asAnon();
  const starts = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'];
  for (const [i, t] of starts.entries()) {
    await db.exec(`set request.headers = '{"cf-connecting-ip":"203.0.113.7","x-forwarded-for":"10.0.0.${i}, 198.51.100.1"}'`);
    const run = request(await iso(t), { p_phone: `06000000${10 + i}` });
    if (i < 5) await run; else await assert.rejects(run, errCode('NP429'));
  }
  await db.exec(`reset request.headers`);
});
test('audit: junk IP header is ignored, per-pro hourly cap stops phone rotation', async () => {
  await asAdmin();
  await db.exec(`insert into public.np_booking_attempts(owner_id, phone_key, ip_key) select '${owner}', md5('x' || g), null from generate_series(1, 20) g`);
  await asAnon();
  await db.exec(`set request.headers = '{"x-forwarded-for":"<script>, 1.1.1.1"}'`);
  await assert.rejects(request(await iso('09:00'), { p_phone: '0677777777' }), errCode('NP429'));
  await db.exec(`reset request.headers`);
  await asAdmin();
  await db.exec(`update public.np_booking_attempts set created_at = now() - interval '2 hours'`);
  await asAnon();
  assert.equal((await request(await iso('09:00'), { p_phone: '0677777777' })).rows[0].r.status, 'pending');
});
test('audit: per-pro cap of 15 live pending online requests', async () => {
  await asAdmin();
  await db.exec(`insert into public.np_appointments(owner_id,client_id,service_name,duration_min,starts_at,status,source,expires_at)
    select '${owner}','${client}'::uuid,'X',60,(('${day}'::date + g) + time '10:00') at time zone 'Europe/Paris','pending','online',now()+interval '1 hour'
    from generate_series(1, 15) g`);
  await asAnon();
  await assert.rejects(request(await iso('09:00'), { p_phone: '0688888888' }), errCode('NP429'));
});
test('audit: over-long public input is refused with NP422, never a constraint error leaking the row', async () => {
  await asAnon();
  const long = 'x'.repeat(201);
  await assert.rejects(request(await iso('10:00'), { p_location: 'client', p_address_line: long, p_postal_code: '31200', p_city: 'Toulouse' }), errCode('NP422'));
  await assert.rejects(request(await iso('10:00'), { p_location: 'client', p_address_line: '1 rue A', p_postal_code: '31200', p_city: 'y'.repeat(81) }), errCode('NP422'));
  const r = (await request(await iso('10:00'), { p_first_name: 'a'.repeat(60), p_last_name: 'b'.repeat(60), p_phone: '0612345678' })).rows[0].r;
  assert.equal(r.status, 'pending', '60 + 60 characters fit the 120-character name');
});
test('audit: anon and authenticated cannot use the rate-limit sequence', async () => {
  for (const role of [asAnon, () => as(owner)]) {
    await role();
    await assert.rejects(db.query(`select nextval('public.np_booking_attempts_id_seq')`), /permission denied/);
  }
});
