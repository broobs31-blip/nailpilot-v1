// Carte compacte d'un rendez-vous (listes : tableau de bord, semaine mobile, fiche cliente).
import { icon } from './icons.js';
import { e, hm, clientName, minutesLabel, dateTimeLabel, capitalize } from './format.js';
import { statusBadge } from './status-badge.js';

export function locationLabel(a) {
  return a.location_type === 'client'
    ? `${icon('car')}<span>Chez la cliente${a.city ? ` · ${e(a.city)}` : ''}</span>`
    : `${icon('home')}<span>Chez moi</span>`;
}

export function bufferChips(a) {
  const travel = a.location_type === 'client';
  const chips = [];
  if (a.buffer_before_min) chips.push(`<span class="chip chip-buffer">${icon(travel ? 'car' : 'clock')}${travel ? 'Trajet' : 'Préparation'} ${e(minutesLabel(a.buffer_before_min))} avant</span>`);
  if (a.buffer_after_min) chips.push(`<span class="chip chip-buffer">${icon(travel ? 'car' : 'sparkle')}${travel ? 'Trajet' : 'Préparation'} ${e(minutesLabel(a.buffer_after_min))} après</span>`);
  return chips.join('');
}

export function appointmentCard(a, store, { showDate = false, compact = false } = {}) {
  const who = a.client_id ? clientName(store, a.client_id) : 'Cliente supprimée';
  const when = showDate ? capitalize(dateTimeLabel(a.starts_at)) : hm(a.starts_at);
  return `<button type="button" class="appt-card status-${e(a.status)}${a.expired ? ' is-expired' : ''}" data-appointment="${e(a.id)}">
    <span class="appt-time"><strong>${e(when)}</strong><small>${e(minutesLabel(a.duration_min || 0))}</small></span>
    <span class="appt-main"><strong class="appt-client">${e(who)}</strong>
      <span class="appt-service">${e(a.service_name || '')}</span>
      <span class="appt-meta">${locationLabel(a)}</span>
      ${compact ? '' : `<span class="appt-chips">${bufferChips(a)}</span>`}</span>
    <span class="appt-status">${statusBadge(a.status, { expired: a.expired })}</span>
  </button>`;
}
