import { createClient } from '@supabase/supabase-js';
import { reconcileNotifications, validateAppointment, validateClient, fromParisLocal, parisLocal } from './domain.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const projectRef = import.meta.env.VITE_NAILPILOT_PROJECT_REF;
const forbidden = new Set(['rxrpkqupwsluwbbnitvo', 'qafobkdvhhrwmssderco', 'khjjlaspzygauffdkowu']);
export const configured = Boolean(url && key && projectRef);
if ((url || key || projectRef) && !configured) throw new Error('Configuration Supabase incomplète : les trois variables sont nécessaires.');
if (configured && (forbidden.has(projectRef) || url !== `https://${projectRef}.supabase.co` || !/^[a-z]{20}$/.test(projectRef))) throw new Error('Projet Supabase refusé : utilisez uniquement un nouveau projet dédié à NailPilot.');
export const supabase = configured ? createClient(url, key) : null;
const STORAGE_KEY = 'nailpilot-demo-v1';

function seed() {
  const day = parisLocal().slice(0, 10);
  const today = fromParisLocal(`${day}T14:00`);
  const old = new Date(Date.parse(today) - 24 * 86400000).toISOString();
  return { clients: [
    { id: 'demo-1', name: 'Camille · exemple', phone: '+33600000001', email: '', notes: 'Préfère les teintes naturelles.', refill_days: 21, reminder_opt_in: true, refill_opt_in: true, archived: false },
    { id: 'demo-2', name: 'Léa · exemple', phone: '', email: '', notes: '', refill_days: 21, reminder_opt_in: true, refill_opt_in: false, archived: false },
    { id: 'demo-3', name: 'Sarah · exemple', phone: '', email: '', notes: '', refill_days: 21, reminder_opt_in: false, refill_opt_in: true, archived: false }
  ], appointments: [
    { id: 'demo-a1', client_id: 'demo-1', service: 'Remplissage', starts_at: new Date(Date.now() + 2 * 3600000).toISOString(), ends_at: new Date(Date.now() + 3 * 3600000).toISOString(), status: 'booked' },
    { id: 'demo-a2', client_id: 'demo-3', service: 'Pose complète', starts_at: old, ends_at: new Date(Date.parse(old) + 3600000).toISOString(), status: 'done' }
  ], notifications: [] };
}

export function createStore() {
  let state = { clients: [], appointments: [], notifications: [] };
  let user = null;
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  async function check(result) {
    if (result.error) {
      if (result.error.code === '23P01') throw new Error('Ce créneau chevauche un rendez-vous existant.');
      throw new Error(result.error.message || 'La sauvegarde a échoué.');
    }
    return result.data;
  }
  return {
    get state() { return state; },
    get user() { return user; },
    async load() {
      if (!supabase) {
        try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || seed(); }
        catch { state = seed(); }
        if (!Array.isArray(state.clients) || !Array.isArray(state.appointments) || !Array.isArray(state.notifications)) state = seed();
        state.notifications = reconcileNotifications(state.notifications, state.clients, state.appointments);
        persist(); return;
      }
      const session = await check(await supabase.auth.getSession());
      user = session.session?.user || null;
      if (!user) { state = { clients: [], appointments: [], notifications: [] }; return; }
      const rows = await Promise.all(['np_clients', 'np_appointments'].map(async table => {
        const response = await supabase.from(table).select('*', { count: 'exact' }).order('id').limit(1000);
        const result = await check(response);
        if (response.count > result.length) throw new Error('Plus de 1 000 éléments : une pagination doit être ajoutée avant de continuer.');
        return result;
      }));
      state.clients = rows[0]; state.appointments = rows[1];
      await check(await supabase.rpc('np_refresh_notifications'));
      state.notifications = await check(await supabase.from('np_notifications').select('*').order('due_at', { ascending: false }).limit(1000));
    },
    async login(email, password) {
      if (!supabase) return;
      await check(await supabase.auth.signInWithPassword({ email, password }));
      await this.load();
    },
    async logout() {
      if (supabase) await check(await supabase.auth.signOut());
      user = null; state = { clients: [], appointments: [], notifications: [] };
    },
    async saveClient(input, id) {
      const payload = validateClient(input);
      if (supabase) {
        const query = id ? supabase.from('np_clients').update(payload).eq('id', id) : supabase.from('np_clients').insert({ ...payload, owner_id: user.id });
        const rows = await check(await query.select());
        if (rows.length !== 1) throw new Error('Cliente introuvable ou accès refusé.');
      } else {
        if (id) state.clients = state.clients.map(c => c.id === id ? { ...c, ...payload } : c);
        else state.clients.push({ ...payload, id: crypto.randomUUID(), archived: false });
        persist();
      }
      await this.load();
    },
    async archiveClient(id) {
      if (state.appointments.some(a => a.client_id === id && a.status === 'booked' && Date.parse(a.ends_at) > Date.now())) throw new Error('Annulez les rendez-vous à venir de cette cliente avant de l’archiver.');
      if (supabase) await check(await supabase.from('np_clients').update({ archived: true }).eq('id', id));
      else { state.clients = state.clients.map(c => c.id === id ? { ...c, archived: true } : c); persist(); }
      await this.load();
    },
    async saveAppointment(input) {
      const payload = validateAppointment(input, state.appointments, state.clients);
      if (supabase) {
        const query = input.id ? supabase.from('np_appointments').update(payload).eq('id', input.id) : supabase.from('np_appointments').insert({ ...payload, owner_id: user.id });
        const rows = await check(await query.select());
        if (rows.length !== 1) throw new Error('Rendez-vous introuvable ou accès refusé.');
      } else {
        if (input.id) state.appointments = state.appointments.map(a => a.id === input.id ? { ...a, ...payload } : a);
        else state.appointments.push({ ...payload, id: crypto.randomUUID() });
        persist();
      }
      await this.load();
    },
    async dismissNotification(id) {
      if (supabase) await check(await supabase.from('np_notifications').update({ status: 'dismissed' }).eq('id', id));
      else { state.notifications = state.notifications.map(n => n.id === id ? { ...n, status: 'dismissed' } : n); persist(); }
      await this.load();
    }
  };
}
