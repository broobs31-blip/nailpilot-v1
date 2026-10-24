// Aides de présentation (affichage seul ; la logique métier reste dans domain.js).
import { parisLocal, TIME_ZONE, escapeHtml } from '../domain.js';

export const e = escapeHtml;
export const today = () => parisLocal().slice(0, 10);
export const localDay = iso => parisLocal(iso).slice(0, 10);
export const localMinutes = iso => { const [h, m] = parisLocal(iso).slice(11, 16).split(':').map(Number); return h * 60 + m; };

/** '14:30' → '14 h 30' ; '09:00' → '9 h' */
export function hm(iso) {
  const [h, m] = parisLocal(iso).slice(11, 16).split(':');
  return m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`;
}
export function hmRange(startIso, endIso) { return `${hm(startIso)} – ${hm(endIso)}`; }

const fmt = (options) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options });
/** Libellé d'un jour local 'AAAA-MM-JJ' (aucun décalage : midi UTC). */
export function dayLabel(day, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return fmt(options).format(new Date(`${day}T12:00:00Z`));
}
export function dateTimeLabel(iso) {
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
  return `${day} à ${hm(iso)}`;
}
export const capitalize = s => s ? s[0].toLocaleUpperCase('fr') + s.slice(1) : s;

export function relativeDay(day) {
  const t = today();
  if (day === t) return 'Aujourd’hui';
  const diff = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${t}T12:00:00Z`)) / 86400000);
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  return capitalize(dayLabel(day));
}

export function minutesLabel(min) {
  if (!min) return '0 min';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${m} min`;
}

export function initials(name = '') {
  return name.replace(/·.*$/, '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toLocaleUpperCase('fr') || '?';
}

export function clientName(store, id) {
  const c = store.state.clients.find(x => x.id === id);
  return c ? (c.preferred_name || c.name) : 'Cliente supprimée';
}

export function phoneDisplay(phone = '') {
  if (/^\+33\d{9}$/.test(phone)) return `0${phone.slice(3)}`.replace(/(\d{2})(?=\d)/g, '$1 ');
  return phone;
}

export function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formValues(form) {
  const data = new FormData(form);
  const out = {};
  for (const [key, value] of data) out[key] = typeof value === 'string' ? value.trim() : value;
  return out;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.className = 'sr-only';
    document.body.append(area); area.select();
    const ok = document.execCommand?.('copy'); area.remove();
    return Boolean(ok);
  }
}

export function readyMessages(store) {
  return (store.state.notifications || []).filter(n => n.status === 'ready' && (n.kind === 'reminder' || n.kind === 'refill')).length;
}
