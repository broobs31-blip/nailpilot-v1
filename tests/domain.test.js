import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClient, validateAppointment, fromParisLocal, parisLocal, escapeHtml, normalizePhone, reconcileNotifications, refillDueAt } from '../src/domain.js';

// V1 behaviours first (legacy validateAppointment signature kept while src/app.js V1 is replaced), then V2 rules.

const now = new Date('2026-10-21T10:00:00Z');
const client = { id: 'c1', name: 'Test', refill_days: 21, reminder_opt_in: true, refill_opt_in: true };
const appointment = { id: 'a1', client_id: 'c1', service: 'Remplissage', starts_at: '2026-10-22T08:00:00Z', ends_at: '2026-10-22T09:00:00Z', status: 'booked' };
const completed = { ...appointment, id: 'a2', starts_at: '2026-09-29T08:00:00Z', ends_at: '2026-09-29T09:00:00Z', status: 'done' };

test('client: trims fields and normalizes French phone', () => {
  const result = validateClient({ name: ' Camille ', phone: '06 12 34 56 78', email: 'TEST@EXAMPLE.ORG', refill_days: '21', refill_opt_in: true });
  assert.equal(result.name, 'Camille'); assert.equal(result.phone, '+33612345678'); assert.equal(result.email, 'test@example.org'); assert.equal(result.reminder_opt_in, false);
});
for (const [label, changes] of [['name', { name: '' }], ['phone', { phone: '123' }], ['email', { email: 'invalid' }], ['interval', { refill_days: 2 }], ['notes', { notes: 'x'.repeat(2001) }]]) {
  test(`client rejects invalid ${label}`, () => assert.throws(() => validateClient({ name: 'Test', ...changes })));
}
test('international phone formats', () => { assert.equal(normalizePhone('0032 471 12 34 56'), '+32471123456'); assert.equal(normalizePhone(''), ''); });
test('stored markup is escaped', () => assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));
test('Paris summer and winter offsets', () => {
  assert.equal(fromParisLocal('2026-07-01T10:00'), '2026-07-01T08:00:00.000Z');
  assert.equal(fromParisLocal('2026-12-01T10:00'), '2026-12-01T09:00:00.000Z');
  assert.equal(parisLocal('2026-12-01T09:00:00Z'), '2026-12-01T10:00');
});
test('DST gaps, duplicate times and impossible dates are rejected', () => {
  for (const date of ['2026-03-29T02:30', '2026-10-25T02:30', '2026-02-30T10:00', 'not-a-date']) assert.throws(() => fromParisLocal(date));
});
test('calendar refill days preserve Paris hour across DST', () => assert.equal(refillDueAt({ ends_at: '2026-10-10T09:00:00Z' }, 21), '2026-10-31T10:00:00.000Z'));
test('automatic refill dates resolve DST transition hour like PostgreSQL', () => {
  assert.equal(refillDueAt({ ends_at: '2026-10-04T00:30:00Z' }, 21), '2026-10-25T01:30:00.000Z');
  assert.equal(refillDueAt({ ends_at: '2026-03-08T01:30:00Z' }, 21), '2026-03-29T01:30:00.000Z');
});
test('appointment overlap blocked including full containment', () => {
  assert.throws(() => validateAppointment({ ...appointment, id: 'other', starts_at: '2026-10-22T07:00:00Z', ends_at: '2026-10-22T10:00:00Z' }, [appointment], [client]), /chevauche/);
});
test('adjacent slots and cancelled slots do not overlap', () => {
  assert.doesNotThrow(() => validateAppointment({ ...appointment, id: 'other', starts_at: appointment.ends_at, ends_at: '2026-10-22T10:00:00Z' }, [appointment], [client]));
  assert.doesNotThrow(() => validateAppointment({ ...appointment, id: 'other' }, [{ ...appointment, status: 'cancelled' }], [client]));
});
test('editing self does not conflict', () => assert.doesNotThrow(() => validateAppointment(appointment, [appointment], [client])));
test('unknown or archived client, negative duration and unknown service are rejected', () => {
  assert.throws(() => validateAppointment(appointment, [], []));
  assert.throws(() => validateAppointment(appointment, [], [{ ...client, archived: true }]));
  assert.throws(() => validateAppointment({ ...appointment, ends_at: appointment.starts_at }, [], [client]));
  assert.throws(() => validateAppointment({ ...appointment, service: 'invalid' }, [], [client]));
});
test('only due reminders appear and generation is idempotent', () => {
  const once = reconcileNotifications([], [client], [appointment], now);
  const twice = reconcileNotifications(once, [client], [appointment], now);
  assert.equal(once.length, 1); assert.deepEqual(twice, once); assert.equal(once[0].status, 'ready');
  assert.equal(reconcileNotifications([], [client], [appointment], '2026-10-20T10:00:00Z').length, 0);
});
test('dismissed reminder stays dismissed until appointment changes', () => {
  const first = reconcileNotifications([], [client], [appointment], now).map(n => ({ ...n, status: 'dismissed' }));
  assert.equal(reconcileNotifications(first, [client], [appointment], now)[0].status, 'dismissed');
  const moved = { ...appointment, starts_at: '2026-10-22T09:00:00Z', ends_at: '2026-10-22T10:00:00Z' };
  assert.equal(reconcileNotifications(first, [client], [moved], now)[0].status, 'ready');
});
test('cancel, past appointment, archive and withdrawn consent invalidate reminders', () => {
  const first = reconcileNotifications([], [client], [appointment], now);
  for (const [clients, appointments, time] of [
    [[client], [{ ...appointment, status: 'cancelled' }], now],
    [[client], [appointment], '2026-10-22T10:00:00Z'],
    [[{ ...client, archived: true }], [appointment], now],
    [[{ ...client, reminder_opt_in: false }], [appointment], now]
  ]) assert.equal(reconcileNotifications(first, clients, appointments, time)[0].status, 'invalidated');
});
test('refill requires completed appointment, consent, and elapsed interval', () => {
  assert.equal(reconcileNotifications([], [client], [completed], now)[0].kind, 'refill');
  assert.equal(reconcileNotifications([], [{ ...client, refill_opt_in: false }], [completed], now).length, 0);
  assert.equal(reconcileNotifications([], [client], [{ ...completed, status: 'cancelled' }], now).length, 0);
  assert.equal(reconcileNotifications([], [{ ...client, refill_days: 30 }], [completed], now).length, 0);
});
test('future booking suppresses refill, cancellation restores it', () => {
  assert.equal(reconcileNotifications([], [client], [completed, appointment], now).filter(n => n.kind === 'refill').length, 0);
  assert.equal(reconcileNotifications([], [client], [completed, { ...appointment, status: 'cancelled' }], now).filter(n => n.kind === 'refill').length, 1);
});
test('only latest completed appointment triggers refill', () => {
  const recent = { ...completed, id: 'recent', starts_at: '2026-10-20T08:00:00Z', ends_at: '2026-10-20T09:00:00Z' };
  assert.equal(reconcileNotifications([], [client], [completed, recent], now).length, 0);
});

// ===========================================================================
// V2 — every scheduling rule here has its SQL mirror in tests/database.test.js
// ===========================================================================
import { readFileSync } from 'node:fs';
import * as D from '../src/domain.js';

const PROFILE = { ...D.DEFAULT_PROFILE, trades: ['nails'], work_mode: 'both', base_address_line: '1 rue Privée', base_postal_code: '31000', base_city: 'Toulouse', zone_postal_codes: ['31000', '31200'], min_notice_min: 0, max_horizon_days: 366 };
const SERVICE = { id: 's1', trade: 'nails', name: 'Remplissage', duration_min: 60, price_cents: 4000, prep_min: 10, allowed_locations: 'both', refill_enabled: true, refill_days: 21, online: true, archived: false };
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start_min: 540, end_min: 1140 }));
const P = local => D.fromParisLocal(local);
const DAY = '2026-11-18'; // a Wednesday, standard time (UTC+1)
const NOW = new Date('2026-11-10T08:00:00Z');
const appt = (local, extra = {}) => ({ id: `a-${local}`, client_id: 'c1', service_name: 'X', duration_min: 60, buffer_before_min: 0, buffer_after_min: 0, status: 'booked', starts_at: P(local), ...extra });
const home = { location_type: 'client', buffer_before_min: 30, buffer_after_min: 30 };
const slots = (extra = {}) => D.availableSlots({ profile: PROFILE, openingHours: ALL_WEEK, closures: [], appointments: [], service: SERVICE, location: 'pro', from: DAY, to: DAY, now: NOW, ...extra });
const local = list => list.map(x => D.parisLocal(x).slice(11));

test('v2 formatting: prices, durations, times, days', () => {
  assert.equal(D.formatPrice(5500), '55,00 €'); assert.equal(D.formatPrice(0), '0,00 €'); assert.equal(D.formatPrice(150050), '1 500,50 €');
  assert.equal(D.formatPrice(null), 'Sur devis'); assert.equal(D.formatPrice(undefined), 'Sur devis');
  assert.equal(D.formatDuration(45), '45 min'); assert.equal(D.formatDuration(90), '1 h 30'); assert.equal(D.formatDuration(120), '2 h'); assert.equal(D.formatDuration(65), '1 h 05');
  assert.equal(D.minutesToTime(570), '09:30'); assert.equal(D.minutesToTime(1440), '24:00'); assert.equal(D.timeToMinutes('13:30'), 810); assert.equal(D.timeToMinutes('9:05'), 545);
  for (const bad of ['25:00', '12:60', 'midi', '']) assert.throws(() => D.timeToMinutes(bad));
  assert.throws(() => D.minutesToTime(1441));
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01'); assert.equal(D.addDays('2026-03-01', -1), '2026-02-28'); assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.isoWeekday('2026-10-25'), 7); assert.equal(D.isoWeekday('2026-10-26'), 1);
  assert.deepEqual(D.weekDays('2026-10-25'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(D.weekDays('2026-10-26')[0], '2026-10-26');
  assert.throws(() => D.addDays('2026-02-30', 1));
  assert.equal(D.formatTime('2026-11-18T08:30:00Z'), '9 h 30'); assert.equal(D.formatTime('2026-07-01T12:00:00Z'), '14 h');
});
test('v2 lenient Paris conversion matches PostgreSQL AT TIME ZONE', () => {
  assert.equal(D.parisLenient('2026-03-29T02:30'), '2026-03-29T01:30:00.000Z');
  assert.equal(D.parisLenient('2026-10-25T02:30'), '2026-10-25T01:30:00.000Z');
  assert.equal(D.parisLenient('2026-07-01T10:00'), '2026-07-01T08:00:00.000Z');
});
test('v2 constants mirror SQL: reserved slugs and catalogue validity', () => {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const list = /slug <> all \(array\[([^\]]+)\]/.exec(sql)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
  assert.deepEqual([...D.RESERVED_SLUGS].sort(), list.sort());
  for (const trade of Object.keys(D.TRADES)) {
    assert.ok(D.DEFAULT_CATALOG[trade].length >= 4, trade);
    for (const s of D.DEFAULT_CATALOG[trade]) assert.deepEqual({ ...D.validateService(s), position: 0, archived: false }, { ...s, position: 0, archived: false });
  }
  assert.ok(D.DEFAULT_CATALOG.nails.some(s => s.name === 'Remplissage' && s.duration_min === 90 && s.price_cents === 4000));
  assert.deepEqual(Object.keys(D.DEFAULT_TEMPLATES), ['confirmation', 'decline', 'reminder', 'refill']);
});
test('v2 slugs: suggestion, reserved words and format', () => {
  assert.equal(D.slugify('Inès Ongles & Co'), 'ines-ongles-co'); assert.equal(D.slugify('  Léa — Make-up  '), 'lea-make-up');
  assert.equal(D.slugify('Admin'), 'admin-beaute'); assert.equal(D.slugify('a'), ''); assert.equal(D.slugify('x'.repeat(60)).length, 40);
  assert.equal(D.validateSlug(' Sofia-Coiffure '), 'sofia-coiffure');
  for (const bad of ['ab', 'login', 'a--b', '-abc', 'abc-', 'é-test', 'x'.repeat(41)]) assert.throws(() => D.validateSlug(bad), bad);
});
test('v2 profile validation: trades, base address, zone, bounds, public fields', () => {
  const base = { trades: ['nails'], work_mode: 'home_studio', base_address_line: '1 rue A', base_postal_code: '31000', base_city: 'Toulouse', slug: 'ines-ongles', display_name: 'Inès' };
  const { profile, publicProfile } = D.validateProfile({ ...base, zone_postal_codes: '31000, 31200;31000', instagram: 'https://www.instagram.com/ines.nails/', bio: ' Bonjour ' });
  assert.deepEqual(profile.zone_postal_codes, ['31000', '31200']); assert.equal(profile.travel_buffer_min, 30); assert.equal(profile.min_notice_min, 720);
  assert.equal(publicProfile.instagram, 'ines.nails'); assert.equal(publicProfile.city, 'Toulouse'); assert.equal(publicProfile.bio, 'Bonjour'); assert.equal(publicProfile.published, false);
  assert.equal(D.validateProfile({ ...base, work_mode: 'mobile', base_address_line: '', base_postal_code: '', base_city: '' }).profile.work_mode, 'mobile');
  for (const [label, change] of [['no trade', { trades: [] }], ['bad trade', { trades: ['spa'] }], ['no base address', { base_address_line: '' }],
    ['bad postal', { base_postal_code: '3100' }], ['bad zone', { zone_postal_codes: '31000,abc' }], ['step', { slot_step_min: 20 }],
    ['buffer', { travel_buffer_min: 121 }], ['notice', { min_notice_min: 10081 }], ['horizon', { max_horizon_days: 6 }], ['bio', { bio: 'x'.repeat(301) }],
    ['name', { display_name: ' ' }], ['slug', { slug: 'api' }], ['instagram', { instagram: 'bad handle!' }], ['radius', { zone_radius_km: 0 }], ['template', { template_reminder: 'x'.repeat(1001) }]])
    assert.throws(() => D.validateProfile({ ...base, ...change }), label);
});
test('v2 opening hours: ≤ 3 ranges a day, no overlap, 5-minute grid, HH:mm input', () => {
  assert.deepEqual(D.validateOpeningHours([{ weekday: 2, start: '13:30', end: '19:00' }, { weekday: 2, start_min: 540, end_min: 720 }]),
    [{ weekday: 2, start_min: 540, end_min: 720 }, { weekday: 2, start_min: 810, end_min: 1140 }]);
  assert.doesNotThrow(() => D.validateOpeningHours([{ weekday: 1, start_min: 540, end_min: 720 }, { weekday: 1, start_min: 720, end_min: 800 }]));
  assert.throws(() => D.validateOpeningHours([{ weekday: 1, start_min: 540, end_min: 720 }, { weekday: 1, start_min: 700, end_min: 800 }]), /chevaucher/);
  assert.throws(() => D.validateOpeningHours([0, 1, 2, 3].map(i => ({ weekday: 3, start_min: i * 120, end_min: i * 120 + 60 }))), /Trois/);
  for (const bad of [{ weekday: 0, start_min: 0, end_min: 60 }, { weekday: 1, start_min: 543, end_min: 600 }, { weekday: 1, start_min: 600, end_min: 600 }, { weekday: 1, start_min: 0, end_min: 1445 }])
    assert.throws(() => D.validateOpeningHours([bad]));
  assert.deepEqual(D.validateOpeningHours([]), []);
});
test('v2 closures: whole days (incl. 25-hour DST day), local ranges, ISO ranges', () => {
  const dst = D.validateClosure({ day: '2026-10-25', allDay: true, reason: 'Congés' });
  assert.equal(dst.starts_at, '2026-10-24T22:00:00.000Z'); assert.equal(dst.ends_at, '2026-10-25T23:00:00.000Z'); assert.equal(dst.reason, 'Congés');
  assert.equal(D.validateClosure({ day: '2026-12-24', toDay: '2026-12-26' }).ends_at, '2026-12-26T23:00:00.000Z');
  assert.deepEqual(D.validateClosure({ from: '2026-11-18T12:00', to: '2026-11-18T14:00' }), { starts_at: '2026-11-18T11:00:00.000Z', ends_at: '2026-11-18T13:00:00.000Z', reason: '' });
  assert.equal(D.validateClosure({ day: '2026-11-18', allDay: false, from: '09:00', to: '10:00' }).ends_at, '2026-11-18T09:00:00.000Z');
  assert.throws(() => D.validateClosure({ from: '2026-11-18T14:00', to: '2026-11-18T12:00' }));
  assert.throws(() => D.validateClosure({ day: '2026-11-18', toDay: '2026-11-17' }));
  assert.throws(() => D.validateClosure({ starts_at: '2026-01-01T00:00:00Z', ends_at: '2027-06-01T00:00:00Z' }), /366/);
  assert.throws(() => D.validateClosure({ day: '2026-11-18', reason: 'x'.repeat(121) }));
});
test('v2 services: bounds, euro parsing, quote price, defaults', () => {
  const s = D.validateService({ name: ' Pose ', duration_min: 120, price: '55,50' });
  assert.equal(s.name, 'Pose'); assert.equal(s.price_cents, 5550); assert.equal(s.allowed_locations, 'both'); assert.equal(s.prep_min, 10); assert.equal(s.online, true); assert.equal(s.refill_days, null);
  assert.equal(D.validateService({ name: 'Devis', duration_min: 60, price: '' }).price_cents, null);
  assert.equal(D.validateService({ name: 'Devis', duration_min: 60, price_cents: null }).price_cents, null);
  for (const bad of [{ duration_min: 10 }, { duration_min: 485 }, { duration_min: 62 }, { price: '2000,01' }, { price: '-1' }, { name: '' }, { name: 'x'.repeat(81) },
    { allowed_locations: 'salon' }, { prep_min: 61 }, { refill_days: 6 }, { trade: 'spa' }, { description: 'x'.repeat(301) }])
    assert.throws(() => D.validateService({ name: 'Ok', duration_min: 60, ...bad }), JSON.stringify(bad));
});
test('v2 clients and addresses', () => {
  const c = D.validateClient({ name: 'Nora Test', preferred_name: ' Nono ', source: 'instagram' });
  assert.equal(c.preferred_name, 'Nono'); assert.equal(c.source, 'instagram'); assert.equal(c.refill_opt_in, false);
  assert.equal(D.validateClient({ name: 'X' }).source, 'manual');
  assert.throws(() => D.validateClient({ name: 'X', source: 'tiktok' }));
  assert.deepEqual(D.validateAddress({ line: '2 rue A', postalCode: '31000', city: 'Toulouse', accessInfo: 'Code 12' }), { label: '', address_line: '2 rue A', postal_code: '31000', city: 'Toulouse', access_info: 'Code 12', is_primary: false });
  for (const bad of [{ postal_code: '310' }, { address_line: '' }, { city: '' }, { access_info: 'x'.repeat(301) }])
    assert.throws(() => D.validateAddress({ address_line: '2 rue A', postal_code: '31000', city: 'Toulouse', ...bad }));
});

test('R1 buffers: pro = 0 / prep, client = travel both sides', () => {
  assert.deepEqual(D.computeBuffers({ location_type: 'pro', service: SERVICE, profile: PROFILE }), { before: 0, after: 10 });
  assert.deepEqual(D.computeBuffers({ location_type: 'pro', service: { ...SERVICE, prep_min: 0 }, profile: PROFILE }), { before: 0, after: 0 });
  assert.deepEqual(D.computeBuffers({ location_type: 'client', service: SERVICE, profile: { ...PROFILE, travel_buffer_min: 45 } }), { before: 45, after: 45 });
  assert.deepEqual(D.computeBuffers({ location_type: 'client' }), { before: 30, after: 30 });
  assert.deepEqual(D.blockRange(appt('2026-11-18T10:00', home)), { starts_at: '2026-11-18T09:00:00.000Z', ends_at: '2026-11-18T10:00:00.000Z', block_start: '2026-11-18T08:30:00.000Z', block_end: '2026-11-18T10:30:00.000Z' });
});
test('R1 max rule: buffers never stack (mirror of SQL test)', () => {
  const a = appt('2026-11-18T10:00', home);
  const b = start => ({ ...appt(start, home), id: 'b', duration_min: 45 });
  assert.ok(D.conflicts(b('2026-11-18T11:20'), [a]));
  assert.equal(D.conflicts(b('2026-11-18T11:30'), [a]), null);
  // Before the first one: B ends 9:30 (block_end 10:00) vs A starts 10:00 (block_start 9:30).
  assert.equal(D.conflicts({ ...b('2026-11-18T09:15'), duration_min: 15 }, [a]), null);
  assert.ok(D.conflicts({ ...b('2026-11-18T09:20'), duration_min: 15 }, [a]));
});
test('R1 mixed locations: gap = max(after A, before B)', () => {
  const studio = appt('2026-11-18T10:00', { buffer_after_min: 10 });
  assert.ok(D.conflicts(appt('2026-11-18T11:05'), [studio]));
  assert.equal(D.conflicts(appt('2026-11-18T11:10'), [studio]), null);
  assert.ok(D.conflicts(appt('2026-11-18T11:20', home), [studio]), 'travel 30 > prep 10');
  assert.equal(D.conflicts(appt('2026-11-18T11:30', home), [studio]), null);
  assert.ok(D.conflicts(appt('2026-11-18T10:30'), [studio]), 'plain overlap');
  assert.ok(D.conflicts(appt('2026-11-18T09:00', { duration_min: 240 }), [studio]), 'containment');
});
test('R5/R8 blocking statuses: cancelled and expired pending never block', () => {
  const a = { ...appt('2026-11-18T10:00'), id: 'existing' };
  assert.equal(D.conflicts(appt('2026-11-18T10:00'), [{ ...a, status: 'cancelled' }]), null);
  for (const status of ['booked', 'done', 'no_show']) assert.ok(D.conflicts(appt('2026-11-18T10:00'), [{ ...a, status }]), status);
  const pending = { ...a, status: 'pending', expires_at: '2026-11-11T08:00:00Z' };
  assert.ok(D.conflicts(appt('2026-11-18T10:00'), [pending], NOW));
  assert.equal(D.conflicts(appt('2026-11-18T10:00'), [pending], '2026-11-11T08:00:00Z'), null);
  assert.equal(D.conflicts(appt('2026-11-18T10:00'), [{ ...pending, expired: true }], NOW), null);
  assert.equal(D.conflicts({ ...appt('2026-11-18T10:00'), status: 'cancelled' }, [a]), null, 'cancelled candidate');
  assert.equal(D.conflicts(a, [a]), null, 'self');
  assert.equal(D.isBlocking(pending, NOW), true); assert.equal(D.isBlocking(pending, '2026-12-01T00:00:00Z'), false);
});
test('R2/R4 slots: hours, grid from range start, buffered appointments (mirror of SQL test)', () => {
  const free = slots({ appointments: [appt('2026-11-18T14:00', { ...home, duration_min: 60 })] });
  assert.equal(local(free)[0], '09:00'); assert.equal(local(free).at(-1), '18:00');
  assert.ok(local(free).includes('12:30') && local(free).includes('15:30'));
  for (const t of ['13:00', '13:30', '14:00', '15:00']) assert.ok(!local(free).includes(t), t);
  const odd = slots({ openingHours: [{ weekday: 3, start_min: 555, end_min: 700 }] });
  assert.deepEqual(local(odd), ['09:15', '09:45', '10:15']);
  assert.deepEqual(local(slots({ openingHours: [{ weekday: 3, start_min: 540, end_min: 660 }], profile: { ...PROFILE, slot_step_min: 60 } })), ['09:00', '10:00']);
  assert.equal(slots({ openingHours: [{ weekday: 4, start_min: 540, end_min: 660 }] }).length, 0, 'closed weekday');
  assert.equal(slots({ openingHours: [{ weekday: 3, start_min: 540, end_min: 580 }] }).length, 0, 'range shorter than service');
});
test('R2 slots: closures, multi-day, 31-day cap', () => {
  const closure = D.validateClosure({ from: '2026-11-18T12:00', to: '2026-11-18T14:00' });
  const free = local(slots({ closures: [closure] }));
  assert.ok(free.includes('11:00') && free.includes('14:00') && !free.includes('11:30') && !free.includes('13:30'));
  assert.equal(slots({ closures: [D.validateClosure({ day: DAY })] }).length, 0);
  assert.equal(slots({ to: '2026-11-20' }).length, 3 * 19);
  assert.throws(() => slots({ to: '2026-12-31' }), /31 jours/);
  assert.throws(() => slots({ to: '2026-11-17' }), /Période/);
});
test('R3 slots: minimum notice and maximum horizon', () => {
  const now = P('2026-11-18T10:10');
  assert.equal(local(slots({ now, profile: { ...PROFILE, min_notice_min: 120 } }))[0], '12:30');
  assert.equal(slots({ now: new Date('2026-09-01T00:00:00Z'), profile: { ...PROFILE, max_horizon_days: 60 } }).length, 0);
  // now + 60 × 24 h (PostgreSQL interval in a UTC session): 10:00 CEST + 60 days = 09:00 CET, inclusive.
  assert.equal(local(slots({ now: P('2026-09-19T10:00'), profile: { ...PROFILE, max_horizon_days: 60 } })).at(-1), '09:00');
});
test('R2 DST: no slot in the missing spring hour nor the repeated autumn hour', () => {
  const night = [{ weekday: 7, start_min: 0, end_min: 360 }];
  const spring = local(slots({ openingHours: night, from: '2027-03-28', to: '2027-03-28', now: new Date('2027-03-01T00:00:00Z') }));
  assert.ok(!spring.includes('02:00') && !spring.includes('02:30') && spring.includes('01:00') && spring.includes('03:00'));
  assert.ok(spring.includes('01:30'), '01:30 + 60 min ends at 03:30: a real 60-minute instant range');
  const autumn = slots({ openingHours: night, from: '2026-10-25', to: '2026-10-25', now: new Date('2026-10-01T00:00:00Z') });
  assert.ok(!local(autumn).includes('02:00') && !local(autumn).includes('02:30') && local(autumn).includes('03:00'));
  assert.equal(new Set(autumn).size, autumn.length);
});
test('F6 slots: location rules and zone (NP403 mirror)', () => {
  assert.throws(() => slots({ location: 'client', postalCode: '75001' }), e => e.code === 'forbidden_location');
  assert.ok(slots({ location: 'client', postalCode: '31200' }).length > 0);
  assert.ok(slots({ location: 'client' }).length > 0, 'no postal code yet → no zone check');
  assert.throws(() => slots({ profile: { ...PROFILE, work_mode: 'mobile' } }), e => e.code === 'forbidden_location');
  assert.throws(() => slots({ location: 'client', profile: { ...PROFILE, work_mode: 'home_studio' } }), e => e.code === 'forbidden_location');
  assert.throws(() => slots({ service: { ...SERVICE, allowed_locations: 'client' } }), e => e.code === 'forbidden_location');
  assert.throws(() => slots({ location: 'salon' }));
  // Client location uses travel buffers on both sides.
  const free = local(slots({ location: 'client', appointments: [appt('2026-11-18T14:00')] }));
  assert.ok(free.includes('12:30') && !free.includes('13:00') && !free.includes('15:00') && free.includes('15:30'));
  assert.equal(D.isInZone(PROFILE, '31000'), true); assert.equal(D.isInZone(PROFILE, '75001'), false); assert.equal(D.isInZone({ zone_postal_codes: [] }, '75001'), true);
});
test('R5 pending expiry and blocking until it expires', () => {
  assert.equal(D.pendingExpiresAt('2026-11-18T09:00:00Z', { min_notice_min: 720 }, NOW), '2026-11-11T08:00:00.000Z');
  assert.equal(D.pendingExpiresAt('2026-11-10T20:00:00Z', { min_notice_min: 720 }, NOW), '2026-11-10T08:00:00.000Z');
  const pending = { ...appt('2026-11-18T10:00'), status: 'pending', expires_at: '2026-11-11T08:00:00Z' };
  assert.ok(!local(slots({ appointments: [pending] })).includes('10:00'));
  assert.ok(local(slots({ appointments: [pending], now: new Date('2026-11-12T00:00:00Z') })).includes('10:00'));
});
test('R6 transitions', () => {
  const future = appt('2026-11-18T10:00'), past = appt('2026-11-01T10:00');
  assert.deepEqual(D.allowedTransitions(future, NOW), ['done', 'cancelled']);
  assert.deepEqual(D.allowedTransitions(past, NOW), ['done', 'no_show', 'cancelled']);
  assert.ok(!D.allowedTransitions({ ...past, status: 'done' }, NOW).includes('cancelled'));
  assert.ok(!D.allowedTransitions({ ...past, status: 'no_show' }, NOW).includes('cancelled'));
  assert.deepEqual(D.allowedTransitions({ ...future, status: 'pending', expires_at: '2026-11-11T00:00:00Z' }, NOW), ['booked', 'cancelled']);
  assert.deepEqual(D.allowedTransitions({ ...future, status: 'pending', expires_at: '2026-11-09T00:00:00Z' }, NOW), []);
  assert.deepEqual(D.allowedTransitions({ ...future, status: 'cancelled' }, NOW), ['booked']);
  assert.deepEqual(D.allowedTransitions({ ...past, status: 'cancelled' }, NOW), []);
});

const ctx = (extra = {}) => ({ appointments: [], clients: [{ id: 'c1', name: 'Nora' }], services: [SERVICE], addresses: [{ id: 'ad1', client_id: 'c1', address_line: '2 rue A', postal_code: '31200', city: 'Toulouse', access_info: 'Code 1' }], profile: PROFILE, now: NOW, ...extra });
const input = (extra = {}) => ({ client_id: 'c1', service_id: 's1', location_type: 'pro', starts_at: P('2026-11-18T10:00'), ...extra });
test('v2 appointment: snapshots and R1 buffers, no derived fields', () => {
  const p = D.validateAppointment(input(), ctx());
  assert.equal(p.service_name, 'Remplissage'); assert.equal(p.duration_min, 60); assert.equal(p.price_cents, 4000); assert.equal(p.refill_days, 21);
  assert.equal(p.buffer_before_min, 0); assert.equal(p.buffer_after_min, 10); assert.equal(p.status, 'booked'); assert.equal(p.address_line, '');
  assert.ok(!('ends_at' in p) && !('block_start' in p) && !('block_end' in p));
  const c = D.validateAppointment(input({ location_type: 'client', address_id: 'ad1' }), ctx());
  assert.equal(c.buffer_before_min, 30); assert.equal(c.buffer_after_min, 30); assert.equal(c.city, 'Toulouse'); assert.equal(c.access_info, 'Code 1');
  const typed = D.validateAppointment(input({ location_type: 'client', address_line: '9 rue Z', postal_code: '31000', city: 'Toulouse', buffer_before_min: 0, duration_min: 75 }), ctx());
  assert.equal(typed.address_line, '9 rue Z'); assert.equal(typed.buffer_before_min, 0); assert.equal(typed.buffer_after_min, 30); assert.equal(typed.duration_min, 75);
  assert.equal(D.validateAppointment(input({ service_id: null, service_name: 'Retouche', duration_min: 20 }), ctx()).service_name, 'Retouche');
});
test('v2 appointment: rejections (client, service, location, address, overlap, status)', () => {
  const c = ctx({ appointments: [appt('2026-11-18T09:00', { id: 'x' })] });
  assert.throws(() => D.validateAppointment(input({ starts_at: P('2026-11-18T09:55') }), c), e => e.code === 'overlap' && /trajet/.test(e.message));
  assert.doesNotThrow(() => D.validateAppointment(input(), c), 'adjacent with 0 buffer after');
  assert.throws(() => D.validateAppointment(input({ client_id: 'nope' }), ctx()), /cliente/);
  assert.throws(() => D.validateAppointment(input(), ctx({ clients: [{ id: 'c1', archived: true }] })), /cliente/);
  assert.throws(() => D.validateAppointment(input(), ctx({ services: [{ ...SERVICE, archived: true }] })), /prestation/);
  assert.throws(() => D.validateAppointment(input(), ctx({ services: [{ ...SERVICE, allowed_locations: 'client' }] })), e => e.code === 'forbidden_location');
  assert.throws(() => D.validateAppointment(input({ location_type: 'client' }), ctx()), /postal|adresse/i);
  assert.throws(() => D.validateAppointment(input({ status: 'pending' }), ctx()), /en ligne/);
  assert.throws(() => D.validateAppointment(input({ status: 'no_show' }), ctx()), /absence/);
  assert.throws(() => D.validateAppointment(input({ buffer_after_min: 121 }), ctx()));
  assert.throws(() => D.validateAppointment(input({ duration_min: 481 }), ctx()));
  assert.throws(() => D.validateAppointment(input({ starts_at: 'demain' }), ctx()));
});
test('v2 appointment edits: frozen prices, R6 on past/done/expired', () => {
  const existing = { ...D.validateAppointment(input(), ctx()), id: 'a1', price_cents: 3500 };
  const c = ctx({ appointments: [existing], services: [{ ...SERVICE, price_cents: 9900 }] });
  assert.equal(D.validateAppointment({ id: 'a1', starts_at: P('2026-11-18T11:00') }, c).price_cents, 3500, 'price frozen');
  const past = { ...existing, starts_at: P('2026-11-01T10:00') };
  assert.throws(() => D.validateAppointment({ id: 'a1', starts_at: P('2026-11-02T10:00') }, ctx({ appointments: [past] })), /passé/);
  assert.equal(D.validateAppointment({ id: 'a1', status: 'done' }, ctx({ appointments: [past] })).status, 'done');
  assert.throws(() => D.validateAppointment({ id: 'a1', status: 'cancelled' }, ctx({ appointments: [{ ...past, status: 'done' }] })), /ne peut plus être annulé/);
  const expired = { ...existing, status: 'pending', expires_at: '2026-11-09T00:00:00Z' };
  assert.throws(() => D.validateAppointment({ id: 'a1', status: 'booked' }, ctx({ appointments: [expired] })), /expiré/);
  assert.throws(() => D.validateAppointment({ id: 'zz' }, ctx()), e => e.code === 'not_found');
  assert.equal(D.validateAppointment({ id: 'a1', status: 'cancelled', cancel_reason: 'Malade' }, c).cancel_reason, 'Malade');
});
test('v2 appointment warnings: outside hours, closure, outside zone', () => {
  const w = (i, extra = {}) => D.appointmentWarnings({ duration_min: 60, ...i }, { profile: PROFILE, openingHours: ALL_WEEK, closures: [], ...extra });
  assert.deepEqual(w({ starts_at: P('2026-11-18T10:00') }), []);
  assert.deepEqual(w({ starts_at: P('2026-11-18T18:30') }), ['outside_hours']);
  assert.deepEqual(w({ starts_at: P('2026-11-18T10:00') }, { closures: [D.validateClosure({ day: DAY })] }), ['closed']);
  assert.deepEqual(w({ starts_at: P('2026-11-18T10:00'), location_type: 'client', postal_code: '75001' }), ['outside_zone']);
});

test('F10 templates: variables, unknown placeholders, location phrase', () => {
  assert.equal(D.renderTemplate('Bonjour {prenom} {inconnu} {lien}', { prenom: 'Nora' }), 'Bonjour Nora {inconnu} ');
  const a = { starts_at: P('2026-11-18T09:30'), service_name: 'Remplissage', location_type: 'pro' };
  const msg = D.buildMessage('reminder', { appointment: a, client: { name: 'Nora Test' }, profile: PROFILE });
  assert.equal(msg, 'Bonjour Nora, petit rappel de votre rendez-vous remplissage le mercredi 18 novembre à 9 h 30, chez moi, 1 rue Privée, 31000 Toulouse. À bientôt !');
  const home2 = D.buildMessage('confirmation', { appointment: { ...a, location_type: 'client', address_line: '2 rue A', postal_code: '31200', city: 'Toulouse' }, client: { name: 'Nora Test', preferred_name: 'Nono' }, profile: PROFILE });
  assert.match(home2, /^Bonjour Nono, .* est confirmé, chez vous au 2 rue A, 31200 Toulouse\./);
  assert.equal(D.buildMessage('reminder', { appointment: a, client: { name: 'Nora' }, profile: { ...PROFILE, template_reminder: 'Coucou {prenom}, {heure} !' } }), 'Coucou Nora, 9 h 30 !');
  assert.match(D.buildMessage('refill', { appointment: a, client: { name: 'Nora' }, bookingUrl: 'https://x.fr/r/ines' }), /https:\/\/x\.fr\/r\/ines$/);
  assert.match(D.buildMessage('decline', { appointment: a, client: { name: 'Nora' } }), /disponible le mercredi 18 novembre à 9 h 30/);
  assert.throws(() => D.buildMessage('promo', {}));
});
test('F10 links: sms, WhatsApp, Maps, ics, csv', () => {
  assert.equal(D.smsLink('06 12 34 56 78', 'À demain & merci'), 'sms:+33612345678?&body=%C3%80%20demain%20%26%20merci');
  assert.equal(D.whatsappLink('06 12 34 56 78', 'Hello ?'), 'https://wa.me/33612345678?text=Hello%20%3F');
  assert.equal(D.whatsappLink('n/a', 'x'), 'https://wa.me/?text=x');
  assert.equal(D.mapsLink({ address_line: '2 rue A', postal_code: '31000', city: 'Toulouse' }), 'https://www.google.com/maps/search/?api=1&query=2%20rue%20A%2C%2031000%20Toulouse');
  const ics = D.icsEvent({ title: 'Remplissage; Inès', starts_at: '2026-11-18T08:30:00Z', ends_at: '2026-11-18T09:30:00Z', location: 'Toulouse, 31000', now: NOW });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /DTSTART:20261118T083000Z\r\n/); assert.ok(ics.includes('SUMMARY:Remplissage\\; Inès\r\n')); assert.match(ics, /LOCATION:Toulouse\\, 31000/);
  assert.throws(() => D.icsEvent({ title: 'x', starts_at: 'bad', ends_at: 'bad' }));
  assert.equal(D.toCsv([{ a: 'x', b: 'un, deux' }, { a: '=SUM(A1)', c: { k: 1 } }]), 'a,b,c\r\nx,"un, deux",\r\n\'=SUM(A1),,"{""k"":1}"');
  assert.equal(D.toCsv([]), '');
});
test('F11 refill uses appointment snapshot, honours refill_enabled and pending bookings', () => {
  const done = { id: 'd1', client_id: 'c1', service_name: 'Coupe', status: 'done', starts_at: '2026-09-01T08:00:00Z', ends_at: '2026-09-01T09:00:00Z', refill_days: 90, refill_enabled: true };
  const c = { id: 'c1', name: 'Nora', refill_days: 21, refill_opt_in: true, reminder_opt_in: true };
  assert.equal(D.notificationCandidates([c], [done], NOW).length, 0, '90 days not elapsed');
  assert.equal(D.notificationCandidates([c], [{ ...done, refill_days: null }], NOW).length, 1, 'client delay');
  assert.equal(D.notificationCandidates([c], [{ ...done, refill_days: null, refill_enabled: false }], NOW).length, 0);
  const pending = { id: 'p1', client_id: 'c1', status: 'pending', starts_at: '2026-11-20T08:00:00Z', ends_at: '2026-11-20T09:00:00Z' };
  assert.equal(D.notificationCandidates([c], [{ ...done, refill_days: null }, pending], NOW).length, 0);
  const kept = { id: 'x:new_request', kind: 'new_request', status: 'ready' };
  assert.deepEqual(D.reconcileNotifications([kept], [c], [], NOW), [kept], 'event notifications are not invalidated');
});
