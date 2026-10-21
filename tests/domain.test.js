import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClient, validateAppointment, fromParisLocal, parisLocal, escapeHtml, normalizePhone, reconcileNotifications, refillDueAt } from '../src/domain.js';

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
