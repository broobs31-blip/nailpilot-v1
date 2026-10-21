import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

// Executes the actual bootstrap SQL in isolated PostgreSQL/WASM. This does not
// connect to Supabase, does not test PostgREST/Auth, and creates no hosted DB.
let db;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const client = '00000000-0000-4000-8000-000000000003';
const foreignClient = '00000000-0000-4000-8000-000000000004';
const appointment = '00000000-0000-4000-8000-000000000005';
async function as(user) { await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`); }
async function book(status = 'booked', start = "now() + interval '2 hours'") {
  await db.exec(`insert into public.np_appointments(id,client_id,service,starts_at,ends_at,status) values('${appointment}','${client}','Remplissage',${start},(${start})+interval '1 hour','${status}');`);
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
  await db.exec(`set role none; truncate public.np_notifications,public.np_appointments,public.np_clients,auth.users cascade;
    insert into auth.users(id) values('${owner}'),('${other}');
    insert into public.np_clients(id,owner_id,name,reminder_opt_in,refill_opt_in) values('${client}','${owner}','Cliente test',true,true),('${foreignClient}','${other}','Autre test',true,true);`);
  await as(owner);
});
after(async () => { await db?.close(); });

test('database: RLS isolates clients, appointments and notifications', async () => {
  await book(); await db.exec('select public.np_refresh_notifications();');
  assert.equal((await db.query('select * from public.np_clients')).rows.length, 1);
  await as(other);
  for (const table of ['np_appointments', 'np_notifications', 'np_due_notifications']) assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0);
  assert.equal((await db.query(`update public.np_clients set name='Intrusion' where id='${client}' returning *`)).rows.length, 0);
  await assert.rejects(db.exec(`insert into public.np_clients(owner_id,name) values('${owner}','Intrusion')`), /row-level security/);
});
test('database: anonymous access is denied', async () => {
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.np_clients'), /permission denied/);
  await assert.rejects(db.exec('select public.np_refresh_notifications()'), /permission denied/);
});
test('database: owner reassignment and foreign-client references rejected', async () => {
  await assert.rejects(db.exec(`update public.np_clients set owner_id='${other}' where id='${client}'`), /row-level security/);
  await assert.rejects(db.exec(`insert into public.np_appointments(client_id,service,starts_at,ends_at) values('${foreignClient}','Remplissage',now(),now()+interval '1 hour')`), /Cliente introuvable/);
});
test('database: GiST prevents collisions and allows adjacent slots', async () => {
  await book();
  await assert.rejects(db.exec(`insert into public.np_appointments(client_id,service,starts_at,ends_at) values('${client}','Remplissage',now()+interval '2 hours 30 minutes',now()+interval '3 hours 30 minutes')`), /exclusion constraint/);
  await db.exec(`insert into public.np_appointments(client_id,service,starts_at,ends_at) values('${client}','Remplissage',now()+interval '4 hours',now()+interval '5 hours')`);
  // Reuse the exact existing end, avoiding independently evaluated now().
  await db.exec(`insert into public.np_appointments(client_id,service,starts_at,ends_at) select client_id,service,ends_at,ends_at+interval '1 hour' from public.np_appointments where id='${appointment}'`);
});
test('database: reminders idempotent, dismissed preserved, reschedule regenerates', async () => {
  await book();
  await db.exec('select public.np_refresh_notifications(); select public.np_refresh_notifications();');
  assert.equal((await db.query('select * from public.np_notifications')).rows.length, 1);
  await db.exec("update public.np_notifications set status='dismissed'; select public.np_refresh_notifications();");
  assert.equal((await db.query('select status from public.np_notifications')).rows[0].status, 'dismissed');
  await db.exec(`update public.np_appointments set starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' where id='${appointment}'; select public.np_refresh_notifications();`);
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
  await db.exec(`insert into public.np_appointments(client_id,service,starts_at,ends_at) values('${client}','Remplissage',now()+interval '7 days',now()+interval '7 days 1 hour'); select public.np_refresh_notifications();`);
  assert.equal((await db.query("select * from public.np_notifications where kind='refill' and status='ready'")).rows.length, 0);
  await db.exec("update public.np_appointments set status='cancelled' where status='booked'; select public.np_refresh_notifications();");
  assert.equal((await db.query("select * from public.np_notifications where kind='refill' and status='ready'")).rows.length, 1);
});
test('database: archive guard and archived client booking guard', async () => {
  await book();
  await assert.rejects(db.exec(`update public.np_clients set archived=true where id='${client}'`), /Annulez/);
  await db.exec(`update public.np_appointments set status='cancelled' where id='${appointment}'; update public.np_clients set archived=true where id='${client}';`);
  await assert.rejects(db.exec(`insert into public.np_appointments(client_id,service,starts_at,ends_at) values('${client}','Remplissage',now(),now()+interval '1 hour')`), /archivée/);
});
