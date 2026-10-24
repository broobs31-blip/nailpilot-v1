// Frise horaire (agenda jour et colonnes semaine) : plages fermées grisées, tampons hachurés.
import { isoWeekday, fromParisLocal, addDays } from '../domain.js';
import { e, hm, localDay, localMinutes, minutesLabel, clientName, today } from './format.js';
import { icon } from './icons.js';
import { statusBadge } from './status-badge.js';
import { outsideHoursBadge } from './appointment-card.js';

export const PX = 1.15; // pixels par minute

/** Début/fin de prestation et plage bloquée (tampons inclus), en ISO. */
export function bounds(a) {
  const before = a.buffer_before_min || 0, after = a.buffer_after_min || 0;
  const end = a.ends_at || new Date(Date.parse(a.starts_at) + (a.duration_min || 0) * 60000).toISOString();
  return {
    starts_at: a.starts_at, ends_at: end,
    block_start: a.block_start || new Date(Date.parse(a.starts_at) - before * 60000).toISOString(),
    block_end: a.block_end || new Date(Date.parse(end) + after * 60000).toISOString()
  };
}

export function dayAppointments(store, day) {
  return store.state.appointments
    .filter(a => localDay(a.starts_at) === day)
    .sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
}

/** Plages ouvertes du jour en minutes, fermetures déduites. */
export function openRanges(store, day) {
  let weekday;
  try { weekday = isoWeekday(day); } catch { weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; }
  let ranges = (store.state.openingHours || []).filter(h => h.weekday === weekday).map(h => [h.start_min, h.end_min]).sort((x, y) => x[0] - y[0]);
  let dayStart, dayEnd;
  // Jour de 23 h ou 25 h au changement d'heure : la fin est le minuit local suivant, pas début + 24 h.
  try { dayStart = Date.parse(fromParisLocal(`${day}T00:00`)); dayEnd = Date.parse(fromParisLocal(`${addDays(day, 1)}T00:00`)); } catch { return ranges; }
  for (const c of store.state.closures || []) {
    const cs = Date.parse(c.starts_at), ce = Date.parse(c.ends_at);
    if (ce <= dayStart || cs >= dayEnd) continue;
    const from = cs <= dayStart ? 0 : localMinutes(c.starts_at);
    const to = ce >= dayEnd ? 1440 : localMinutes(c.ends_at);
    ranges = ranges.flatMap(([s, t]) => (to <= s || from >= t) ? [[s, t]] : [[s, Math.min(t, from)], [Math.max(s, to), t]].filter(([x, y]) => y > x));
  }
  return ranges;
}

export function hourWindow(store, days) {
  let start = 8 * 60, end = 19 * 60;
  for (const day of days) {
    for (const [s, t] of openRanges(store, day)) { start = Math.min(start, s); end = Math.max(end, t); }
    for (const a of dayAppointments(store, day).filter(a => a.status !== 'cancelled')) {
      const b = bounds(a);
      start = Math.min(start, localDay(b.block_start) === day ? localMinutes(b.block_start) : 0);
      end = Math.max(end, localDay(b.block_end) === day ? localMinutes(b.block_end) : 1440);
    }
  }
  return [Math.floor(start / 60) * 60, Math.min(1440, Math.ceil(end / 60) * 60)];
}

export function hoursRail([start, end]) {
  const rows = [];
  for (let m = start; m < end; m += 60) rows.push(`<span class="tl-hour" data-top="${(m - start) * PX}" data-height="${60 * PX}">${m / 60} h</span>`);
  return `<div class="tl-rail" aria-hidden="true" data-height-total="${(end - start) * PX}">${rows.join('')}</div>`;
}

/** Une colonne de frise pour un jour donné. */
export function dayColumn(store, day, [start, end], { compact = false } = {}) {
  const height = (end - start) * PX;
  const open = openRanges(store, day);
  const closed = [];
  let cursor = start;
  for (const [s, t] of open) { if (s > cursor) closed.push([cursor, Math.min(s, end)]); cursor = Math.max(cursor, t); }
  if (cursor < end) closed.push([cursor, end]);
  const slots = [];
  for (let m = start; m < end; m += 30) {
    const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const isOpen = open.some(([s, t]) => m >= s && m < t);
    slots.push(`<button type="button" class="tl-slot${isOpen ? '' : ' is-closed'}" data-slot="${e(day)}T${time}" data-top="${(m - start) * PX}" data-height="${30 * PX}" tabindex="-1" aria-label="Nouveau rendez-vous le ${e(day)} à ${hm(fromSafe(day, time))}"></button>`);
  }
  const appts = dayAppointments(store, day).filter(a => a.status !== 'cancelled').map(a => {
    const b = bounds(a);
    const top = Math.max(0, (localDay(b.block_start) === day ? localMinutes(b.block_start) : 0) - start) * PX;
    const bottom = Math.min(end, localDay(b.block_end) === day ? localMinutes(b.block_end) : 1440) - start;
    const h = Math.max(24, bottom * PX - top);
    const before = (Date.parse(b.starts_at) - Date.parse(b.block_start)) / 60000;
    const after = (Date.parse(b.block_end) - Date.parse(b.ends_at)) / 60000;
    const travel = a.location_type === 'client';
    const who = a.client_id ? clientName(store, a.client_id) : 'Cliente supprimée';
    const bufferLabel = (min, where) => `${travel ? 'Trajet' : 'Préparation'} ${minutesLabel(min)} ${where}`;
    return `<div class="tl-appt status-${e(a.status)}${a.expired ? ' is-expired' : ''}" data-top="${top}" data-height="${h}">
      ${before ? `<div class="tl-buffer tl-buffer-before" data-flex="${before}" title="${e(bufferLabel(before, 'avant'))}"><span>${icon(travel ? 'car' : 'clock')}${compact ? '' : e(bufferLabel(before, 'avant'))}</span></div>` : ''}
      <button type="button" class="tl-body" data-appointment="${e(a.id)}" data-flex="${a.duration_min || (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000}">
        <span class="tl-time">${e(hm(a.starts_at))}${compact ? '' : ` – ${e(hm(b.ends_at))}`}${outsideHoursBadge(a, store, { compact: true })}</span>
        <strong class="tl-client">${e(who)}</strong>
        ${compact ? '' : `<span class="tl-service">${e(a.service_name || '')}</span>`}
        <span class="tl-meta">${icon(travel ? 'car' : 'home')}${compact ? '' : `<span>${travel ? e(a.city || 'Chez la cliente') : 'Chez moi'}</span>`}${a.status !== 'booked' ? statusBadge(a.status, { expired: a.expired }) : ''}</span>
      </button>
      ${after ? `<div class="tl-buffer tl-buffer-after" data-flex="${after}" title="${e(bufferLabel(after, 'après'))}"><span>${icon(travel ? 'car' : 'sparkle')}${compact ? '' : e(bufferLabel(after, 'après'))}</span></div>` : ''}
    </div>`;
  });
  let now = '';
  if (day === today()) {
    const m = localMinutes(new Date().toISOString());
    if (m >= start && m <= end) now = `<div class="tl-now" data-top="${(m - start) * PX}" data-height="2" aria-hidden="true"></div>`;
  }
  return `<div class="tl-col" data-height-total="${height}">
    ${closed.map(([s, t]) => `<div class="tl-closed" data-top="${(s - start) * PX}" data-height="${(t - s) * PX}" aria-hidden="true"></div>`).join('')}
    ${slots.join('')}${appts.join('')}${now}</div>`;
}

function fromSafe(day, time) { try { return fromParisLocal(`${day}T${time}`); } catch { return `${day}T${time}:00Z`; } }

/** Applique les dimensions (CSSOM : autorisé par la CSP, contrairement aux attributs style). */
export function sizeTimeline(root) {
  root.querySelectorAll('[data-height-total]').forEach(el => { el.style.height = `${el.dataset.heightTotal}px`; });
  root.querySelectorAll('[data-flex]').forEach(el => { el.style.flexGrow = el.dataset.flex; });
}
