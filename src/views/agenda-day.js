// F5, F6 — vue jour : frise horaire avec trajets hachurés et plages fermées grisées.
import { e, minutesLabel } from '../components/format.js';
import { icon } from '../components/icons.js';
import { appointmentCard } from '../components/appointment-card.js';
import { dayAppointments, dayColumn, hourWindow, hoursRail, openRanges, sizeTimeline } from '../components/timeline.js';

export function render(ctx, day) {
  const { store } = ctx;
  const all = dayAppointments(store, day);
  const live = all.filter(a => a.status !== 'cancelled');
  const cancelled = all.filter(a => a.status === 'cancelled');
  const work = live.reduce((sum, a) => sum + (a.duration_min || 0), 0);
  const travel = live.filter(a => a.location_type === 'client').reduce((sum, a) => sum + (a.buffer_before_min || 0) + (a.buffer_after_min || 0), 0);
  const open = openRanges(store, day);
  const window = hourWindow(store, [day]);
  return `<div class="day-summary" aria-label="Résumé de la journée">
      <span class="pill">${icon('calendar')}<strong>${live.length}</strong> rendez-vous</span>
      <span class="pill">${icon('sparkle')}<strong>${e(minutesLabel(work))}</strong> de prestations</span>
      ${travel ? `<span class="pill pill-travel">${icon('car')}<strong>${e(minutesLabel(travel))}</strong> de trajet bloqué</span>` : ''}
      ${open.length ? '' : `<span class="pill pill-closed">${icon('info')}Fermé ce jour</span>`}
    </div>
    <div class="timeline card" data-timeline>
      ${hoursRail(window)}${dayColumn(store, day, window)}
    </div>
    <p class="legend"><span class="legend-swatch swatch-buffer" aria-hidden="true"></span>Temps de trajet ou de préparation bloqué <span class="legend-swatch swatch-closed" aria-hidden="true"></span>Hors horaires · Touchez un créneau libre pour ajouter un rendez-vous.</p>
    ${live.length ? `<h2 class="section-title">Liste du jour</h2><div class="card-list">${live.map(a => appointmentCard(a, store)).join('')}</div>` : `<div class="empty-state">${icon('sun', { className: 'icon-xl' })}<h2>Journée libre</h2><p>Aucun rendez-vous prévu. Touchez un créneau pour en ajouter un.</p></div>`}
    ${cancelled.length ? `<details class="disclosure"><summary>${cancelled.length} rendez-vous annulé${cancelled.length > 1 ? 's' : ''}</summary><div class="card-list">${cancelled.map(a => appointmentCard(a, store, { compact: true })).join('')}</div></details>` : ''}`;
}

export function bind(root) { sizeTimeline(root); }
