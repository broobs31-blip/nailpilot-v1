// F5 — vue semaine : 7 colonnes sur grand écran, liste par jour sur téléphone (pas de défilement horizontal).
import { weekDays } from '../domain.js';
import { e, dayLabel, today, capitalize } from '../components/format.js';
import { icon } from '../components/icons.js';
import { appointmentCard } from '../components/appointment-card.js';
import { dayAppointments, dayColumn, hourWindow, hoursRail, openRanges, sizeTimeline } from '../components/timeline.js';

export function title(day) {
  const days = weekDays(day);
  const from = dayLabel(days[0], { day: 'numeric', month: days[0].slice(5, 7) === days[6].slice(5, 7) ? undefined : 'short' });
  return `Semaine du ${from} au ${dayLabel(days[6], { day: 'numeric', month: 'long' })}`;
}

export function render(ctx, day) {
  const { store } = ctx;
  const days = weekDays(day);
  const wide = matchMedia('(min-width: 768px)').matches;
  const count = days.reduce((n, d) => n + dayAppointments(store, d).filter(a => a.status !== 'cancelled').length, 0);
  if (wide) {
    const window = hourWindow(store, days);
    return `<p class="day-summary"><span class="pill">${icon('calendar')}<strong>${count}</strong> rendez-vous cette semaine</span></p>
      <div class="week card" data-timeline>
        <div class="week-head"><span></span>${days.map(d => `<a class="week-day${d === today() ? ' is-today' : ''}" href="#/agenda/jour/${e(d)}"><small>${e(dayLabel(d, { weekday: 'short' }))}</small><strong>${e(d.slice(8).replace(/^0/, ''))}</strong></a>`).join('')}</div>
        <div class="week-body">${hoursRail(window)}${days.map(d => dayColumn(store, d, window, { compact: true })).join('')}</div>
      </div>
      <p class="legend"><span class="legend-swatch swatch-buffer" aria-hidden="true"></span>Trajet / préparation <span class="legend-swatch swatch-closed" aria-hidden="true"></span>Hors horaires</p>`;
  }
  return `<p class="day-summary"><span class="pill">${icon('calendar')}<strong>${count}</strong> rendez-vous cette semaine</span></p>
    <div class="week-list">${days.map(d => {
      const list = dayAppointments(store, d).filter(a => a.status !== 'cancelled');
      const closed = !openRanges(store, d).length;
      return `<section class="week-list-day${d === today() ? ' is-today' : ''}" aria-labelledby="wd-${e(d)}">
        <header><h2 id="wd-${e(d)}"><a href="#/agenda/jour/${e(d)}">${e(capitalize(dayLabel(d, { weekday: 'long', day: 'numeric', month: 'short' })))}</a></h2>
          ${closed ? '<span class="chip">Fermé</span>' : `<button type="button" class="icon-btn icon-btn-sm" data-slot="${e(d)}T09:00" aria-label="Ajouter un rendez-vous le ${e(dayLabel(d))}">${icon('plus')}</button>`}</header>
        ${list.length ? `<div class="card-list">${list.map(a => appointmentCard(a, store, { compact: true })).join('')}</div>` : `<p class="muted week-free">${closed ? 'Journée de repos' : 'Aucun rendez-vous'}</p>`}
      </section>`;
    }).join('')}</div>`;
}

export function bind(root) { sizeTimeline(root); }
