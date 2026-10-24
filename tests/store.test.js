import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Demo mode of src/store.js under Node: in-memory localStorage, no Supabase variables.
const memory = new Map();
globalThis.localStorage = { getItem: k => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) };
const { createStore, createPublicApi, toAppError, DEMO_SLUG, DEMO_STORAGE_KEY } = await import('../src/store.js');
const D = await import('../src/domain.js');

let store, api;
const today = D.parisDay();
const firstSlot = async (serviceId = 'demo-s2', location = 'pro', postalCode) => (await api.getSlots({ serviceId, location, from: D.addDays(today, 1), to: D.addDays(today, 14), postalCode }))[0];
const booking = (startsAt, extra = {}) => ({ serviceId: 'demo-s2', location: 'pro', startsAt, firstName: 'Nora', lastName: 'Test', phone: '06 11 22 33 44', reminderOptIn: true, ...extra });
beforeEach(async () => { memory.clear(); store = createStore(); await store.load(); api = createPublicApi(DEMO_SLUG); });

test('store demo: complete seed for the three trades, one pending request, one home visit', () => {
  assert.equal(store.mode, 'demo'); assert.equal(store.user.id, 'demo-user'); assert.equal(store.needsOnboarding, false); assert.equal(store.pendingCount, 1);
  for (const key of ['profile', 'publicProfile', 'openingHours', 'closures', 'services', 'clients', 'addresses', 'appointments', 'notifications', 'consents']) assert.ok(store.state[key], key);
  assert.deepEqual([...new Set(store.state.services.map(s => s.trade))].sort(), ['hair', 'makeup', 'nails']);
  assert.ok(store.state.appointments.some(a => a.location_type === 'client' && a.address_line));
  assert.ok(store.state.appointments.every(a => a.ends_at && a.block_start && a.block_end));
  assert.ok(store.state.notifications.some(n => n.kind === 'new_request' && n.status === 'ready'));
  assert.ok(memory.has(DEMO_STORAGE_KEY));
  assert.match(store.bookingUrl, /\/r\/studio-demo$/);
});
test('store demo: subscribe notifies after writes', async () => {
  let calls = 0;
  const off = store.subscribe(() => calls++);
  await store.saveClient({ name: 'Nouvelle cliente' });
  off(); await store.saveClient({ name: 'Encore une' });
  assert.equal(calls, 1);
});
test('public demo: page exposes public data only; unknown slug → null', async () => {
  const page = await api.getPage();
  assert.equal(page.display_name, 'Studio Démo'); assert.ok(page.services.length >= 5);
  assert.doesNotMatch(JSON.stringify(page), /rue des Lilas|owner_id|Interphone/);
  assert.equal(await api.getPage('inconnue'), null);
  await assert.rejects(api.getSlots({ slug: 'inconnue', serviceId: 'demo-s2', location: 'pro', from: today, to: today }), e => e.code === 'not_found');
});
test('public demo: booking appears in the pro agenda, slot then taken, accept → confirmation', async () => {
  const start = await firstSlot();
  const r = await api.requestBooking(booking(start));
  assert.equal(r.status, 'pending'); assert.equal(r.city, 'Toulouse'); assert.ok(r.expires_at);
  await assert.rejects(api.requestBooking(booking(start, { phone: '0699999999' })), e => e.code === 'slot_taken');
  assert.ok(!(await api.getSlots({ serviceId: 'demo-s2', location: 'pro', from: D.parisDay(start), to: D.parisDay(start) })).includes(start));
  await store.load();
  assert.equal(store.pendingCount, 2);
  const created = store.state.appointments.find(a => a.starts_at === start);
  assert.equal(created.source, 'online'); assert.equal(created.service_name, 'Remplissage');
  const client = store.state.clients.find(c => c.phone === '+33611223344');
  assert.equal(client.source, 'online');
  assert.deepEqual(store.state.consents.filter(k => k.client_id === client.id).map(k => [k.kind, k.granted, k.source]), [['reminders', true, 'online_form'], ['refills', false, 'online_form']]);
  await store.acceptRequest(created.id);
  assert.equal(store.state.appointments.find(a => a.id === created.id).status, 'booked');
  assert.ok(store.state.notifications.some(n => n.appointment_id === created.id && n.kind === 'confirmation' && n.status === 'ready'));
});
test('public demo: home visit with zone check and address storage', async () => {
  const start = await firstSlot('demo-s4', 'client');
  await assert.rejects(api.requestBooking(booking(start, { serviceId: 'demo-s4', location: 'client', address: { line: '1 rue X', postalCode: '75001', city: 'Paris' } })), e => e.code === 'forbidden_location');
  await assert.rejects(api.requestBooking(booking(start, { serviceId: 'demo-s4', location: 'client' })), e => e.code === 'validation');
  const r = await api.requestBooking(booking(start, { serviceId: 'demo-s4', location: 'client', address: { line: '1 rue X', postalCode: '31400', city: 'Toulouse', accessInfo: 'Code 9' } }));
  assert.equal(r.location_type, 'client');
  await store.load();
  const a = store.state.appointments.find(x => x.starts_at === start);
  assert.deepEqual([a.buffer_before_min, a.buffer_after_min, a.access_info], [30, 30, 'Code 9']);
  assert.equal(store.state.addresses.filter(ad => ad.client_id === a.client_id).length, 1);
});
test('public demo: honeypot, invalid phone, R5 cap of 3 pending per phone', async () => {
  const slots = await api.getSlots({ serviceId: 'demo-s3', location: 'pro', from: D.addDays(today, 1), to: D.addDays(today, 14) });
  await assert.rejects(api.requestBooking(booking(slots[0], { website: 'http://spam' })), e => e.code === 'validation');
  await assert.rejects(api.requestBooking(booking(slots[0], { phone: '123' })), e => e.code === 'validation');
  for (const i of [0, 4, 8]) await api.requestBooking(booking(slots[i], { serviceId: 'demo-s3' }));
  await assert.rejects(api.requestBooking(booking(slots[12], { serviceId: 'demo-s3' })), e => e.code === 'rate_limited');
});
test('store demo: appointments — overlap code, R6 transitions, legacy V1 input', async () => {
  const day = D.addDays(today, 20);
  const saved = await store.saveAppointment({ client_id: 'demo-c1', service_id: 'demo-s2', location_type: 'pro', starts_at: D.fromParisLocal(`${day}T10:00`) });
  assert.equal(saved.buffer_after_min, 10); assert.equal(saved.ends_at, new Date(Date.parse(saved.starts_at) + 90 * 60000).toISOString());
  await assert.rejects(store.saveAppointment({ client_id: 'demo-c2', service_id: 'demo-s4', location_type: 'client', address_id: 'demo-ad1', starts_at: D.fromParisLocal(`${day}T11:50`) }), e => e.code === 'overlap');
  await store.saveAppointment({ client_id: 'demo-c2', service_id: 'demo-s4', location_type: 'client', address_id: 'demo-ad1', starts_at: D.fromParisLocal(`${day}T12:00`) });
  await assert.rejects(store.setStatus(saved.id, 'no_show'), e => e.code === 'validation');
  await store.setStatus(saved.id, 'cancelled', 'Empêchement');
  assert.equal(store.state.appointments.find(a => a.id === saved.id).cancel_reason, 'Empêchement');
  const legacy = await store.saveAppointment({ client_id: 'demo-c3', service: 'Remplissage', starts_at: D.fromParisLocal(`${day}T16:00`), ends_at: D.fromParisLocal(`${day}T17:00`), status: 'booked' });
  assert.equal(legacy.service_id, 'demo-s2'); assert.equal(legacy.duration_min, 60);
  await assert.rejects(store.declineRequest('demo-a1'), e => e.code === 'validation');
});
test('store demo: profile, slug, hours, closures, catalogue', async () => {
  await store.saveProfile({ bio: 'Nouvelle bio' });
  assert.equal(store.state.publicProfile.bio, 'Nouvelle bio'); assert.equal(store.state.profile.trades.length, 3);
  await assert.rejects(store.saveProfile({ slug: 'admin' }), /réservé/);
  assert.equal(await store.isSlugAvailable('admin'), false); assert.equal(await store.isSlugAvailable('mon-studio'), true);
  await store.setPublished(false);
  assert.equal(await api.getPage(), null);
  await store.saveOpeningHours([{ weekday: 1, start: '09:00', end: '12:00' }]);
  assert.deepEqual(store.state.openingHours.map(h => [h.weekday, h.start_min, h.end_min]), [[1, 540, 720]]);
  await store.saveClosure({ day: D.addDays(today, 30), allDay: true, reason: 'Salon' });
  const closure = store.state.closures.find(c => c.reason === 'Salon');
  await store.deleteClosure(closure.id);
  assert.ok(!store.state.closures.some(c => c.reason === 'Salon'));
  const before = store.state.services.length;
  const added = await store.seedCatalog(['nails']);
  assert.equal(store.state.services.length, before + added); assert.equal(await store.seedCatalog(['nails']), 0, 'idempotent');
  const ids = store.state.services.map(s => s.id).reverse();
  await store.reorderServices(ids);
  assert.equal(store.state.services.find(s => s.id === ids[0]).position, 0);
  await store.archiveService(ids[0]);
  assert.ok(!(await createPublicApi(DEMO_SLUG).getPage()));
});
test('store demo: clients — addresses, export, deletion guard and anonymization', async () => {
  const c = await store.saveClient({ name: 'Inès Test', phone: '0612121212', reminder_opt_in: true });
  const a1 = await store.saveAddress(c.id, { address_line: '1 rue A', postal_code: '31000', city: 'Toulouse' });
  assert.equal(a1.is_primary, true, 'first address is primary');
  const a2 = await store.saveAddress(c.id, { address_line: '2 rue B', postal_code: '31200', city: 'Toulouse', is_primary: true });
  assert.deepEqual(store.state.addresses.filter(a => a.client_id === c.id).map(a => [a.id === a2.id, a.is_primary]).sort(), [[false, false], [true, true]]);
  await assert.rejects(store.deleteClient('demo-c1'), /Annulez/);
  await assert.rejects(store.archiveClient('demo-c1'), /Annulez/);
  const exported = await store.exportClient('demo-c3');
  assert.deepEqual(Object.keys(exported), ['client', 'addresses', 'appointments', 'consents']);
  await store.deleteClient('demo-c3');
  assert.ok(!store.state.clients.some(x => x.id === 'demo-c3'));
  const anonymized = store.state.appointments.find(a => a.id === 'demo-a4');
  assert.equal(anonymized.client_id, null); assert.ok(anonymized.anonymized_at); assert.equal(anonymized.service_name, 'Pose complète gel');
  assert.ok(!store.state.consents.some(k => k.client_id === 'demo-c3'));
  const account = await store.exportAccount();
  assert.ok(account.exported_at && account.clients.length === store.state.clients.length);
  await store.requestAccountDeletion();
  assert.equal(await api.getPage(), null);
});
test('store: SQL and auth errors map to stable codes', () => {
  const cases = { NP409: 'slot_taken', NP403: 'forbidden_location', NP404: 'not_found', NP422: 'validation', NP429: 'rate_limited', '23P01': 'overlap', '42501': 'auth' };
  for (const [code, expected] of Object.entries(cases)) assert.equal(toAppError({ code, message: 'Msg' }).code, expected, code);
  assert.equal(toAppError({ code: 'NP409', message: 'Ce créneau vient d’être réservé.' }).message, 'Ce créneau vient d’être réservé.');
  assert.match(toAppError({ code: '23505', message: 'duplicate key value violates unique constraint "np_public_profiles_slug_key"' }).message, /lien/);
  assert.equal(toAppError(new TypeError('Failed to fetch')).code, 'network');
  const already = Object.assign(new Error('x'), { code: 'overlap' });
  assert.equal(toAppError(already), already);
});
