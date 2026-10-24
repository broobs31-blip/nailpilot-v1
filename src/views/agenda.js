// F5 — agenda : aiguillage jour / semaine, navigation et mémorisation de la vue.
import { addDays } from '../domain.js';
import { icon } from '../components/icons.js';
import { e, today, dayLabel, capitalize } from '../components/format.js';
import * as day from './agenda-day.js';
import * as week from './agenda-week.js';

const KEY = 'np-agenda-mode';
function preferredMode() {
  try { const saved = localStorage.getItem(KEY); if (saved === 'jour' || saved === 'semaine') return saved; } catch { /* stockage indisponible */ }
  return matchMedia('(min-width: 768px)').matches ? 'semaine' : 'jour';
}

export function render(ctx) {
  const { mode, day: current } = ctx.route.params;
  if (!mode) return '<p class="page-pad muted">Ouverture de l’agenda…</p>';
  const view = mode === 'semaine' ? week : day;
  const step = mode === 'semaine' ? 7 : 1;
  const title = mode === 'semaine' ? week.title(current) : capitalize(dayLabel(current));
  return `<section class="page agenda-page">
    <header class="page-head agenda-head">
      <div><p class="eyebrow">${mode === 'semaine' ? 'Ma semaine' : current === today() ? 'Aujourd’hui' : 'Ma journée'}</p><h1>${e(title)}</h1></div>
      <div class="agenda-tools">
        <div class="segmented segmented-sm" role="group" aria-label="Affichage">
          <a class="segment-link${mode === 'jour' ? ' is-active' : ''}" href="#/agenda/jour/${e(current)}"${mode === 'jour' ? ' aria-current="page"' : ''} data-mode="jour">Jour</a>
          <a class="segment-link${mode === 'semaine' ? ' is-active' : ''}" href="#/agenda/semaine/${e(current)}"${mode === 'semaine' ? ' aria-current="page"' : ''} data-mode="semaine">Semaine</a>
        </div>
        <div class="date-nav">
          <a class="icon-btn" href="#/agenda/${mode}/${e(addDays(current, -step))}" aria-label="${mode === 'semaine' ? 'Semaine précédente' : 'Jour précédent'}">${icon('chevronLeft')}</a>
          <a class="btn btn-secondary btn-sm" href="#/agenda/${mode}/${e(today())}">Aujourd’hui</a>
          <label class="sr-only" for="agenda-date">Aller à la date</label><input class="date-input" id="agenda-date" type="date" value="${e(current)}">
          <a class="icon-btn" href="#/agenda/${mode}/${e(addDays(current, step))}" aria-label="${mode === 'semaine' ? 'Semaine suivante' : 'Jour suivant'}">${icon('chevronRight')}</a>
        </div>
        <button type="button" class="btn btn-primary btn-new" data-new>${icon('plus')}<span>Nouveau RDV</span></button>
      </div>
    </header>
    ${view.render(ctx, current)}
  </section>`;
}

export function bind(root, ctx) {
  const { mode, day: current } = ctx.route.params;
  if (!mode) { ctx.navigate(`agenda/${preferredMode()}/${today()}`, { replace: true }); return; }
  root.querySelectorAll('[data-mode]').forEach(link => link.addEventListener('click', () => { try { localStorage.setItem(KEY, link.dataset.mode); } catch { /* ignore */ } }));
  root.querySelector('#agenda-date').addEventListener('change', event => { if (event.target.value) ctx.navigate(`agenda/${mode}/${event.target.value}`); });
  root.querySelector('[data-new]').addEventListener('click', () => ctx.openAppointment({ day: current < today() ? today() : current }));
  root.querySelectorAll('[data-appointment]').forEach(el => el.addEventListener('click', () => ctx.openAppointment(el.dataset.appointment)));
  root.querySelectorAll('[data-slot]').forEach(el => el.addEventListener('click', () => {
    const [d, t] = el.dataset.slot.split('T');
    ctx.openAppointment({ day: d, time: t });
  }));
  root.querySelectorAll('[data-top]').forEach(el => { el.style.top = `${el.dataset.top}px`; el.style.height = `${el.dataset.height}px`; });
  (mode === 'semaine' ? week : day).bind?.(root, ctx, current);
}
