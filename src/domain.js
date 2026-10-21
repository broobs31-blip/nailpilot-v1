export const TIME_ZONE = 'Europe/Paris';
export const SERVICES = ['Pose complète', 'Remplissage', 'Semi-permanent', 'Dépose', 'Soin des ongles'];
export const STATUSES = { booked: 'Confirmé', done: 'Terminé', cancelled: 'Annulé' };

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function parisLocal(iso = new Date().toISOString()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function fromParisLocal(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Date ou heure invalide.');
  const assumed = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(assumed)) throw new Error('Date ou heure invalide.');
  const matches = [0, 60, 120].map(offset => new Date(assumed - offset * 60000).toISOString()).filter(iso => parisLocal(iso) === value);
  if (matches.length !== 1) throw new Error('Cette heure est inexistante ou ambiguë lors du changement d’heure. Choisissez une autre heure.');
  return matches[0];
}

export function formatDate(iso, options = {}) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', ...options }).format(new Date(iso));
}

export function normalizePhone(phone = '') {
  const cleaned = phone.replace(/[\s.()-]/g, '').replace(/^00/, '+');
  if (!cleaned) return '';
  if (/^0[1-9]\d{8}$/.test(cleaned)) return `+33${cleaned.slice(1)}`;
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  throw new Error('Saisissez un téléphone valide, par exemple 06 12 34 56 78.');
}

export function validateClient(input) {
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const notes = String(input.notes || '').trim();
  const refillDays = Number(input.refill_days ?? 21);
  if (!name || name.length > 120) throw new Error('Le nom doit contenir entre 1 et 120 caractères.');
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new Error('Adresse e-mail invalide.');
  if (notes.length > 2000) throw new Error('Les notes sont limitées à 2 000 caractères.');
  if (!Number.isInteger(refillDays) || refillDays < 7 || refillDays > 90) throw new Error('Le délai de remplissage doit être compris entre 7 et 90 jours.');
  return { name, phone: normalizePhone(input.phone), email, notes, refill_days: refillDays, reminder_opt_in: input.reminder_opt_in === true, refill_opt_in: input.refill_opt_in === true };
}

export function validateAppointment(input, appointments, clients) {
  const start = Date.parse(input.starts_at), end = Date.parse(input.ends_at);
  if (!clients.some(client => client.id === input.client_id && !client.archived)) throw new Error('Choisissez une cliente active.');
  if (!SERVICES.includes(input.service)) throw new Error('Choisissez une prestation.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 8 * 3600000) throw new Error('La durée doit être supérieure à 0 et inférieure ou égale à 8 heures.');
  if (!Object.hasOwn(STATUSES, input.status)) throw new Error('Statut invalide.');
  if (input.status !== 'cancelled' && appointments.some(a => a.id !== input.id && a.status !== 'cancelled' && start < Date.parse(a.ends_at) && end > Date.parse(a.starts_at))) throw new Error('Ce créneau chevauche un rendez-vous existant.');
  return { client_id: input.client_id, service: input.service, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), status: input.status };
}

export function refillDueAt(appointment, days) {
  // Calendar days in Paris: preserve local appointment end time across DST changes.
  const local = parisLocal(appointment.ends_at);
  const day = new Date(`${local}:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  const target = day.toISOString().slice(0, 16);
  const assumed = day.getTime();
  const matches = [60, 120].map(offset => new Date(assumed - offset * 60000).toISOString()).filter(iso => parisLocal(iso) === target);
  // PostgreSQL AT TIME ZONE picks standard time for repeated or missing Paris
  // hours. Keep automatic due dates consistent with the database scheduler.
  return matches.length ? matches.sort().at(-1) : new Date(assumed - 60 * 60000).toISOString();
}

export function notificationCandidates(clients, appointments, now = new Date()) {
  const timestamp = +new Date(now);
  const candidates = [];
  for (const client of clients.filter(c => !c.archived)) {
    const own = appointments.filter(a => a.client_id === client.id);
    if (client.reminder_opt_in) {
      for (const a of own.filter(a => a.status === 'booked' && Date.parse(a.starts_at) > timestamp && Date.parse(a.starts_at) - 86400000 <= timestamp)) {
        candidates.push({ id: `${a.id}:reminder`, kind: 'reminder', client_id: client.id, appointment_id: a.id, due_at: new Date(Date.parse(a.starts_at) - 86400000).toISOString(), reference_at: a.starts_at, message: `Bonjour ${client.name}, rappel de votre rendez-vous ${a.service.toLowerCase()} le ${formatDate(a.starts_at)}. À bientôt !` });
      }
    }
    const latest = own.filter(a => a.status === 'done' && Date.parse(a.ends_at) <= timestamp).sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at))[0];
    if (client.refill_opt_in && latest && !own.some(a => a.status === 'booked' && Date.parse(a.ends_at) > timestamp)) {
      let due;
      try { due = refillDueAt(latest, client.refill_days); } catch { continue; }
      if (Date.parse(due) <= timestamp) candidates.push({ id: `${latest.id}:refill`, kind: 'refill', client_id: client.id, appointment_id: latest.id, due_at: due, reference_at: latest.ends_at, message: `Bonjour ${client.name}, c’est le moment de prévoir votre remplissage. Contactez-moi pour choisir votre prochain créneau !` });
    }
  }
  return candidates;
}

export function reconcileNotifications(previous, clients, appointments, now = new Date()) {
  const candidates = notificationCandidates(clients, appointments, now);
  const keys = new Set(candidates.map(n => n.id));
  const retained = previous.filter(n => !keys.has(n.id)).map(n => ({ ...n, status: 'invalidated' }));
  return [...retained, ...candidates.map(n => {
    const old = previous.find(p => p.id === n.id);
    const dismissed = old?.status === 'dismissed' && old.reference_at === n.reference_at;
    return { ...n, status: dismissed ? 'dismissed' : 'ready' };
  })];
}
