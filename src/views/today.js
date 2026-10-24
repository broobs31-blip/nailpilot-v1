// Tableau de bord du jour : prochain RDV, trajets, demandes en attente, rappels à envoyer, lien à partager.
import { formatPrice, mapsLink } from '../domain.js';
import { icon } from '../components/icons.js';
import { e, hm, today, dayLabel, capitalize, minutesLabel, clientName, copyText, dateTimeLabel, relativeDay, localDay, readyMessages } from '../components/format.js';
import { appointmentCard, locationLabel } from '../components/appointment-card.js';
import { addressText } from '../components/address-fields.js';
import { bounds } from '../components/timeline.js';
import { bookingUrl } from '../router.js';
import { afterDecision, declineFlow } from './appointment-dialog.js';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

function countdown(iso) {
  const min = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (min <= 0) return 'en cours';
  if (min < 60) return `dans ${min} min`;
  if (min < 24 * 60) return `dans ${minutesLabel(Math.round(min / 5) * 5)}`;
  return relativeDay(localDay(iso)).toLocaleLowerCase('fr');
}

export function render(ctx) {
  const { store } = ctx;
  const s = store.state;
  const pub = s.publicProfile || {};
  const day = today();
  const now = Date.now();
  const todays = s.appointments.filter(a => localDay(a.starts_at) === day && a.status !== 'cancelled').sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
  const upcoming = s.appointments.filter(a => ['booked', 'pending'].includes(a.status) && !a.expired && Date.parse(bounds(a).ends_at) > now).sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
  const next = upcoming.find(a => a.status === 'booked') || null;
  const pending = s.appointments.filter(a => a.status === 'pending' && !a.expired).sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
  const reminders = (s.notifications || []).filter(n => n.status === 'ready' && n.kind === 'reminder');
  const expired = (s.notifications || []).filter(n => n.status === 'ready' && n.kind === 'request_expired');
  const revenue = todays.filter(a => a.status !== 'no_show').reduce((sum, a) => sum + (a.price_cents || 0), 0);
  const travel = todays.filter(a => a.location_type === 'client').reduce((sum, a) => sum + (a.buffer_before_min || 0) + (a.buffer_after_min || 0), 0);
  const setup = [
    !(s.services || []).some(x => !x.archived) && ['prestations', 'Ajoutez vos prestations', 'sparkle'],
    !(s.openingHours || []).length && ['reglages/horaires', 'Indiquez vos horaires', 'clock'],
    pub.slug && !pub.published && ['reglages/profil', 'Mettez votre page en ligne', 'link']
  ].filter(Boolean);
  const hour = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const hello = hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
  const firstName = pub.display_name || '';

  const nextCard = next ? (() => {
    const b = bounds(next);
    const address = next.location_type === 'client' ? addressText(next) : '';
    const maps = address ? safe(() => mapsLink(address), '') : '';
    const leave = next.location_type === 'client' && next.buffer_before_min ? `<p class="next-leave">${icon('car')}Départ conseillé à <strong>${e(hm(b.block_start))}</strong></p>` : '';
    return `<article class="next-card" aria-labelledby="next-title">
      <p class="eyebrow eyebrow-light">Prochain rendez-vous · ${e(countdown(next.starts_at))}</p>
      <h2 id="next-title" class="next-time">${localDay(next.starts_at) === day ? e(hm(next.starts_at)) : e(capitalize(dateTimeLabel(next.starts_at)))}</h2>
      <p class="next-who"><strong>${e(clientName(store, next.client_id))}</strong> · ${e(next.service_name)}</p>
      <p class="next-where">${locationLabel(next)}${address ? `<span class="next-address">${e(address)}</span>` : ''}</p>
      ${leave}
      <div class="next-actions"><button type="button" class="btn btn-light" data-appointment="${e(next.id)}">Voir le détail</button>
        ${maps ? `<a class="btn btn-outline-light" href="${e(maps)}" target="_blank" rel="noopener noreferrer">${icon('pin')}Itinéraire</a>` : ''}</div>
    </article>`;
  })() : `<article class="next-card next-empty"><p class="eyebrow eyebrow-light">Prochain rendez-vous</p><h2 class="next-time">Rien de prévu</h2><p>Partagez votre lien pour remplir votre agenda.</p>
      <div class="next-actions"><button type="button" class="btn btn-light" data-new>${icon('plus')}Ajouter un rendez-vous</button></div></article>`;

  const programme = todays.length ? todays.map((a, i) => {
    let gap = '';
    const prev = todays[i - 1];
    if (prev) {
      const free = Math.round((Date.parse(bounds(a).block_start) - Date.parse(bounds(prev).block_end)) / 60000);
      const trip = a.location_type === 'client' ? a.buffer_before_min : 0;
      gap = `<li class="gap" aria-hidden="${trip || free >= 15 ? 'false' : 'true'}">${trip ? `${icon('car')}<span>Trajet ${e(minutesLabel(trip))}</span>` : ''}${free >= 15 ? `<span class="gap-free">${icon('sun')}Pause ${e(minutesLabel(free))}</span>` : ''}</li>`;
    }
    return `${gap}<li>${appointmentCard(a, store)}</li>`;
  }).join('') : '';

  return `<section class="page today-page">
    <header class="page-head">
      <div><p class="eyebrow">${e(capitalize(dayLabel(day)))}</p><h1>${hello}${firstName ? `, ${e(firstName)}` : ''}</h1>
        <p class="lead">${todays.length ? `${todays.length} rendez-vous aujourd’hui${travel ? `, dont ${e(minutesLabel(travel))} de trajet bloqué` : ''}.` : 'Aucun rendez-vous aujourd’hui.'}</p></div>
      <button type="button" class="btn btn-primary btn-new" data-new>${icon('plus')}<span>Nouveau RDV</span></button>
    </header>
    ${setup.length ? `<div class="setup card"><h2 class="card-title">Pour bien démarrer</h2><ul class="setup-list">${setup.map(([href, label, ic]) => `<li><a href="#/${href}">${icon(ic)}<span>${label}</span>${icon('chevronRight')}</a></li>`).join('')}</ul></div>` : ''}
    ${expired.length ? `<p class="callout callout-warn">${icon('clock')}<span>${expired.length} demande${expired.length > 1 ? 's ont' : ' a'} expiré sans réponse : le créneau a été libéré.</span><button type="button" class="btn btn-ghost btn-sm" data-dismiss-expired>OK</button></p>` : ''}
    <div class="today-grid">
      <div class="today-main">
        ${nextCard}
        <section class="stats" aria-label="Chiffres du jour">
          <a class="stat" href="#/agenda/jour/${e(day)}"><span class="stat-value">${todays.length}</span><span class="stat-label">RDV aujourd’hui</span></a>
          <a class="stat${pending.length ? ' stat-alert' : ''}" href="#/demandes"><span class="stat-value">${pending.length}</span><span class="stat-label">Demande${pending.length > 1 ? 's' : ''} à valider</span></a>
          <a class="stat" href="#/messages/rappels"><span class="stat-value">${reminders.length}</span><span class="stat-label">Rappel${reminders.length > 1 ? 's' : ''} à envoyer</span></a>
          <a class="stat" href="#/agenda/jour/${e(day)}"><span class="stat-value">${e(safe(() => formatPrice(revenue), `${revenue / 100} €`))}</span><span class="stat-label">Prévu aujourd’hui</span></a>
        </section>
        <section class="card" aria-labelledby="prog-title">
          <header class="card-head"><h2 id="prog-title" class="card-title">Programme du jour</h2><a class="link" href="#/agenda/jour/${e(day)}">Voir l’agenda${icon('chevronRight')}</a></header>
          ${programme ? `<ol class="programme">${programme}</ol>` : `<div class="empty-state empty-sm">${icon('sun', { className: 'icon-xl' })}<p>Journée libre. Profitez-en, ou partagez votre lien de réservation.</p></div>`}
        </section>
      </div>
      <aside class="today-side">
        <section class="card" aria-labelledby="req-title">
          <header class="card-head"><h2 id="req-title" class="card-title">Demandes en attente ${pending.length ? `<span class="count-badge">${pending.length}</span>` : ''}</h2><a class="link" href="#/demandes">Tout voir${icon('chevronRight')}</a></header>
          ${pending.length ? `<ul class="mini-cards">${pending.slice(0, 3).map(a => `<li class="mini-card"><button type="button" class="mini-card-main" data-appointment="${e(a.id)}"><strong>${e(clientName(store, a.client_id))}</strong><span>${e(a.service_name)}</span><small>${e(capitalize(dateTimeLabel(a.starts_at)))}</small></button>
            <div class="mini-card-actions"><button type="button" class="btn btn-primary btn-sm" data-accept="${e(a.id)}">Accepter</button><button type="button" class="btn btn-ghost btn-sm" data-decline="${e(a.id)}">Refuser</button></div></li>`).join('')}</ul>` : '<p class="muted">Aucune demande en attente.</p>'}
        </section>
        <section class="card" aria-labelledby="rem-title">
          <header class="card-head"><h2 id="rem-title" class="card-title">Rappels à envoyer</h2><a class="link" href="#/messages/rappels">Préparer${icon('chevronRight')}</a></header>
          ${reminders.length ? `<ul class="plain-list">${reminders.slice(0, 4).map(n => { const a = s.appointments.find(x => x.id === n.appointment_id); return `<li>${icon('bell')}<span><strong>${e(clientName(store, n.client_id))}</strong>${a ? ` · ${e(relativeDay(localDay(a.starts_at)))} ${e(hm(a.starts_at))}` : ''}</span></li>`; }).join('')}</ul>` : `<p class="muted">Tout est à jour.${readyMessages(store) ? ' Des relances vous attendent.' : ''}</p>`}
        </section>
        ${pub.slug ? `<section class="card share-card" aria-labelledby="share-title">
          <h2 id="share-title" class="card-title">${icon('instagram')}Votre lien en bio</h2>
          <p class="share-url">${e(bookingUrl(pub.slug).replace(/^https?:\/\//, ''))}</p>
          ${pub.published ? '' : '<p class="hint hint-error">Votre page n’est pas encore en ligne.</p>'}
          <div class="share-actions"><button type="button" class="btn btn-secondary btn-sm" data-copy-link>${icon('copy')}Copier mon lien</button>
            <a class="btn btn-ghost btn-sm" href="${e(bookingUrl(pub.slug))}" target="_blank" rel="noopener">${icon('eye')}Voir ma page</a></div>
        </section>` : ''}
      </aside>
    </div>
  </section>`;
}

export function bind(root, ctx) {
  const { store } = ctx;
  root.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => ctx.openAppointment({ day: today() })));
  root.querySelectorAll('[data-appointment]').forEach(b => b.addEventListener('click', () => ctx.openAppointment(b.dataset.appointment)));
  root.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await store.acceptRequest(b.dataset.accept); afterDecision(ctx, b.dataset.accept, 'confirmation'); } catch (error) { ctx.noticeError(error); b.disabled = false; }
  }));
  root.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => {
    const a = store.state.appointments.find(x => x.id === b.dataset.decline);
    if (a) declineFlow(ctx, a);
  }));
  root.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
    const ok = await copyText(bookingUrl(store.state.publicProfile.slug));
    ctx.notice(ok ? 'Lien copié : collez-le dans votre bio Instagram.' : 'Copie impossible.', { error: !ok });
  });
  root.querySelector('[data-dismiss-expired]')?.addEventListener('click', async () => {
    try { for (const n of store.state.notifications.filter(x => x.status === 'ready' && x.kind === 'request_expired')) await store.dismissNotification(n.id); }
    catch (error) { ctx.noticeError(error); }
  });
}
