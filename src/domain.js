// NailPilot V2 — pure domain logic (docs/ARCHITECTURE.md §5). No I/O, no globals except Intl/Date.
// Every scheduling rule here mirrors supabase/schema.sql exactly (ADR-002); tests/domain.test.js and
// tests/database.test.js cover the same cases.

// ---------------------------------------------------------------------------
// 5.1 Constants
// ---------------------------------------------------------------------------
export const TIME_ZONE = 'Europe/Paris';
export const TRADES = { nails: 'Ongles', hair: 'Coiffure', makeup: 'Maquillage' };
export const WORK_MODES = { home_studio: 'Chez moi', mobile: 'À domicile', both: 'Les deux' };
export const LOCATIONS = { pro: 'Chez moi', client: 'Chez la cliente' };
export const STATUSES = { pending: 'En attente', booked: 'Confirmé', done: 'Terminé', cancelled: 'Annulé', no_show: 'Absente' };
export const CLIENT_SOURCES = { manual: 'Saisie', instagram: 'Instagram', referral: 'Bouche-à-oreille', online: 'En ligne', other: 'Autre' };
export const SLOT_STEPS = [15, 30, 60];
export const ALLOWED_LOCATIONS = { both: 'Chez moi ou à domicile', pro: 'Chez moi uniquement', client: 'À domicile uniquement' };
// Identical to the CHECK constraint on np_public_profiles.slug.
export const RESERVED_SLUGS = Object.freeze(['admin', 'api', 'app', 'auth', 'login', 'logout', 'signup', 'inscription', 'connexion', 'reset',
  'www', 'mail', 'support', 'aide', 'help', 'static', 'assets', 'public', 'nailpilot', 'confidentialite',
  'mentions-legales', 'cgu', 'agenda', 'clientes', 'reglages', 'demandes']);
// Identical to the column DEFAULTs of np_profiles.
export const DEFAULT_PROFILE = Object.freeze({
  trades: [], work_mode: 'home_studio', base_address_line: '', base_postal_code: '', base_city: '', base_access_info: '',
  zone_postal_codes: [], zone_radius_km: null, travel_buffer_min: 30, min_notice_min: 720, max_horizon_days: 60,
  slot_step_min: 30, auto_confirm: false, template_confirmation: '', template_decline: '', template_reminder: '',
  template_refill: '', onboarded_at: null, deletion_requested_at: null
});
export const DEFAULT_PUBLIC_PROFILE = Object.freeze({ slug: '', display_name: '', city: '', bio: '', instagram: '', published: false });

const svc = (trade, name, category, duration_min, price_cents, extra = {}) => Object.freeze({
  trade, name, category, description: '', duration_min, price_cents, allowed_locations: 'both', online: true,
  prep_min: trade === 'hair' ? 15 : 10, refill_enabled: false, refill_days: null, ...extra
});
// F4 — pre-filled catalogues (prices TTC in cents, null = « sur devis »). Fully editable afterwards.
export const DEFAULT_CATALOG = Object.freeze({
  nails: Object.freeze([
    svc('nails', 'Pose complète gel', 'Pose', 120, 5500, { description: 'Pose gel ou résine sur ongles naturels, forme et longueur au choix.', refill_enabled: true, refill_days: 21 }),
    svc('nails', 'Remplissage', 'Entretien', 90, 4000, { description: 'Remplissage de la pousse et changement de couleur.', refill_enabled: true, refill_days: 21 }),
    svc('nails', 'Semi-permanent mains', 'Vernis', 45, 3000, { refill_enabled: true, refill_days: 21 }),
    svc('nails', 'Semi-permanent pieds', 'Vernis', 45, 3000, { refill_enabled: true, refill_days: 28 }),
    svc('nails', 'Dépose complète', 'Entretien', 30, 1500),
    svc('nails', 'Nail art', 'Décoration', 30, null, { description: 'Décoration sur mesure, tarif selon le modèle.' })
  ]),
  hair: Object.freeze([
    svc('hair', 'Coupe femme', 'Coupe', 45, 3500, { refill_enabled: true, refill_days: 42 }),
    svc('hair', 'Coupe + brushing', 'Coupe', 60, 4500, { refill_enabled: true, refill_days: 42 }),
    svc('hair', 'Coupe homme', 'Coupe', 30, 2200, { refill_enabled: true, refill_days: 28 }),
    svc('hair', 'Coupe enfant', 'Coupe', 30, 1800),
    svc('hair', 'Couleur', 'Couleur', 90, 5500, { refill_enabled: true, refill_days: 35 }),
    svc('hair', 'Mèches / balayage', 'Couleur', 180, null, { description: 'Tarif selon la longueur, sur devis.', refill_enabled: true, refill_days: 60 })
  ]),
  makeup: Object.freeze([
    svc('makeup', 'Essai mariée', 'Mariage', 90, 8000, { description: 'Essai complet quelques semaines avant le jour J.' }),
    svc('makeup', 'Mariée jour J', 'Mariage', 90, 15000, { allowed_locations: 'client' }),
    svc('makeup', 'Maquillage invitée', 'Mariage', 45, 4500),
    svc('makeup', 'Maquillage soirée', 'Événement', 60, 5000),
    svc('makeup', 'Cours d’auto-maquillage', 'Cours', 90, 7000)
  ])
});

// Variables: {prenom} {date} {heure} {prestation} {adresse} {lien}
export const DEFAULT_TEMPLATES = Object.freeze({
  confirmation: 'Bonjour {prenom}, votre rendez-vous {prestation} du {date} à {heure} est confirmé, {adresse}. À très vite !',
  decline: 'Bonjour {prenom}, je ne suis malheureusement pas disponible le {date} à {heure} pour {prestation}. Vous pouvez choisir un autre créneau ici : {lien}',
  reminder: 'Bonjour {prenom}, petit rappel de votre rendez-vous {prestation} le {date} à {heure}, {adresse}. À bientôt !',
  refill: 'Bonjour {prenom}, c’est le bon moment pour prévoir votre prochain rendez-vous {prestation}. Réservez votre créneau ici : {lien}'
});
export const TEMPLATE_VARIABLES = Object.freeze(['prenom', 'date', 'heure', 'prestation', 'adresse', 'lien']);
export const HEALTH_WARNING = 'N’indiquez aucune information de santé (allergies, grossesse, traitements, pathologies).';

/** @deprecated V1 closed list, kept until the Frontend V2 removes it (ARCHITECTURE §7.4). */
export const SERVICES = ['Pose complète', 'Remplissage', 'Semi-permanent', 'Dépose', 'Soin des ongles'];

const MINUTE = 60000;
const DAY_MS = 86400000;
const LIVE = ['booked', 'done', 'no_show'];

/** Error with a stable code (ARCHITECTURE §6.3). */
export function domainError(message, code = 'validation') {
  return Object.assign(new Error(message), { code });
}
const fail = (message, code) => { throw domainError(message, code); };

// ---------------------------------------------------------------------------
// 5.2 Time and formatting
// ---------------------------------------------------------------------------
export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

const localFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function parisLocal(iso = new Date().toISOString()) {
  const p = Object.fromEntries(localFormatter.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function assumeUtc(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return NaN;
  const t = Date.parse(`${local}:00Z`);
  // Reject rolled-over dates such as 30 February.
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 16) === local ? t : NaN;
}

/** Strict: rejects non-existent (spring) and ambiguous (autumn) Paris times. */
export function fromParisLocal(value) {
  const assumed = assumeUtc(String(value));
  if (!Number.isFinite(assumed)) throw domainError('Date ou heure invalide.');
  const matches = [60, 120].map(offset => new Date(assumed - offset * MINUTE).toISOString()).filter(iso => parisLocal(iso) === value);
  if (matches.length !== 1) throw domainError('Cette heure est inexistante ou ambiguë lors du changement d’heure. Choisissez une autre heure.');
  return matches[0];
}

/** Lenient: like PostgreSQL `timestamp AT TIME ZONE 'Europe/Paris'` (standard time for missing or repeated hours). */
export function parisLenient(local) {
  const assumed = assumeUtc(local);
  if (!Number.isFinite(assumed)) throw domainError('Date ou heure invalide.');
  const matches = [60, 120].map(offset => new Date(assumed - offset * MINUTE).toISOString()).filter(iso => parisLocal(iso) === local);
  return matches.length ? matches.sort().at(-1) : new Date(assumed - 60 * MINUTE).toISOString();
}

export function formatDate(iso, options = {}) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', ...options }).format(new Date(iso));
}
/** '9 h 30' / '14 h' in Paris time. */
export function formatTime(iso) {
  const [h, m] = parisLocal(iso).slice(11).split(':');
  return m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`;
}
export function formatPrice(cents) {
  if (cents === null || cents === undefined || cents === '') return 'Sur devis';
  const value = Number(cents);
  if (!Number.isFinite(value)) return 'Sur devis';
  const [int, dec] = (Math.abs(value) / 100).toFixed(2).split('.');
  return `${value < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
}
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60), m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
export function minutesToTime(min) {
  const value = Number(min);
  if (!Number.isInteger(value) || value < 0 || value > 1440) throw domainError('Heure invalide.');
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '').trim());
  if (!match) throw domainError('Heure invalide (format HH:MM).');
  const h = Number(match[1]), m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m > 0)) throw domainError('Heure invalide (format HH:MM).');
  return h * 60 + m;
}
function assertDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !Number.isFinite(assumeUtc(`${day}T00:00`))) throw domainError('Date invalide.');
  return day;
}
export function addDays(day, n) {
  assertDay(day);
  return new Date(Date.parse(`${day}T00:00:00Z`) + Number(n) * DAY_MS).toISOString().slice(0, 10);
}
export function isoWeekday(day) {
  assertDay(day);
  return new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
}
export function weekDays(day) {
  const monday = addDays(day, 1 - isoWeekday(day));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
/** Today's date in Paris ('AAAA-MM-JJ'). */
export function parisDay(iso = new Date().toISOString()) { return parisLocal(iso).slice(0, 10); }

// ---------------------------------------------------------------------------
// 5.3 Validation — each returns the exact payload to persist
// ---------------------------------------------------------------------------
const text = (value, max, label, { required = false, min = required ? 1 : 0 } = {}) => {
  const v = String(value ?? '').trim();
  if (v.length < min || v.length > max) fail(required ? `${label} : entre ${min} et ${max} caractères.` : `${label} : ${max} caractères maximum.`);
  return v;
};
const int = (value, min, max, label, { step = 1, nullable = false } = {}) => {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const v = Number(value);
  if (!Number.isInteger(v) || v < min || v > max || v % step !== 0) fail(`${label} doit être compris entre ${min} et ${max}${step > 1 ? ` (par pas de ${step})` : ''}.`);
  return v;
};
const bool = (value, fallback = false) => (value === undefined || value === null ? fallback : value === true || value === 'true' || value === 'on');
const POSTAL = /^[0-9]{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(phone = '') {
  const cleaned = String(phone ?? '').replace(/[\s.()-]/g, '').replace(/^00/, '+');
  if (!cleaned) return '';
  if (/^0[1-9]\d{8}$/.test(cleaned)) return `+33${cleaned.slice(1)}`;
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  throw domainError('Saisissez un téléphone valide, par exemple 06 12 34 56 78.');
}

export function validateSlug(slug) {
  const v = String(slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(v) || v.includes('--')) fail('Le lien doit contenir 3 à 40 caractères : lettres minuscules, chiffres et tirets.');
  if (RESERVED_SLUGS.includes(v)) fail('Ce lien est réservé. Choisissez-en un autre.');
  return v;
}
export function slugify(name) {
  let v = String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  if (RESERVED_SLUGS.includes(v)) v = `${v}-beaute`.slice(0, 40);
  try { return validateSlug(v); } catch { return ''; }
}

function parseInstagram(value) {
  const v = String(value ?? '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  if (v && !/^[A-Za-z0-9._]{1,30}$/.test(v)) fail('Compte Instagram invalide (exemple : @mon.studio).');
  return v;
}
function parsePostalCodes(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  const codes = [...new Set(list.map(x => String(x).trim()).filter(Boolean))];
  if (codes.some(c => !POSTAL.test(c))) fail('Codes postaux invalides : 5 chiffres, séparés par des virgules.');
  if (codes.length > 200) fail('200 codes postaux maximum.');
  return codes;
}

/**
 * F2 — validates a complete profile. `input` may mix private and public fields.
 * Returns { profile, publicProfile } ready for np_profiles / np_public_profiles (no owner_id, no timestamps).
 */
export function validateProfile(input = {}) {
  const trades = [...new Set(Array.isArray(input.trades) ? input.trades : [input.trades].filter(Boolean))];
  if (!trades.length) fail('Choisissez au moins un métier.');
  if (trades.some(t => !Object.hasOwn(TRADES, t))) fail('Métier invalide.');
  const work_mode = input.work_mode ?? DEFAULT_PROFILE.work_mode;
  if (!Object.hasOwn(WORK_MODES, work_mode)) fail('Mode de travail invalide.');
  const base_address_line = text(input.base_address_line, 200, 'Adresse');
  const base_postal_code = String(input.base_postal_code ?? '').trim();
  const base_city = text(input.base_city, 80, 'Ville');
  const base_access_info = text(input.base_access_info, 300, 'Infos d’accès');
  if (base_postal_code && !POSTAL.test(base_postal_code)) fail('Code postal invalide (5 chiffres).');
  if (work_mode !== 'mobile' && (!base_address_line || !base_postal_code || !base_city)) fail('Indiquez l’adresse où vous recevez vos clientes (elle ne sera communiquée qu’après confirmation).');
  const templates = Object.fromEntries(['confirmation', 'decline', 'reminder', 'refill'].map(k => [`template_${k}`, text(input[`template_${k}`], 1000, 'Modèle de message')]));
  const slot_step_min = Number(input.slot_step_min ?? DEFAULT_PROFILE.slot_step_min);
  if (!SLOT_STEPS.includes(slot_step_min)) fail('Pas de créneaux invalide (15, 30 ou 60 minutes).');
  const profile = {
    trades, work_mode, base_address_line, base_postal_code, base_city, base_access_info,
    zone_postal_codes: parsePostalCodes(input.zone_postal_codes ?? []),
    zone_radius_km: int(input.zone_radius_km, 1, 200, 'Le rayon d’intervention (km)', { nullable: true }),
    travel_buffer_min: int(input.travel_buffer_min ?? DEFAULT_PROFILE.travel_buffer_min, 0, 120, 'Le temps de trajet (min)'),
    min_notice_min: int(input.min_notice_min ?? DEFAULT_PROFILE.min_notice_min, 0, 10080, 'Le délai minimum (min)'),
    max_horizon_days: int(input.max_horizon_days ?? DEFAULT_PROFILE.max_horizon_days, 7, 366, 'L’horizon de réservation (jours)'),
    slot_step_min, auto_confirm: bool(input.auto_confirm), ...templates
  };
  const publicProfile = {
    slug: validateSlug(input.slug),
    display_name: text(input.display_name, 80, 'Le nom commercial', { required: true }),
    city: text(input.city ?? base_city, 80, 'Ville'),
    bio: text(input.bio, 300, 'La présentation'),
    instagram: parseInstagram(input.instagram),
    published: bool(input.published, false)
  };
  return { profile, publicProfile };
}

/** F3 — rows: [{ weekday 1-7, start_min, end_min }] or with start/end 'HH:mm'. Returns sorted rows. */
export function validateOpeningHours(rows = []) {
  if (!Array.isArray(rows)) fail('Horaires invalides.');
  const clean = rows.map(r => {
    const weekday = int(r.weekday, 1, 7, 'Le jour');
    const start_min = r.start_min ?? timeToMinutes(r.start);
    const end_min = r.end_min ?? timeToMinutes(r.end);
    int(start_min, 0, 1435, 'L’heure de début (minutes)', { step: 5 });
    int(end_min, 5, 1440, 'L’heure de fin (minutes)', { step: 5 });
    if (end_min <= start_min) fail('La fin d’une plage doit être après son début.');
    return { weekday, start_min: Number(start_min), end_min: Number(end_min) };
  }).sort((a, b) => a.weekday - b.weekday || a.start_min - b.start_min);
  for (let d = 1; d <= 7; d++) {
    const day = clean.filter(r => r.weekday === d);
    if (day.length > 3) fail('Trois plages horaires maximum par jour.');
    for (let i = 1; i < day.length; i++) if (day[i].start_min < day[i - 1].end_min) fail('Les plages horaires d’un même jour ne doivent pas se chevaucher.');
  }
  return clean;
}

/** F3 — accepts { day, allDay: true, toDay? }, { from, to } (Paris local) or { starts_at, ends_at } (ISO). */
export function validateClosure(input = {}) {
  let starts_at, ends_at;
  if (input.day) {
    const toDay = input.toDay || input.to_day || input.day;
    if (input.allDay !== false || !input.from) {
      if (assertDay(toDay) < assertDay(input.day)) fail('La fin de la fermeture doit être après son début.');
      starts_at = parisLenient(`${input.day}T00:00`);
      ends_at = parisLenient(`${addDays(toDay, 1)}T00:00`);
    } else {
      starts_at = fromParisLocal(`${input.day}T${input.from}`);
      ends_at = fromParisLocal(`${toDay}T${input.to}`);
    }
  } else if (input.from && input.to) {
    starts_at = fromParisLocal(input.from); ends_at = fromParisLocal(input.to);
  } else {
    const s = Date.parse(input.starts_at), e = Date.parse(input.ends_at);
    if (!Number.isFinite(s) || !Number.isFinite(e)) fail('Dates de fermeture invalides.');
    starts_at = new Date(s).toISOString(); ends_at = new Date(e).toISOString();
  }
  const span = Date.parse(ends_at) - Date.parse(starts_at);
  if (span <= 0) fail('La fin de la fermeture doit être après son début.');
  if (span > 366 * DAY_MS) fail('Une fermeture ne peut pas dépasser 366 jours.');
  return { starts_at, ends_at, reason: text(input.reason, 120, 'Le motif') };
}

function parsePriceCents(input) {
  if (Object.hasOwn(input, 'price') && !Object.hasOwn(input, 'price_cents')) {
    const raw = String(input.price ?? '').trim().replace(/\s|€/g, '').replace(',', '.');
    if (!raw) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) fail('Prix invalide (exemple : 55 ou 55,50).');
    return int(Math.round(Number(raw) * 100), 0, 200000, 'Le prix (centimes)');
  }
  return int(input.price_cents, 0, 200000, 'Le prix doit être compris entre 0 et 2 000 € ; le prix', { nullable: true });
}

/** F4 — service payload (np_services without owner_id). price_cents null = « sur devis ». */
export function validateService(input = {}) {
  const trade = input.trade || null;
  if (trade && !Object.hasOwn(TRADES, trade)) fail('Métier invalide.');
  const allowed_locations = input.allowed_locations ?? 'both';
  if (!Object.hasOwn(ALLOWED_LOCATIONS, allowed_locations)) fail('Lieu autorisé invalide.');
  const refill_enabled = bool(input.refill_enabled, true);
  return {
    trade,
    name: text(input.name, 80, 'Le nom de la prestation', { required: true }),
    category: text(input.category, 40, 'La catégorie'),
    description: text(input.description, 300, 'La description'),
    duration_min: int(input.duration_min, 15, 480, 'La durée (minutes)', { step: 5 }),
    price_cents: parsePriceCents(input),
    allowed_locations,
    online: bool(input.online, true),
    prep_min: int(input.prep_min ?? 10, 0, 60, 'Le temps de préparation (minutes)'),
    refill_enabled,
    refill_days: int(input.refill_days, 7, 90, 'Le délai de relance (jours)', { nullable: true }),
    position: int(input.position ?? 0, 0, 1e6, 'La position'),
    archived: bool(input.archived, false)
  };
}

export function validateClient(input = {}) {
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const notes = String(input.notes || '').trim();
  const refillDays = Number(input.refill_days ?? 21);
  if (!name || name.length > 120) throw domainError('Le nom doit contenir entre 1 et 120 caractères.');
  if (email && (!EMAIL.test(email) || email.length > 254)) throw domainError('Adresse e-mail invalide.');
  if (notes.length > 2000) throw domainError('Les notes sont limitées à 2 000 caractères.');
  if (!Number.isInteger(refillDays) || refillDays < 7 || refillDays > 90) throw domainError('Le délai de remplissage doit être compris entre 7 et 90 jours.');
  const source = input.source || 'manual';
  if (!Object.hasOwn(CLIENT_SOURCES, source)) throw domainError('Source invalide.');
  return {
    name, preferred_name: text(input.preferred_name, 60, 'Le prénom d’usage'), phone: normalizePhone(input.phone), email, notes, source,
    refill_days: refillDays, reminder_opt_in: input.reminder_opt_in === true, refill_opt_in: input.refill_opt_in === true
  };
}

export function validateAddress(input = {}) {
  const postal_code = String(input.postal_code ?? input.postalCode ?? '').trim();
  if (!POSTAL.test(postal_code)) fail('Code postal invalide (5 chiffres).');
  return {
    label: text(input.label, 40, 'Le libellé'),
    address_line: text(input.address_line ?? input.line, 200, 'L’adresse', { required: true }),
    postal_code,
    city: text(input.city, 80, 'La ville', { required: true }),
    access_info: text(input.access_info ?? input.accessInfo, 300, 'Les infos d’accès'),
    is_primary: bool(input.is_primary, false)
  };
}

// ---------------------------------------------------------------------------
// 5.4 Scheduling rules — exact mirror of np_appointment_rules / np_available_slots
// ---------------------------------------------------------------------------
/** R1: pro → 0 / service prep (default 10); client → profile travel buffer both sides (default 30). */
export function computeBuffers({ location_type, service, profile } = {}) {
  if (location_type === 'client') {
    const travel = profile?.travel_buffer_min ?? DEFAULT_PROFILE.travel_buffer_min;
    return { before: travel, after: travel };
  }
  return { before: 0, after: service?.prep_min ?? 10 };
}

/** Derived ranges (service + blocked). ends_at = starts_at + duration_min (falls back to stored ends_at). */
export function blockRange(appointment) {
  const start = Date.parse(appointment.starts_at);
  const end = appointment.duration_min != null ? start + Number(appointment.duration_min) * MINUTE : Date.parse(appointment.ends_at);
  const before = Number(appointment.buffer_before_min || 0) * MINUTE, after = Number(appointment.buffer_after_min || 0) * MINUTE;
  const iso = t => new Date(t).toISOString();
  return { starts_at: iso(start), ends_at: iso(end), block_start: iso(start - before), block_end: iso(end + after) };
}

/** booked/done/no_show, or pending not yet expired. */
export function isBlocking(appointment, now = new Date()) {
  if (LIVE.includes(appointment.status)) return true;
  return appointment.status === 'pending' && !appointment.expired && Date.parse(appointment.expires_at) > +new Date(now);
}

const overlaps = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;
function rangesConflict(a, b) {
  const ra = blockRange(a), rb = blockRange(b);
  const t = x => Date.parse(x);
  return overlaps(t(ra.block_start), t(ra.block_end), t(rb.starts_at), t(rb.ends_at))
    || overlaps(t(ra.starts_at), t(ra.ends_at), t(rb.block_start), t(rb.block_end));
}

/** ADR-002: A and B conflict iff A.blocked ∩ B.service or A.service ∩ B.blocked. Returns the first conflicting appointment. */
export function conflicts(candidate, appointments = [], now = new Date()) {
  if (candidate.status && !['pending', ...LIVE].includes(candidate.status)) return null;
  return appointments.find(a => a.id !== candidate.id && isBlocking(a, now) && rangesConflict(candidate, a)) || null;
}

/** Empty list ⇒ true (radius is declarative in Lot 1). */
export function isInZone(profile, postalCode) {
  const zone = profile?.zone_postal_codes || [];
  return zone.length === 0 || zone.includes(String(postalCode ?? '').trim());
}

/** Throws a coded error if `location` is not offered for this service/profile (NP403 mirror). */
export function assertLocationAllowed(profile, service, location) {
  if (location === 'pro') {
    if (profile?.work_mode === 'mobile' || service?.allowed_locations === 'client') fail('Cette prestation n’est pas proposée sur place.', 'forbidden_location');
  } else if (location === 'client') {
    if (profile?.work_mode === 'home_studio' || service?.allowed_locations === 'pro') fail('Cette prestation n’est pas proposée à domicile.', 'forbidden_location');
  } else fail('Lieu invalide.');
}

/**
 * F8 — free start instants (ISO UTC), identical to np_available_slots.
 * from/to: 'AAAA-MM-JJ' Paris days (31 days max). postalCode is checked against the zone when given.
 */
export function availableSlots({ profile, openingHours = [], closures = [], appointments = [], service, location, from, to, now = new Date(), postalCode = null }) {
  if (!service) fail('Prestation introuvable.', 'not_found');
  const p = { ...DEFAULT_PROFILE, ...profile };
  assertLocationAllowed(p, service, location);
  if (location === 'client' && postalCode != null && postalCode !== '' && !isInZone(p, postalCode)) fail('Cette adresse est en dehors de la zone d’intervention.', 'forbidden_location');
  assertDay(from); assertDay(to);
  if (to < from || Date.parse(to) - Date.parse(from) > 31 * DAY_MS) fail('Période invalide (31 jours maximum).');
  const { before, after } = computeBuffers({ location_type: location, service, profile: p });
  const duration = Number(service.duration_min) * MINUTE;
  const nowMs = +new Date(now);
  const earliest = nowMs + p.min_notice_min * MINUTE, latest = nowMs + p.max_horizon_days * DAY_MS;
  const live = appointments.filter(a => isBlocking(a, now)).map(a => {
    const r = blockRange(a);
    return [Date.parse(r.starts_at), Date.parse(r.ends_at), Date.parse(r.block_start), Date.parse(r.block_end)];
  });
  const closed = closures.map(c => [Date.parse(c.starts_at), Date.parse(c.ends_at)]);
  const out = new Set();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = isoWeekday(day);
    for (const h of openingHours.filter(r => r.weekday === weekday)) {
      const rangeEnd = Date.parse(parisLenient(h.end_min >= 1440 ? `${addDays(day, 1)}T00:00` : `${day}T${minutesToTime(h.end_min)}`));
      for (let m = h.start_min; m <= h.end_min - service.duration_min; m += p.slot_step_min) {
        let s;
        try { s = Date.parse(fromParisLocal(`${day}T${minutesToTime(m)}`)); } catch { continue; } // R2: DST gap / ambiguity
        const e = s + duration;
        if (e > rangeEnd || s < earliest || s > latest) continue;
        if (closed.some(([cs, ce]) => overlaps(cs, ce, s, e))) continue;
        if (live.some(([as, ae, bs, be]) => overlaps(s - before * MINUTE, e + after * MINUTE, as, ae) || overlaps(s, e, bs, be))) continue;
        out.add(s);
      }
    }
  }
  return [...out].sort((a, b) => a - b).map(t => new Date(t).toISOString());
}

/** R5: min(now + 24 h, start − minimum notice). */
export function pendingExpiresAt(startsAt, profile, now = new Date()) {
  const notice = (profile?.min_notice_min ?? DEFAULT_PROFILE.min_notice_min) * MINUTE;
  return new Date(Math.min(+new Date(now) + DAY_MS, Date.parse(startsAt) - notice)).toISOString();
}

/** R6 — statuses reachable from the current one (mirror of the SQL trigger). */
export function allowedTransitions(appointment, now = new Date()) {
  const nowMs = +new Date(now);
  const started = Date.parse(appointment.starts_at) <= nowMs;
  switch (appointment.status) {
    case 'pending':
      return appointment.expired || Date.parse(appointment.expires_at) <= nowMs ? [] : ['booked', 'cancelled'];
    case 'booked': return started ? ['done', 'no_show', 'cancelled'] : ['done', 'cancelled'];
    case 'done': return started ? ['no_show', 'booked'] : ['booked'];
    case 'no_show': return ['done', 'booked'];
    case 'cancelled': return started || appointment.expired ? [] : ['booked'];
    default: return [];
  }
}

const APPOINTMENT_FIELDS = ['client_id', 'service_id', 'service_name', 'duration_min', 'price_cents', 'refill_enabled', 'refill_days',
  'location_type', 'address_line', 'postal_code', 'city', 'access_info', 'buffer_before_min', 'buffer_after_min', 'starts_at', 'status', 'cancel_reason'];

function validateAppointmentV1(input, appointments, clients) {
  const start = Date.parse(input.starts_at), end = Date.parse(input.ends_at);
  if (!clients.some(client => client.id === input.client_id && !client.archived)) throw domainError('Choisissez une cliente active.');
  if (!SERVICES.includes(input.service)) throw domainError('Choisissez une prestation.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 8 * 3600000) throw domainError('La durée doit être supérieure à 0 et inférieure ou égale à 8 heures.');
  if (!['booked', 'done', 'cancelled'].includes(input.status)) throw domainError('Statut invalide.');
  if (input.status !== 'cancelled' && appointments.some(a => a.id !== input.id && a.status !== 'cancelled' && start < Date.parse(a.ends_at) && end > Date.parse(a.starts_at))) throw domainError('Ce créneau chevauche un rendez-vous existant.', 'overlap');
  return { client_id: input.client_id, service: input.service, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), status: input.status };
}

/**
 * F5/F6 — validateAppointment(input, ctx) with ctx = { appointments, clients, services, profile, addresses?, now }.
 * Applies service snapshots and R1 buffers (unless explicitly overridden), R6 transitions and the ADR-002 conflict rule.
 * Never returns ends_at/block_*. Legacy V1 call validateAppointment(input, appointments[], clients[]) is still supported (@deprecated).
 */
export function validateAppointment(input, ctx = {}, legacyClients) {
  if (Array.isArray(ctx)) return validateAppointmentV1(input, ctx, legacyClients || []);
  const { appointments = [], clients = [], services = [], addresses = [], profile = DEFAULT_PROFILE, now = new Date() } = ctx;
  const nowMs = +new Date(now);
  const existing = input.id ? appointments.find(a => a.id === input.id) : null;
  if (input.id && !existing) fail('Rendez-vous introuvable.', 'not_found');

  const client_id = input.client_id ?? existing?.client_id;
  if (!existing || client_id !== existing.client_id) {
    if (!clients.some(c => c.id === client_id && !c.archived)) fail('Choisissez une cliente active.');
  }

  // Service snapshot (R8): prices and names are frozen at booking time.
  const service_id = input.service_id === undefined ? existing?.service_id ?? null : input.service_id || null;
  let snap;
  if (existing && service_id === existing.service_id) {
    snap = { service_name: existing.service_name, price_cents: existing.price_cents, refill_enabled: existing.refill_enabled ?? true, refill_days: existing.refill_days ?? null, duration_min: existing.duration_min };
  } else if (service_id) {
    const service = services.find(s => s.id === service_id);
    if (!service || service.archived) fail('Choisissez une prestation active.');
    snap = { service_name: service.name, price_cents: service.price_cents ?? null, refill_enabled: service.refill_enabled ?? true, refill_days: service.refill_days ?? null, duration_min: service.duration_min };
  } else {
    snap = { service_name: text(input.service_name, 80, 'La prestation', { required: true }), price_cents: int(input.price_cents, 0, 200000, 'Le prix', { nullable: true }), refill_enabled: true, refill_days: null, duration_min: input.duration_min };
  }
  const service = services.find(s => s.id === service_id) || null;
  const duration_min = int(input.duration_min ?? snap.duration_min, 5, 480, 'La durée (minutes)');

  const location_type = input.location_type ?? existing?.location_type ?? 'pro';
  if (!Object.hasOwn(LOCATIONS, location_type)) fail('Lieu invalide.');
  if (service && (!existing || location_type !== existing.location_type || service_id !== existing.service_id)) assertLocationAllowed({}, service, location_type);
  let address = { address_line: '', postal_code: '', city: '', access_info: '' };
  if (location_type === 'client') {
    const saved = input.address_id ? addresses.find(a => a.id === input.address_id && (!client_id || a.client_id === client_id)) : null;
    if (input.address_id && !saved) fail('Adresse introuvable.');
    const source = saved || (input.address_line !== undefined || input.address ? (input.address || input) : existing || {});
    const v = validateAddress({ ...source, postal_code: source.postal_code ?? source.postalCode });
    address = { address_line: v.address_line, postal_code: v.postal_code, city: v.city, access_info: v.access_info };
  }

  const start = Date.parse(input.starts_at ?? existing?.starts_at);
  if (!Number.isFinite(start)) fail('Date ou heure invalide.');
  const starts_at = new Date(start).toISOString();

  const defaults = computeBuffers({ location_type, service, profile });
  const keepBuffers = existing && location_type === existing.location_type && service_id === existing.service_id;
  const buffer_before_min = int(input.buffer_before_min ?? (keepBuffers ? existing.buffer_before_min : defaults.before), 0, 120, 'Le tampon avant (minutes)');
  const buffer_after_min = int(input.buffer_after_min ?? (keepBuffers ? existing.buffer_after_min : defaults.after), 0, 120, 'Le tampon après (minutes)');

  const status = input.status ?? existing?.status ?? 'booked';
  if (!Object.hasOwn(STATUSES, status)) fail('Statut invalide.');
  if (!existing && status === 'pending') fail('Seule une réservation en ligne peut être en attente.');
  if (existing && status !== existing.status) {
    if (existing.status === 'pending' && (existing.expired || Date.parse(existing.expires_at) <= nowMs)) fail('Cette demande a expiré.');
    if (['done', 'no_show'].includes(existing.status) && status === 'cancelled') fail('Un rendez-vous terminé ou non honoré ne peut plus être annulé.');
    if (status === 'pending') fail('Statut invalide.');
  }
  if (existing && Date.parse(existing.starts_at) < nowMs && (start !== Date.parse(existing.starts_at) || duration_min !== Number(existing.duration_min))) fail('Un rendez-vous passé ne peut pas être déplacé.');
  if (status === 'no_show' && start > nowMs) fail('Une absence ne peut être notée qu’après l’heure du rendez-vous.');

  const payload = {
    client_id, service_id, ...snap, duration_min, location_type, ...address, buffer_before_min, buffer_after_min, starts_at, status,
    cancel_reason: status === 'cancelled' ? text(input.cancel_reason ?? existing?.cancel_reason, 300, 'Le motif') : text(input.cancel_reason ?? '', 300, 'Le motif')
  };
  const changedSchedule = !existing || status !== existing.status || ['starts_at', 'duration_min', 'buffer_before_min', 'buffer_after_min'].some(k => String(payload[k]) !== String(k === 'starts_at' ? new Date(existing.starts_at).toISOString() : existing[k]));
  if (changedSchedule) {
    const hit = conflicts({ ...payload, id: input.id ?? null, expires_at: existing?.expires_at }, appointments, now);
    if (hit) fail('Ce créneau chevauche un rendez-vous existant (trajet ou préparation compris).', 'overlap');
  }
  return Object.fromEntries(APPOINTMENT_FIELDS.map(k => [k, payload[k]]));
}

/** Soft checks shown before saving (explicit confirmation in the UI). ctx = { profile, openingHours, closures }. */
export function appointmentWarnings(input, ctx = {}) {
  const { profile = DEFAULT_PROFILE, openingHours = [], closures = [] } = ctx;
  const warnings = [];
  const r = blockRange({ ...input, duration_min: input.duration_min ?? (input.ends_at ? null : 0) });
  const s = Date.parse(r.starts_at), e = Date.parse(r.ends_at);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return warnings;
  const day = parisDay(r.starts_at);
  const inside = openingHours.filter(h => h.weekday === isoWeekday(day)).some(h => {
    const hs = Date.parse(parisLenient(`${day}T${minutesToTime(h.start_min)}`));
    const he = Date.parse(parisLenient(h.end_min >= 1440 ? `${addDays(day, 1)}T00:00` : `${day}T${minutesToTime(h.end_min)}`));
    return s >= hs && e <= he;
  });
  if (!inside) warnings.push('outside_hours');
  if (closures.some(c => overlaps(Date.parse(c.starts_at), Date.parse(c.ends_at), s, e))) warnings.push('closed');
  if (input.location_type === 'client' && !isInZone(profile, input.postal_code ?? input.address?.postal_code)) warnings.push('outside_zone');
  return warnings;
}

// ---------------------------------------------------------------------------
// 5.5 Messages and links
// ---------------------------------------------------------------------------
export function renderTemplate(template, vars = {}) {
  return String(template ?? '').replace(/\{([a-z_]+)\}/g, (match, key) => (TEMPLATE_VARIABLES.includes(key) || Object.hasOwn(vars, key) ? String(vars[key] ?? '') : match));
}

export function firstName(client) {
  return String(client?.preferred_name || client?.name || '').trim().split(/\s+/)[0] || '';
}
function joinAddress(line, postal, city) {
  return [String(line || '').trim(), [postal, city].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
}
/** Location phrase: « chez moi, [adresse ou ville] » or « chez vous au [adresse] ». */
export function locationPhrase(appointment, profile = {}, publicProfile = {}) {
  if (appointment?.location_type === 'client') return `chez vous au ${joinAddress(appointment.address_line, appointment.postal_code, appointment.city)}`;
  const base = joinAddress(profile.base_address_line, profile.base_postal_code, profile.base_city);
  return `chez moi, ${base || publicProfile.city || profile.base_city || ''}`.replace(/, $/, '');
}

/** kind ∈ confirmation | decline | reminder | refill. Uses the pro's template, or DEFAULT_TEMPLATES when empty. */
export function buildMessage(kind, { appointment = {}, client = {}, profile = {}, publicProfile = {}, bookingUrl = '' } = {}) {
  if (!Object.hasOwn(DEFAULT_TEMPLATES, kind)) fail('Type de message inconnu.');
  const template = String(profile?.[`template_${kind}`] || '').trim() || DEFAULT_TEMPLATES[kind];
  const starts = appointment.starts_at;
  const vars = {
    prenom: firstName(client),
    date: starts ? formatDate(starts, { weekday: 'long', day: 'numeric', month: 'long', hour: undefined, minute: undefined }).replace(/(^|\s)1(?=\s)/, '$11er') : '',
    heure: starts ? formatTime(starts) : '',
    prestation: String(appointment.service_name || appointment.service || '').toLowerCase(),
    adresse: locationPhrase(appointment, profile, publicProfile),
    lien: bookingUrl || ''
  };
  return renderTemplate(template, vars).replace(/[ \t]+/g, ' ').replace(/ ([,.])/g, '$1').replace(/:\s*$/, '').trim();
}

export function smsLink(phone, body = '') {
  let number = '';
  try { number = normalizePhone(phone); } catch { number = ''; }
  return `sms:${number}?&body=${encodeURIComponent(body)}`;
}
export function whatsappLink(phone, body = '') {
  let number = '';
  try { number = normalizePhone(phone).replace(/^\+/, ''); } catch { number = ''; }
  return `https://wa.me/${number}?text=${encodeURIComponent(body)}`;
}
export function mapsLink(address) {
  const query = typeof address === 'string' ? address : joinAddress(address?.address_line ?? address?.line, address?.postal_code ?? address?.postalCode, address?.city);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Any CR, LF or CRLF becomes an escaped \n: a lone CR must not start a new iCalendar property (audit 2026-10).
const icsText = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsDate = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545 single event, CRLF line endings, UTC times. */
export function icsEvent({ title, starts_at, ends_at, location = '', description = '', uid, now = new Date() }) {
  if (!Number.isFinite(Date.parse(starts_at)) || !Number.isFinite(Date.parse(ends_at))) fail('Dates invalides.');
  const id = uid || `${icsDate(starts_at)}-${String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}@nailpilot`;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NailPilot//Reservation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${id}`, `DTSTAMP:${icsDate(now)}`, `DTSTART:${icsDate(starts_at)}`, `DTEND:${icsDate(ends_at)}`, `SUMMARY:${icsText(title)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []), ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

/** CSV (RFC 4180) with formula-injection guard. Columns = union of keys in first-seen order. */
export function toCsv(rows = [], { separator = ',' } = {}) {
  const columns = [...new Set(rows.flatMap(r => Object.keys(r ?? {})))];
  const cell = value => {
    let v = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
    return /[",;\r\n]/.test(v) || v.includes(separator) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [columns.map(cell).join(separator), ...rows.map(r => columns.map(c => cell(r?.[c])).join(separator))].join('\r\n');
}

// ---------------------------------------------------------------------------
// Notifications (F10, F11) — V1 engine extended to snapshots refill_* and V2 statuses
// ---------------------------------------------------------------------------
export function refillDueAt(appointment, days) {
  // Calendar days in Paris: preserve local end time across DST, resolved like PostgreSQL AT TIME ZONE.
  return parisLenient(`${addDays(parisDay(appointment.ends_at), days)}T${parisLocal(appointment.ends_at).slice(11)}`);
}

/**
 * Reminder (24 h before a booked appointment, consent required) and refill suggestions (latest done appointment,
 * delay from the appointment snapshot or the client, suppressed by any upcoming booked/pending appointment).
 * options = { profile, publicProfile, bookingUrl } feed message texts.
 */
export function notificationCandidates(clients, appointments, now = new Date(), options = {}) {
  const timestamp = +new Date(now);
  const candidates = [];
  for (const client of clients.filter(c => !c.archived)) {
    const own = appointments.filter(a => a.client_id === client.id);
    if (client.reminder_opt_in) {
      for (const a of own.filter(a => a.status === 'booked' && Date.parse(a.starts_at) > timestamp && Date.parse(a.starts_at) - DAY_MS <= timestamp)) {
        candidates.push({ id: `${a.id}:reminder`, kind: 'reminder', client_id: client.id, appointment_id: a.id, due_at: new Date(Date.parse(a.starts_at) - DAY_MS).toISOString(), reference_at: a.starts_at, message: buildMessage('reminder', { appointment: a, client, ...options }) });
      }
    }
    const latest = own.filter(a => a.status === 'done' && Date.parse(a.ends_at) <= timestamp).sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at))[0];
    if (client.refill_opt_in && latest && latest.refill_enabled !== false && !own.some(a => ['booked', 'pending'].includes(a.status) && Date.parse(a.ends_at) > timestamp)) {
      let due;
      try { due = refillDueAt(latest, latest.refill_days ?? client.refill_days ?? 21); } catch { continue; }
      if (Date.parse(due) <= timestamp) candidates.push({ id: `${latest.id}:refill`, kind: 'refill', client_id: client.id, appointment_id: latest.id, due_at: due, reference_at: latest.ends_at, message: buildMessage('refill', { appointment: latest, client, ...options }) });
    }
  }
  return candidates;
}

/** Idempotent merge. Only reminder/refill rows are reconciled; event rows (confirmation, new_request…) are kept as-is. */
export function reconcileNotifications(previous, clients, appointments, now = new Date(), options = {}) {
  const candidates = notificationCandidates(clients, appointments, now, options);
  const keys = new Set(candidates.map(n => n.id));
  const scheduled = n => n.kind === 'reminder' || n.kind === 'refill';
  const retained = previous.filter(n => !keys.has(n.id)).map(n => (scheduled(n) ? { ...n, status: 'invalidated' } : n));
  return [...retained, ...candidates.map(n => {
    const old = previous.find(p => p.id === n.id);
    const dismissed = old?.status === 'dismissed' && old.reference_at === n.reference_at;
    return { ...n, status: dismissed ? 'dismissed' : 'ready' };
  })];
}
