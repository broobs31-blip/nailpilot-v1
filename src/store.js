// NailPilot V2 — data access layer (docs/ARCHITECTURE.md §6).
// Two implementations behind one API: Supabase when the three VITE_ variables are set, local demo otherwise.
import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_CATALOG, DEFAULT_PROFILE, TRADES, allowedTransitions, availableSlots, conflicts, fromParisLocal, normalizePhone, parisDay, pendingExpiresAt, reconcileNotifications, validateAddress, validateAppointment,
  validateClient, validateClosure, validateOpeningHours, validateProfile, validateService, validateSlug, computeBuffers,
  blockRange, addDays
} from './domain.js';

const env = import.meta.env || {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const projectRef = env.VITE_NAILPILOT_PROJECT_REF;
// Guard rail: never point NailPilot at an unrelated existing project. Do not edit this list.
const forbidden = new Set(['rxrpkqupwsluwbbnitvo', 'qafobkdvhhrwmssderco', 'khjjlaspzygauffdkowu']);
export const configured = Boolean(url && key && projectRef);
if ((url || key || projectRef) && !configured) throw new Error('Configuration Supabase incomplète : les trois variables sont nécessaires.');
if (configured && (forbidden.has(projectRef) || url !== `https://${projectRef}.supabase.co` || !/^[a-z]{20}$/.test(projectRef))) throw new Error('Projet Supabase refusé : utilisez uniquement un nouveau projet dédié à NailPilot.');
export const supabase = configured ? createClient(url, key) : null;

export const DEMO_STORAGE_KEY = 'nailpilot-demo-v2';
export const DEMO_SLUG = 'studio-demo';
const DEMO_USER = Object.freeze({ id: 'demo-user', email: 'demo@nailpilot.fr' });
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;

// ---------------------------------------------------------------------------
// Errors (§6.3)
// ---------------------------------------------------------------------------
const SQL_CODES = { NP422: 'validation', NP404: 'not_found', NP403: 'forbidden_location', NP409: 'slot_taken', '23P01': 'overlap', NP429: 'rate_limited' };
const APP_CODES = new Set(['validation', 'not_found', 'forbidden_location', 'slot_taken', 'overlap', 'rate_limited', 'auth', 'network']);
export function appError(message, code = 'validation') { return Object.assign(new Error(message), { code }); }

/** Maps a Supabase/PostgREST/Auth error to a French Error with a stable code. */
export function toAppError(error) {
  if (!error) return appError('Une erreur inattendue est survenue.', 'network');
  if (error instanceof Error && APP_CODES.has(error.code)) return error;
  const code = SQL_CODES[error.code];
  if (code === 'overlap') return appError('Ce créneau chevauche un rendez-vous existant (trajet ou préparation compris).', code);
  if (code) return appError(error.message || 'Saisie invalide.', code);
  if (error.code === '23505') return appError(/slug/.test(error.message || '') ? 'Ce lien est déjà utilisé. Choisissez-en un autre.' : 'Cet élément existe déjà.', 'validation');
  if (error.code === '42501' || error.code === 'PGRST301') return appError('Accès refusé. Reconnectez-vous.', 'auth');
  if (error.code === 'P0001' || error.code === '23514' || error.code === '23503') return appError(error.code === 'P0001' ? error.message : 'Saisie invalide.', 'validation');
  if (/fetch|network|Failed to fetch|NetworkError/i.test(error.message || '') || error.name === 'TypeError') return appError('Connexion impossible. Vérifiez votre réseau puis réessayez.', 'network');
  return appError(error.message || 'La sauvegarde a échoué.', 'validation');
}
async function check(promise) {
  let result;
  try { result = await promise; } catch (error) { throw toAppError(error); }
  if (result?.error) throw toAppError(result.error);
  return result?.data;
}
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const nowIso = () => new Date().toISOString();
const emptyState = () => ({ profile: null, publicProfile: null, openingHours: [], closures: [], services: [], clients: [], addresses: [], appointments: [], notifications: [], consents: [] });

// ---------------------------------------------------------------------------
// Demo persistence (shared by createStore and createPublicApi)
// ---------------------------------------------------------------------------
function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
let memoryDemo = null;
function readDemo() {
  const ls = storage();
  let data = null;
  try { data = ls ? JSON.parse(ls.getItem(DEMO_STORAGE_KEY)) : memoryDemo; } catch { data = null; }
  const valid = data && typeof data === 'object' && Object.keys(emptyState()).every(k => k in data);
  return valid ? { bookingAttempts: [], ...data } : demoSeed();
}
function writeDemo(data) {
  const ls = storage();
  if (ls) ls.setItem(DEMO_STORAGE_KEY, JSON.stringify(data)); else memoryDemo = structuredClone(data);
}

/** Demo data set relative to "now": multi-trade pro, published page, weekly hours, clients, appointments incl. one pending. */
export function demoSeed(now = new Date()) {
  const today = parisDay(now.toISOString());
  const at = (offsetDays, time) => fromParisLocal(`${addDays(today, offsetDays)}T${time}`);
  const profile = {
    ...DEFAULT_PROFILE, owner_id: DEMO_USER.id, trades: ['nails', 'hair', 'makeup'], work_mode: 'both',
    base_address_line: '12 rue des Lilas', base_postal_code: '31000', base_city: 'Toulouse', base_access_info: 'Interphone « Studio », 2e étage',
    zone_postal_codes: ['31000', '31100', '31200', '31300', '31400', '31500'], zone_radius_km: 15, min_notice_min: 120,
    onboarded_at: now.toISOString()
  };
  const publicProfile = { owner_id: DEMO_USER.id, slug: DEMO_SLUG, display_name: 'Studio Démo', city: 'Toulouse', bio: 'Ongles, coiffure et maquillage à Toulouse, chez moi ou à domicile. Compte de démonstration : aucune donnée réelle.', instagram: 'studio.demo', published: true };
  const openingHours = [];
  for (let d = 2; d <= 5; d++) openingHours.push({ id: `demo-h${d}a`, owner_id: DEMO_USER.id, weekday: d, start_min: 540, end_min: 750 }, { id: `demo-h${d}b`, owner_id: DEMO_USER.id, weekday: d, start_min: 810, end_min: 1140 });
  openingHours.push({ id: 'demo-h6', owner_id: DEMO_USER.id, weekday: 6, start_min: 480, end_min: 1020 });
  const pick = (trade, name) => DEFAULT_CATALOG[trade].find(s => s.name === name);
  const services = [
    ['demo-s1', pick('nails', 'Pose complète gel')], ['demo-s2', pick('nails', 'Remplissage')], ['demo-s3', pick('nails', 'Semi-permanent mains')],
    ['demo-s4', pick('hair', 'Coupe femme')], ['demo-s5', pick('hair', 'Couleur')], ['demo-s6', pick('makeup', 'Essai mariée')], ['demo-s7', pick('makeup', 'Mariée jour J')]
  ].map(([id, s], position) => ({ ...s, id, owner_id: DEMO_USER.id, position, archived: false }));
  const client = (id, name, phone, extra = {}) => ({ id, owner_id: DEMO_USER.id, name, preferred_name: '', phone, email: '', notes: '', source: 'manual', refill_days: 21, reminder_opt_in: true, refill_opt_in: true, archived: false, created_at: now.toISOString(), ...extra });
  const clients = [
    client('demo-c1', 'Camille Martin · exemple', '+33600000001', { notes: 'Préfère les teintes nude, forme amande.', source: 'instagram' }),
    client('demo-c2', 'Sofia Benali · exemple', '+33600000002', { source: 'referral', refill_days: 42 }),
    client('demo-c3', 'Sarah Lopez · exemple', '+33600000003', { reminder_opt_in: false }),
    client('demo-c4', 'Léa Durand · exemple', '+33600000004', { notes: 'Mariage prévu au printemps.', source: 'instagram', refill_opt_in: false }),
    client('demo-c5', 'Manon Petit · exemple', '+33600000005', { source: 'online', refill_opt_in: false })
  ];
  const addresses = [
    { id: 'demo-ad1', owner_id: DEMO_USER.id, client_id: 'demo-c2', label: 'Domicile', address_line: '8 avenue de Lyon', postal_code: '31500', city: 'Toulouse', access_info: 'Digicode 4521B', is_primary: true },
    { id: 'demo-ad2', owner_id: DEMO_USER.id, client_id: 'demo-c4', label: 'Domicile', address_line: '3 place du Capitole', postal_code: '31000', city: 'Toulouse', access_info: '', is_primary: true }
  ];
  const appt = (id, clientId, serviceId, startsAt, extra = {}) => {
    const s = services.find(x => x.id === serviceId);
    const location_type = extra.location_type || 'pro';
    const b = computeBuffers({ location_type, service: s, profile });
    const base = { id, owner_id: DEMO_USER.id, client_id: clientId, service_id: s.id, service_name: s.name, duration_min: s.duration_min, price_cents: s.price_cents, refill_enabled: s.refill_enabled, refill_days: s.refill_days, location_type, address_line: '', postal_code: '', city: '', access_info: '', buffer_before_min: b.before, buffer_after_min: b.after, starts_at: startsAt, status: 'booked', source: 'pro', client_message: '', cancel_reason: '', expires_at: null, expired: false, anonymized_at: null, created_at: now.toISOString(), ...extra };
    return { ...base, ...blockRange(base) };
  };
  const pendingStart = at(3, '15:00');
  const appointments = [
    appt('demo-a1', 'demo-c1', 'demo-s2', at(0, '10:00')),
    appt('demo-a2', 'demo-c2', 'demo-s5', at(0, '14:30'), { location_type: 'client', address_line: '8 avenue de Lyon', postal_code: '31500', city: 'Toulouse', access_info: 'Digicode 4521B' }),
    appt('demo-a3', 'demo-c1', 'demo-s3', at(1, '11:00')),
    appt('demo-a4', 'demo-c3', 'demo-s1', at(-24, '09:30'), { status: 'done' }),
    appt('demo-a5', 'demo-c4', 'demo-s6', at(-10, '16:00'), { status: 'no_show' }),
    appt('demo-a6', 'demo-c5', 'demo-s4', pendingStart, { status: 'pending', source: 'online', client_message: 'Juste les pointes, merci !', expires_at: pendingExpiresAt(pendingStart, profile, now) })
  ];
  const closures = [{ id: 'demo-cl1', owner_id: DEMO_USER.id, ...validateClosure({ day: addDays(today, 14), allDay: true, reason: 'Formation' }) }];
  const consents = clients.flatMap(c => [
    { id: `${c.id}-k1`, owner_id: DEMO_USER.id, client_id: c.id, kind: 'reminders', granted: c.reminder_opt_in, source: c.source === 'online' ? 'online_form' : 'pro', recorded_at: now.toISOString() },
    { id: `${c.id}-k2`, owner_id: DEMO_USER.id, client_id: c.id, kind: 'refills', granted: c.refill_opt_in, source: c.source === 'online' ? 'online_form' : 'pro', recorded_at: now.toISOString() }
  ]);
  const notifications = [{ id: 'demo-a6:new_request', owner_id: DEMO_USER.id, kind: 'new_request', client_id: 'demo-c5', appointment_id: 'demo-a6', due_at: now.toISOString(), reference_at: pendingStart, status: 'ready' }];
  return { profile, publicProfile, openingHours, closures, services, clients, addresses, appointments, notifications, consents, bookingAttempts: [] };
}

// --- Demo "triggers": mirror of the SQL side effects ---------------------------
function demoNotify(data, appointment, kind) {
  const id = `${appointment.id}:${kind}`;
  const row = { id, owner_id: DEMO_USER.id, kind, client_id: appointment.client_id, appointment_id: appointment.id, due_at: nowIso(), reference_at: appointment.starts_at, status: 'ready' };
  data.notifications = [...data.notifications.filter(n => n.id !== id), row];
}
function demoStatusEvents(data, before, after) {
  if (after.source !== 'online' || !after.client_id) return;
  if (!before) {
    demoNotify(data, after, 'new_request');
    if (after.status === 'booked') demoNotify(data, after, 'confirmation');
    return;
  }
  if (before.status !== 'pending' || after.status === 'pending') return;
  demoNotify(data, after, after.status === 'cancelled' && after.expired ? 'request_expired' : 'confirmation');
  data.notifications = data.notifications.map(n => (n.appointment_id === after.id && n.kind === 'new_request' && n.status === 'ready' ? { ...n, status: 'dismissed' } : n));
}
function demoExpirePending(data, now = Date.now()) {
  data.appointments = data.appointments.map(a => {
    if (a.status !== 'pending' || Date.parse(a.expires_at) > now) return a;
    const next = { ...a, status: 'cancelled', expired: true, cancel_reason: 'Demande expirée', expires_at: null };
    demoStatusEvents(data, a, next);
    return next;
  });
}
function demoLogConsent(data, before, client, source) {
  for (const [kind, field] of [['reminders', 'reminder_opt_in'], ['refills', 'refill_opt_in']]) {
    if (!before || before[field] !== client[field]) data.consents.push({ id: uuid(), owner_id: DEMO_USER.id, client_id: client.id, kind, granted: client[field], source, recorded_at: nowIso() });
  }
}
function demoRefresh(data) {
  demoExpirePending(data);
  data.notifications = reconcileNotifications(data.notifications, data.clients, data.appointments, new Date(), { profile: data.profile, publicProfile: data.publicProfile, bookingUrl: bookingUrl(data.publicProfile?.slug) })
    .map(n => ({ owner_id: DEMO_USER.id, ...n }));
}
function withDerived(appointment) { return { ...appointment, ...blockRange(appointment) }; }

export function bookingUrl(slug) {
  if (!slug) return '';
  const origin = globalThis.location?.origin || 'https://nailpilot.fr';
  return `${origin}/r/${slug}`;
}

// ---------------------------------------------------------------------------
// 6.1 Pro workspace
// ---------------------------------------------------------------------------
export function createStore() {
  return supabase ? createSupabaseStore() : createDemoStore();
}

function baseStore(mode) {
  let state = emptyState();
  let user = null;
  const listeners = new Set();
  return {
    mode,
    get state() { return state; },
    set state(next) { state = next; },
    get user() { return user; },
    set user(next) { user = next; },
    get needsOnboarding() { return Boolean(user) && (!state.profile || !state.profile.onboarded_at); },
    get pendingCount() { const now = Date.now(); return state.appointments.filter(a => a.status === 'pending' && !a.expired && Date.parse(a.expires_at) > now).length; },
    get bookingUrl() { return bookingUrl(state.publicProfile?.slug); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { for (const fn of listeners) { try { fn(state); } catch (error) { console.error(error); } } },
    appointmentContext() {
      return { appointments: state.appointments, clients: state.clients, services: state.services, addresses: state.addresses, profile: state.profile || DEFAULT_PROFILE, now: new Date() };
    },
    findAppointment(id) {
      const a = state.appointments.find(x => x.id === id);
      if (!a) throw appError('Rendez-vous introuvable.', 'not_found');
      return a;
    },
    requirePending(id) {
      if (this.findAppointment(id).status !== 'pending') throw appError('Cette demande a déjà été traitée.', 'validation');
    },
    checkTransition(id, status) {
      const a = this.findAppointment(id);
      if (a.status === status) return a;
      if (a.status === 'pending' && (a.expired || Date.parse(a.expires_at) <= Date.now())) throw appError('Cette demande a expiré.', 'validation');
      if (!allowedTransitions(a, new Date()).includes(status)) throw appError(status === 'no_show' ? 'Une absence ne peut être notée qu’après l’heure du rendez-vous.' : 'Ce changement de statut n’est pas possible.', 'validation');
      return a;
    },
    mergeProfileInput(input) {
      return { ...DEFAULT_PROFILE, ...(state.profile || {}), ...(state.publicProfile || {}), ...input };
    },
    nextServicePosition() { return state.services.reduce((max, s) => Math.max(max, (s.position ?? 0) + 1), 0); },
    catalogToInsert(trades) {
      const list = [...new Set(trades)].filter(t => Object.hasOwn(TRADES, t));
      let position = this.nextServicePosition();
      return list.flatMap(t => DEFAULT_CATALOG[t])
        .filter(s => !state.services.some(x => x.trade === s.trade && x.name.toLowerCase() === s.name.toLowerCase()))
        .map(s => ({ ...validateService(s), position: position++ }));
    },
    clientUpcoming(id) {
      return state.appointments.some(a => a.client_id === id && ['booked', 'pending'].includes(a.status) && Date.parse(a.ends_at) > Date.now());
    }
  };
}

function createDemoStore() {
  const store = baseStore('demo');
  let data = null;
  const save = async () => { writeDemo(data); await store.load(); };
  const mutate = async fn => { data = readDemo(); const result = await fn(data); await save(); return result; };

  Object.assign(store, {
    async load() {
      data = readDemo();
      demoRefresh(data);
      writeDemo(data);
      store.user = DEMO_USER;
      const { bookingAttempts, ...visible } = data;
      store.state = { ...emptyState(), ...visible, appointments: visible.appointments.map(a => ({ ...withDerived(a), service: a.service_name })) };
      store.emit();
    },
    resetDemo() { writeDemo(demoSeed()); return store.load(); },
    async signUp(email, password) {
      if (String(password || '').length < 8) throw appError('Le mot de passe doit contenir au moins 8 caractères.', 'validation');
      await store.load();
      return { needsEmailConfirmation: false };
    },
    async login() { await store.load(); },
    async logout() { store.user = null; store.state = emptyState(); store.emit(); },
    async requestPasswordReset() {},
    async updatePassword(password) { if (String(password || '').length < 8) throw appError('Le mot de passe doit contenir au moins 8 caractères.', 'validation'); },

    async saveProfile(input) {
      const { profile, publicProfile } = validateProfile(store.mergeProfileInput(input));
      await mutate(d => {
        d.profile = { ...DEFAULT_PROFILE, ...(d.profile || {}), ...profile, owner_id: DEMO_USER.id, onboarded_at: d.profile?.onboarded_at || nowIso() };
        d.publicProfile = { ...(d.publicProfile || {}), ...publicProfile, owner_id: DEMO_USER.id };
      });
    },
    async isSlugAvailable(slug) { try { validateSlug(slug); return true; } catch { return false; } },
    async setPublished(published) {
      if (!store.state.publicProfile) throw appError('Complétez d’abord votre profil.', 'validation');
      await mutate(d => { d.publicProfile = { ...d.publicProfile, published: published === true }; });
    },

    async saveOpeningHours(rows) {
      const clean = validateOpeningHours(rows);
      await mutate(d => { d.openingHours = clean.map(r => ({ ...r, id: uuid(), owner_id: DEMO_USER.id })); });
    },
    async saveClosure(input, id) {
      const payload = validateClosure(input);
      await mutate(d => {
        if (id && !d.closures.some(c => c.id === id)) throw appError('Fermeture introuvable.', 'not_found');
        d.closures = id ? d.closures.map(c => (c.id === id ? { ...c, ...payload } : c)) : [...d.closures, { ...payload, id: uuid(), owner_id: DEMO_USER.id }];
      });
    },
    async deleteClosure(id) { await mutate(d => { d.closures = d.closures.filter(c => c.id !== id); }); },

    async seedCatalog(trades = []) {
      const rows = store.catalogToInsert(trades);
      await mutate(d => { d.services.push(...rows.map(s => ({ ...s, id: uuid(), owner_id: DEMO_USER.id }))); });
      return rows.length;
    },
    async saveService(input, id) {
      const current = id ? store.state.services.find(s => s.id === id) : null;
      if (id && !current) throw appError('Prestation introuvable.', 'not_found');
      const payload = validateService({ ...(current || { position: store.nextServicePosition() }), ...input });
      let saved;
      await mutate(d => {
        if (id) d.services = d.services.map(s => (s.id === id ? (saved = { ...s, ...payload }) : s));
        else d.services.push(saved = { ...payload, id: uuid(), owner_id: DEMO_USER.id });
      });
      return saved;
    },
    async archiveService(id, archived = true) { await mutate(d => { d.services = d.services.map(s => (s.id === id ? { ...s, archived } : s)); }); },
    async deleteService(id) {
      await mutate(d => {
        d.services = d.services.filter(s => s.id !== id);
        d.appointments = d.appointments.map(a => (a.service_id === id ? { ...a, service_id: null } : a));
      });
    },
    async reorderServices(ids) {
      await mutate(d => {
        const order = new Map(ids.map((id, i) => [id, i]));
        d.services = d.services.map(s => (order.has(s.id) ? { ...s, position: order.get(s.id) } : s));
      });
    },

    async saveClient(input, id) {
      const current = id ? store.state.clients.find(c => c.id === id) : null;
      if (id && !current) throw appError('Cliente introuvable.', 'not_found');
      const payload = validateClient({ ...(current || {}), ...input });
      let saved;
      await mutate(d => {
        if (id) {
          d.clients = d.clients.map(c => (c.id === id ? (saved = { ...c, ...payload }) : c));
          demoLogConsent(d, current, saved, 'pro');
        } else {
          d.clients.push(saved = { ...payload, id: uuid(), owner_id: DEMO_USER.id, archived: false, created_at: nowIso() });
          demoLogConsent(d, null, saved, 'pro');
        }
      });
      return saved;
    },
    async archiveClient(id, archived = true) {
      if (archived && store.clientUpcoming(id)) throw appError('Annulez les rendez-vous à venir avant d’archiver cette cliente.', 'validation');
      await mutate(d => { d.clients = d.clients.map(c => (c.id === id ? { ...c, archived } : c)); });
    },
    async saveAddress(clientId, input, id) {
      if (!store.state.clients.some(c => c.id === clientId)) throw appError('Cliente introuvable.', 'not_found');
      const payload = validateAddress(input);
      let saved;
      await mutate(d => {
        const isFirst = !d.addresses.some(a => a.client_id === clientId && a.id !== id);
        if (isFirst) payload.is_primary = true;
        if (payload.is_primary) d.addresses = d.addresses.map(a => (a.client_id === clientId ? { ...a, is_primary: false } : a));
        if (id) d.addresses = d.addresses.map(a => (a.id === id ? (saved = { ...a, ...payload }) : a));
        else d.addresses.push(saved = { ...payload, id: uuid(), owner_id: DEMO_USER.id, client_id: clientId });
      });
      return saved;
    },
    async deleteAddress(id) { await mutate(d => { d.addresses = d.addresses.filter(a => a.id !== id); }); },
    async exportClient(id) {
      const client = store.state.clients.find(c => c.id === id);
      if (!client) throw appError('Cliente introuvable.', 'not_found');
      return { client, addresses: store.state.addresses.filter(a => a.client_id === id), appointments: store.state.appointments.filter(a => a.client_id === id).map(({ service, ...a }) => a), consents: store.state.consents.filter(k => k.client_id === id) };
    },
    async deleteClient(id) {
      if (!store.state.clients.some(c => c.id === id)) throw appError('Cliente introuvable.', 'not_found');
      if (store.clientUpcoming(id)) throw appError('Annulez les rendez-vous à venir avant de supprimer cette cliente.', 'validation');
      await mutate(d => {
        const at = nowIso();
        d.appointments = d.appointments.map(a => (a.client_id === id ? { ...a, client_id: null, address_line: '', postal_code: '', city: '', access_info: '', client_message: '', anonymized_at: at } : a));
        d.clients = d.clients.filter(c => c.id !== id);
        d.addresses = d.addresses.filter(a => a.client_id !== id);
        d.consents = d.consents.filter(k => k.client_id !== id);
        d.notifications = d.notifications.filter(n => n.client_id !== id);
      });
    },

    async saveAppointment(input) {
      const payload = validateAppointment(legacyAppointmentInput(input, store.state), store.appointmentContext());
      let saved;
      await mutate(d => {
        demoExpirePending(d);
        if (input.id) {
          const before = d.appointments.find(a => a.id === input.id);
          saved = withDerived({ ...before, ...payload, expires_at: payload.status === 'pending' ? before.expires_at : null });
          d.appointments = d.appointments.map(a => (a.id === input.id ? saved : a));
          demoStatusEvents(d, before, saved);
        } else {
          saved = withDerived({ ...payload, id: uuid(), owner_id: DEMO_USER.id, source: 'pro', client_message: '', expires_at: null, expired: false, anonymized_at: null, created_at: nowIso() });
          d.appointments.push(saved);
        }
      });
      return saved;
    },
    async setStatus(id, status, reason = '') {
      store.checkTransition(id, status);
      return store.saveAppointment({ id, status, cancel_reason: status === 'cancelled' ? reason : '' });
    },
    async acceptRequest(id) { store.requirePending(id); return store.setStatus(id, 'booked'); },
    async declineRequest(id, reason = '') { store.requirePending(id); return store.setStatus(id, 'cancelled', reason); },

    async refreshNotifications() { await store.load(); },
    async dismissNotification(id) { await mutate(d => { d.notifications = d.notifications.map(n => (n.id === id ? { ...n, status: 'dismissed' } : n)); }); },

    async exportAccount() {
      const { bookingAttempts, ...rest } = readDemo();
      return { exported_at: nowIso(), ...rest };
    },
    async requestAccountDeletion() {
      await mutate(d => { d.profile = { ...d.profile, deletion_requested_at: nowIso() }; d.publicProfile = { ...d.publicProfile, published: false }; });
    }
  });
  return store;
}

/** @deprecated V1 input { service, ends_at } → V2 fields. Kept while src/app.js V1 is being replaced. */
function legacyAppointmentInput(input, state) {
  if (input.service_id || input.service_name || !input.service) return input;
  const match = state.services.find(s => s.name === input.service && !s.archived);
  const duration = input.ends_at ? Math.round((Date.parse(input.ends_at) - Date.parse(input.starts_at)) / MINUTE) : undefined;
  return match ? { ...input, service_id: match.id, duration_min: duration } : { ...input, service_name: input.service, duration_min: duration };
}

// --- Supabase ---------------------------------------------------------------
const PAGE = 1000;
async function selectAll(table, order = 'id') {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = await check(supabase.from(table).select('*').order(order).range(from, from + PAGE - 1));
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}
const APPOINTMENT_UPDATE_COLUMNS = ['client_id', 'service_id', 'service_name', 'duration_min', 'price_cents', 'refill_enabled', 'refill_days',
  'location_type', 'address_line', 'postal_code', 'city', 'access_info', 'buffer_before_min', 'buffer_after_min', 'starts_at', 'status', 'cancel_reason'];

function createSupabaseStore() {
  const store = baseStore('supabase');
  let recovery = false;
  supabase.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') { recovery = true; store.emit(); }
  });
  const reload = async () => { await store.load(); };
  const ownerId = () => {
    if (!store.user) throw appError('Session expirée. Reconnectez-vous.', 'auth');
    return store.user.id;
  };
  const one = async (query, notFound) => {
    const rows = await check(query.select());
    if (!rows || rows.length !== 1) throw appError(notFound, 'not_found');
    return rows[0];
  };

  Object.assign(store, {
    get recovery() { return recovery; },
    async load() {
      const session = await check(supabase.auth.getSession());
      const user = session?.session?.user || null;
      store.user = user ? { id: user.id, email: user.email } : null;
      if (!user) { store.state = emptyState(); store.emit(); return; }
      await check(supabase.rpc('np_refresh_notifications'));
      const [profile, publicProfile, openingHours, closures, services, clients, addresses, appointments, notifications, consents] = await Promise.all([
        check(supabase.from('np_profiles').select('*').maybeSingle()),
        check(supabase.from('np_public_profiles').select('*').maybeSingle()),
        selectAll('np_opening_hours'), selectAll('np_closures', 'starts_at'), selectAll('np_services', 'position'),
        selectAll('np_clients', 'name'), selectAll('np_client_addresses'), selectAll('np_appointments', 'starts_at'),
        selectAll('np_notifications', 'due_at'), selectAll('np_consents', 'recorded_at')
      ]);
      store.state = { profile, publicProfile, openingHours, closures, services, clients, addresses, appointments: appointments.map(a => ({ ...a, service: a.service_name })), notifications, consents };
      store.emit();
    },
    async signUp(email, password) {
      if (String(password || '').length < 8) throw appError('Le mot de passe doit contenir au moins 8 caractères.', 'validation');
      const redirect = globalThis.location ? `${globalThis.location.origin}/#/connexion` : undefined;
      const { data, error } = await supabase.auth.signUp({ email: String(email || '').trim(), password, options: { emailRedirectTo: redirect } });
      if (error) {
        if (/password/i.test(error.message)) throw appError('Mot de passe trop faible : 8 caractères minimum, mélangez lettres et chiffres.', 'validation');
        if (/fetch|network/i.test(error.message)) throw toAppError(error);
        // Never reveal whether the account exists.
        return { needsEmailConfirmation: true };
      }
      if (data?.session) await reload();
      return { needsEmailConfirmation: !data?.session };
    },
    async login(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: String(email || '').trim(), password });
      if (error) {
        if (/fetch|network/i.test(error.message)) throw toAppError(error);
        throw appError('Identifiants incorrects.', 'auth');
      }
      await reload();
    },
    async logout() {
      await check(supabase.auth.signOut());
      recovery = false; store.user = null; store.state = emptyState(); store.emit();
    },
    async requestPasswordReset(email) {
      const redirectTo = globalThis.location ? `${globalThis.location.origin}/#/mot-de-passe` : undefined;
      try { await supabase.auth.resetPasswordForEmail(String(email || '').trim(), { redirectTo }); } catch { /* always resolves */ }
    },
    async updatePassword(password) {
      if (String(password || '').length < 8) throw appError('Le mot de passe doit contenir au moins 8 caractères.', 'validation');
      await check(supabase.auth.updateUser({ password }));
      recovery = false;
      await reload();
    },

    async saveProfile(input) {
      const owner_id = ownerId();
      const { profile, publicProfile } = validateProfile(store.mergeProfileInput(input));
      await check(supabase.from('np_profiles').upsert({ ...profile, owner_id, onboarded_at: store.state.profile?.onboarded_at || nowIso() }, { onConflict: 'owner_id' }));
      await check(supabase.from('np_public_profiles').upsert({ ...publicProfile, owner_id }, { onConflict: 'owner_id' }));
      await reload();
    },
    async isSlugAvailable(slug) {
      let value;
      try { value = validateSlug(slug); } catch { return false; }
      return Boolean(await check(supabase.rpc('np_slug_available', { p_slug: value })));
    },
    async setPublished(published) {
      await one(supabase.from('np_public_profiles').update({ published: published === true }).eq('owner_id', ownerId()), 'Complétez d’abord votre profil.');
      await reload();
    },

    async saveOpeningHours(rows) {
      await check(supabase.rpc('np_save_opening_hours', { p_rows: validateOpeningHours(rows) }));
      await reload();
    },
    async saveClosure(input, id) {
      const payload = validateClosure(input);
      if (id) await one(supabase.from('np_closures').update(payload).eq('id', id), 'Fermeture introuvable.');
      else await check(supabase.from('np_closures').insert({ ...payload, owner_id: ownerId() }));
      await reload();
    },
    async deleteClosure(id) { await check(supabase.from('np_closures').delete().eq('id', id)); await reload(); },

    async seedCatalog(trades = []) {
      const rows = store.catalogToInsert(trades);
      if (rows.length) await check(supabase.from('np_services').insert(rows.map(r => ({ ...r, owner_id: ownerId() }))));
      await reload();
      return rows.length;
    },
    async saveService(input, id) {
      const current = id ? store.state.services.find(s => s.id === id) : null;
      if (id && !current) throw appError('Prestation introuvable.', 'not_found');
      const payload = validateService({ ...(current || { position: store.nextServicePosition() }), ...input });
      const saved = id ? await one(supabase.from('np_services').update(payload).eq('id', id), 'Prestation introuvable.')
        : await one(supabase.from('np_services').insert({ ...payload, owner_id: ownerId() }), 'Prestation introuvable.');
      await reload();
      return saved;
    },
    async archiveService(id, archived = true) { await one(supabase.from('np_services').update({ archived }).eq('id', id), 'Prestation introuvable.'); await reload(); },
    async deleteService(id) { await check(supabase.from('np_services').delete().eq('id', id)); await reload(); },
    async reorderServices(ids) { await check(supabase.rpc('np_reorder_services', { p_ids: ids })); await reload(); },

    async saveClient(input, id) {
      const current = id ? store.state.clients.find(c => c.id === id) : null;
      if (id && !current) throw appError('Cliente introuvable.', 'not_found');
      const payload = validateClient({ ...(current || {}), ...input });
      const saved = id ? await one(supabase.from('np_clients').update(payload).eq('id', id), 'Cliente introuvable ou accès refusé.')
        : await one(supabase.from('np_clients').insert({ ...payload, owner_id: ownerId() }), 'Cliente introuvable ou accès refusé.');
      await reload();
      return saved;
    },
    async archiveClient(id, archived = true) {
      await one(supabase.from('np_clients').update({ archived }).eq('id', id), 'Cliente introuvable.');
      await reload();
    },
    async saveAddress(clientId, input, id) {
      const payload = validateAddress(input);
      if (!store.state.addresses.some(a => a.client_id === clientId && a.id !== id)) payload.is_primary = true;
      // Only one primary per client (unique partial index): demote the others first.
      if (payload.is_primary) await check(supabase.from('np_client_addresses').update({ is_primary: false }).eq('client_id', clientId).neq('id', id || '00000000-0000-0000-0000-000000000000'));
      const saved = id ? await one(supabase.from('np_client_addresses').update(payload).eq('id', id), 'Adresse introuvable.')
        : await one(supabase.from('np_client_addresses').insert({ ...payload, client_id: clientId, owner_id: ownerId() }), 'Adresse introuvable.');
      await reload();
      return saved;
    },
    async deleteAddress(id) { await check(supabase.from('np_client_addresses').delete().eq('id', id)); await reload(); },
    async exportClient(id) {
      const data = await check(supabase.rpc('np_export_client', { p_client_id: id }));
      if (!data) throw appError('Cliente introuvable.', 'not_found');
      return data;
    },
    async deleteClient(id) { await check(supabase.rpc('np_delete_client', { p_client_id: id })); await reload(); },

    async saveAppointment(input) {
      const payload = validateAppointment(legacyAppointmentInput(input, store.state), store.appointmentContext());
      const saved = input.id
        ? await one(supabase.from('np_appointments').update(Object.fromEntries(APPOINTMENT_UPDATE_COLUMNS.map(k => [k, payload[k]]))).eq('id', input.id), 'Rendez-vous introuvable ou accès refusé.')
        : await one(supabase.from('np_appointments').insert({ ...payload, owner_id: ownerId() }), 'Rendez-vous introuvable ou accès refusé.');
      await reload();
      return saved;
    },
    async setStatus(id, status, reason = '') {
      store.checkTransition(id, status);
      const saved = await one(supabase.from('np_appointments').update({ status, cancel_reason: status === 'cancelled' ? String(reason || '').slice(0, 300) : '' }).eq('id', id), 'Rendez-vous introuvable.');
      await reload();
      return saved;
    },
    async acceptRequest(id) { store.requirePending(id); return store.setStatus(id, 'booked'); },
    async declineRequest(id, reason = '') { store.requirePending(id); return store.setStatus(id, 'cancelled', reason); },

    async refreshNotifications() { await reload(); },
    async dismissNotification(id) { await check(supabase.from('np_notifications').update({ status: 'dismissed' }).eq('id', id)); await reload(); },

    async exportAccount() { return check(supabase.rpc('np_export_account')); },
    async requestAccountDeletion() { await check(supabase.rpc('np_request_account_deletion')); await reload(); }
  });
  return store;
}

// ---------------------------------------------------------------------------
// 6.2 Public booking page — no session, no pro state
// ---------------------------------------------------------------------------
export function createPublicApi(boundSlug) {
  return supabase ? supabasePublicApi(boundSlug) : demoPublicApi(boundSlug);
}

function publicPageFrom(data) {
  const { profile: p, publicProfile: pp } = data;
  return {
    slug: pp.slug, display_name: pp.display_name, city: pp.city, bio: pp.bio, instagram: pp.instagram,
    trades: p.trades, work_mode: p.work_mode, zone_postal_codes: p.zone_postal_codes, zone_radius_km: p.zone_radius_km,
    min_notice_min: p.min_notice_min, max_horizon_days: p.max_horizon_days, slot_step_min: p.slot_step_min, auto_confirm: p.auto_confirm,
    services: data.services
      .filter(s => s.online && !s.archived && (s.allowed_locations === 'both' || (s.allowed_locations === 'pro' && p.work_mode !== 'mobile') || (s.allowed_locations === 'client' && p.work_mode !== 'home_studio')))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map(s => ({ id: s.id, trade: s.trade, name: s.name, category: s.category, description: s.description, duration_min: s.duration_min, price_cents: s.price_cents, allowed_locations: s.allowed_locations }))
  };
}

function demoPublicApi(boundSlug) {
  const open = slug => {
    const data = readDemo();
    const wanted = String(slug ?? boundSlug ?? '').trim().toLowerCase();
    const ok = data.publicProfile?.slug === wanted && data.publicProfile.published && data.profile?.onboarded_at && !data.profile.deletion_requested_at;
    return ok ? data : null;
  };
  const slotsFor = (data, { serviceId, location, from, to, postalCode }) => {
    const service = data.services.find(s => s.id === serviceId && s.online && !s.archived);
    if (!service) throw appError('Prestation introuvable.', 'not_found');
    return availableSlots({ profile: data.profile, openingHours: data.openingHours, closures: data.closures, appointments: data.appointments, service, location, from, to, postalCode: postalCode || null, now: new Date() });
  };
  return {
    async getPage(slug) { const data = open(slug); return data ? publicPageFrom(data) : null; },
    async getSlots({ slug, serviceId, location, from, to, postalCode } = {}) {
      const data = open(slug);
      if (!data) throw appError('Page de réservation introuvable.', 'not_found');
      demoExpirePending(data);
      return slotsFor(data, { serviceId, location, from, to, postalCode });
    },
    async requestBooking(input = {}) {
      if (input.website) throw appError('Demande refusée.', 'validation');
      const data = open(input.slug);
      if (!data) throw appError('Page de réservation introuvable.', 'not_found');
      demoExpirePending(data);
      const firstName = String(input.firstName || '').trim(), lastName = String(input.lastName || '').trim();
      if (!firstName || !lastName || firstName.length > 60 || lastName.length > 60) throw appError('Indiquez votre prénom et votre nom.', 'validation');
      let phone;
      try { phone = normalizePhone(input.phone); } catch (error) { throw appError(error.message, 'validation'); }
      if (!phone) throw appError('Téléphone obligatoire.', 'validation');
      const email = String(input.email || '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw appError('Adresse e-mail invalide.', 'validation');
      if (String(input.message || '').length > 300) throw appError('Message limité à 300 caractères.', 'validation');
      const location = input.location;
      let address = null;
      if (location === 'client') {
        try { address = validateAddress({ ...input.address, postal_code: input.address?.postalCode ?? input.address?.postal_code, address_line: input.address?.line ?? input.address?.address_line }); } catch { throw appError('Adresse d’intervention incomplète.', 'validation'); }
      }
      const hourAgo = Date.now() - HOUR;
      data.bookingAttempts = (data.bookingAttempts || []).filter(t => Date.parse(t.at) > Date.now() - DAY);
      const pendingForPhone = data.appointments.filter(a => a.status === 'pending' && data.clients.find(c => c.id === a.client_id)?.phone === phone).length;
      if (data.bookingAttempts.filter(t => t.phone === phone && Date.parse(t.at) > hourAgo).length >= 5 || pendingForPhone >= 3) throw appError('Trop de demandes. Réessayez plus tard ou contactez directement la professionnelle.', 'rate_limited');
      const startsAt = new Date(input.startsAt).toISOString();
      const free = slotsFor(data, { serviceId: input.serviceId, location, from: parisDay(startsAt), to: parisDay(startsAt), postalCode: address?.postal_code });
      if (!free.includes(startsAt)) throw appError('Ce créneau vient d’être réservé ou n’est plus disponible.', 'slot_taken');
      data.bookingAttempts.push({ phone, at: nowIso() });

      const service = data.services.find(s => s.id === input.serviceId);
      let client = data.clients.find(c => c.phone === phone && !c.archived);
      if (!client) {
        client = { id: uuid(), owner_id: DEMO_USER.id, name: `${firstName} ${lastName}`, preferred_name: '', phone, email, notes: '', source: 'online', refill_days: 21, reminder_opt_in: input.reminderOptIn === true, refill_opt_in: input.refillOptIn === true, archived: false, created_at: nowIso() };
        data.clients.push(client);
        demoLogConsent(data, null, client, 'online_form');
      } else {
        const before = client;
        client = { ...client, reminder_opt_in: client.reminder_opt_in || input.reminderOptIn === true, refill_opt_in: client.refill_opt_in || input.refillOptIn === true, email: client.email || email };
        data.clients = data.clients.map(c => (c.id === client.id ? client : c));
        demoLogConsent(data, before, client, 'online_form');
      }
      if (address && !data.addresses.some(a => a.client_id === client.id)) data.addresses.push({ ...address, id: uuid(), owner_id: DEMO_USER.id, client_id: client.id, is_primary: true });
      const status = data.profile.auto_confirm ? 'booked' : 'pending';
      const buffers = computeBuffers({ location_type: location, service, profile: data.profile });
      const appointment = withDerived({
        id: uuid(), owner_id: DEMO_USER.id, client_id: client.id, service_id: service.id, service_name: service.name, duration_min: service.duration_min,
        price_cents: service.price_cents, refill_enabled: service.refill_enabled, refill_days: service.refill_days, location_type: location,
        address_line: address?.address_line || '', postal_code: address?.postal_code || '', city: address?.city || '', access_info: address?.access_info || '',
        buffer_before_min: buffers.before, buffer_after_min: buffers.after, starts_at: startsAt, status, source: 'online',
        client_message: String(input.message || ''), cancel_reason: '', expires_at: status === 'pending' ? pendingExpiresAt(startsAt, data.profile) : null,
        expired: false, anonymized_at: null, created_at: nowIso()
      });
      if (conflicts(appointment, data.appointments)) throw appError('Ce créneau vient d’être réservé ou n’est plus disponible.', 'slot_taken');
      data.appointments.push(appointment);
      demoStatusEvents(data, null, appointment);
      writeDemo(data);
      return { status, starts_at: appointment.starts_at, ends_at: appointment.ends_at, service_name: appointment.service_name, price_cents: appointment.price_cents, location_type: location, city: location === 'client' ? appointment.city : data.publicProfile.city, expires_at: appointment.expires_at };
    }
  };
}

function supabasePublicApi(boundSlug) {
  const slugOf = slug => String(slug ?? boundSlug ?? '').trim().toLowerCase();
  return {
    async getPage(slug) { return (await check(supabase.rpc('np_public_page', { p_slug: slugOf(slug) }))) || null; },
    async getSlots({ slug, serviceId, location, from, to, postalCode } = {}) {
      const rows = await check(supabase.rpc('np_available_slots', { p_slug: slugOf(slug), p_service_id: serviceId, p_location: location, p_from: from, p_to: to, p_postal_code: postalCode || null }));
      return (rows || []).map(r => new Date(r.slot_start ?? r).toISOString());
    },
    async requestBooking(input = {}) {
      const a = input.address || {};
      return check(supabase.rpc('np_request_booking', {
        p_slug: slugOf(input.slug), p_service_id: input.serviceId, p_location: input.location, p_starts_at: input.startsAt,
        p_first_name: input.firstName || '', p_last_name: input.lastName || '', p_phone: input.phone || '', p_email: input.email || '',
        p_message: input.message || '', p_address_line: a.line ?? a.address_line ?? '', p_postal_code: a.postalCode ?? a.postal_code ?? '',
        p_city: a.city || '', p_access_info: a.accessInfo ?? a.access_info ?? '', p_reminder_opt_in: input.reminderOptIn === true,
        p_refill_opt_in: input.refillOptIn === true, p_website: input.website || ''
      }));
    }
  };
}
