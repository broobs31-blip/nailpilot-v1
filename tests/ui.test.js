// Vérification finale 2026-10-24 : non-régression des aides d'affichage (sans navigateur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRanges } from '../src/components/timeline.js';
import { dayLabel, dateTimeLabel } from '../src/components/format.js';
import { isOutsideHours } from '../src/components/appointment-card.js';
import { clientCsv } from '../src/views/clients.js';
import { buildMessage, fromParisLocal, validateClosure } from '../src/domain.js';

const store = (extra = {}) => ({ state: { openingHours: [], closures: [], appointments: [], clients: [], profile: null, ...extra } });

test('agenda : une fermeture du lundi ne ferme pas le dimanche du passage à l’heure d’été (jour de 23 h)', () => {
  const closures = [{ id: 'x', ...validateClosure({ day: '2027-03-29', allDay: true }) }];
  const s = store({ openingHours: [{ weekday: 7, start_min: 540, end_min: 1080 }], closures });
  assert.deepEqual(openRanges(s, '2027-03-28'), [[540, 1080]]);
  assert.deepEqual(openRanges(s, '2027-03-29'), []);
});

test('agenda : une fermeture le soir du dimanche de passage à l’heure d’hiver (jour de 25 h) reste partielle', () => {
  const closures = [{ id: 'x', starts_at: fromParisLocal('2026-10-25T23:30'), ends_at: fromParisLocal('2026-10-26T08:00') }];
  const s = store({ openingHours: [{ weekday: 7, start_min: 540, end_min: 1440 }], closures });
  assert.deepEqual(openRanges(s, '2026-10-25'), [[540, 1410]]);
});

test('F3 : un RDV hors horaires ou pendant une fermeture est signalé, pas un RDV annulé', () => {
  const s = store({ openingHours: [{ weekday: 2, start_min: 540, end_min: 1140 }] });
  const appt = (local, extra = {}) => ({ starts_at: fromParisLocal(local), duration_min: 60, buffer_before_min: 0, buffer_after_min: 10, location_type: 'pro', status: 'booked', ...extra });
  assert.equal(isOutsideHours(appt('2026-10-27T10:00'), s), false);
  assert.equal(isOutsideHours(appt('2026-10-27T18:30'), s), true); // déborde après 19 h
  assert.equal(isOutsideHours(appt('2026-10-26T10:00'), s), true); // lundi fermé
  assert.equal(isOutsideHours(appt('2026-10-26T10:00', { status: 'cancelled' }), s), false);
  const closed = store({ openingHours: s.state.openingHours, closures: [validateClosure({ day: '2026-10-27', allDay: true })] });
  assert.equal(isOutsideHours(appt('2026-10-27T10:00'), closed), true);
});

test('dates : « 1er » pour le premier du mois (libellés et messages)', () => {
  assert.equal(dayLabel('2026-11-01', { day: 'numeric', month: 'long' }), '1er novembre');
  assert.equal(dayLabel('2026-11-01'), 'dimanche 1er novembre');
  assert.equal(dayLabel('2026-11-11', { day: 'numeric', month: 'long' }), '11 novembre');
  assert.equal(dayLabel('2026-11-01', { weekday: 'short' }), 'dim.');
  assert.equal(dateTimeLabel('2026-11-01T09:00:00Z'), 'dimanche 1er novembre à 10 h');
  assert.equal(dateTimeLabel('2026-10-31T22:30:00Z'), 'samedi 31 octobre à 23 h 30');
  assert.match(buildMessage('reminder', { appointment: { starts_at: '2026-11-01T09:00:00Z', service_name: 'Coupe' }, client: { name: 'Ana' } }), /le dimanche 1er novembre à 10 h/);
  assert.match(buildMessage('reminder', { appointment: { starts_at: '2026-11-21T09:00:00Z', service_name: 'Coupe' }, client: { name: 'Ana' } }), /le samedi 21 novembre/);
});

test('F7 : l’export CSV d’une fiche contient la cliente, même sans rendez-vous', () => {
  const client = { name: 'Zoé Test', phone: '+33612345678', email: '', notes: 'nude', reminder_opt_in: true, refill_opt_in: false };
  const empty = clientCsv({ client, appointments: [] }).split('\r\n');
  assert.equal(empty.length, 2);
  assert.match(empty[0], /^cliente,prenom_usage,telephone/);
  assert.match(empty[1], /^Zoé Test,,'?\+33612345678/);
  const full = clientCsv({ client, appointments: [{ starts_at: '2026-10-27T08:00:00Z', service_name: 'Coupe femme', duration_min: 45, price_cents: 3500, location_type: 'client', address_line: '1 rue A', postal_code: '31000', city: 'Toulouse', status: 'booked' }] });
  assert.match(full, /2026-10-27 09:00,Coupe femme,45,3500,chez la cliente,"1 rue A, 31000 Toulouse",Confirmé/);
});
