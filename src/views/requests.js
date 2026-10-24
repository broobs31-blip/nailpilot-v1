// F9 — demandes de réservation en ligne : accepter / refuser, expiration à 24 h.
import { formatPrice } from '../domain.js';
import { icon } from '../components/icons.js';
import { e, capitalize, dateTimeLabel, minutesLabel, phoneDisplay, clientName } from '../components/format.js';
import { locationLabel, appointmentCard } from '../components/appointment-card.js';
import { addressText } from '../components/address-fields.js';
import { afterDecision, declineFlow } from './appointment-dialog.js';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

function expiresIn(iso) {
  if (!iso) return '';
  const min = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (min <= 0) return 'Expire maintenant';
  return min < 60 ? `Expire dans ${min} min` : `Expire dans ${Math.floor(min / 60)} h`;
}

export function render(ctx) {
  const { store } = ctx;
  const s = store.state;
  const pending = s.appointments.filter(a => a.status === 'pending' && !a.expired).sort((x, y) => Date.parse(x.expires_at || x.starts_at) - Date.parse(y.expires_at || y.starts_at));
  const recent = s.appointments.filter(a => a.source === 'online' && a.status !== 'pending' && Date.parse(a.starts_at) > Date.now() - 7 * 86400000)
    .sort((x, y) => Date.parse(y.updated_at || y.created_at || y.starts_at) - Date.parse(x.updated_at || x.created_at || x.starts_at)).slice(0, 8);
  const auto = s.profile?.auto_confirm;
  return `<section class="page">
    <header class="page-head"><div><p class="eyebrow">Réservations en ligne</p><h1>Demandes</h1>
      <p class="lead">${pending.length ? `${pending.length} demande${pending.length > 1 ? 's' : ''} attend${pending.length > 1 ? 'ent' : ''} votre réponse. Chaque créneau reste bloqué 24 h au maximum.` : 'Aucune demande en attente. Bravo, tout est traité !'}</p></div></header>
    <p class="callout callout-info">${icon('info')}<span>${auto ? 'Confirmation automatique activée : les réservations en ligne sont confirmées directement.' : 'Vous validez chaque demande avant qu’elle ne soit confirmée.'}</span><a class="link" href="#/reglages/reservation">Modifier</a></p>
    ${pending.length ? `<ul class="request-list">${pending.map(a => {
      const client = s.clients.find(c => c.id === a.client_id);
      const others = client ? s.appointments.filter(x => x.client_id === client.id && x.id !== a.id && ['done', 'booked'].includes(x.status)).length : 0;
      const noShows = client ? s.appointments.filter(x => x.client_id === client.id && x.status === 'no_show').length : 0;
      return `<li class="request card" aria-labelledby="rq-${e(a.id)}">
        <div class="request-head"><span class="chip chip-warn">${icon('clock')}${e(expiresIn(a.expires_at))}</span>${others ? `<span class="chip">Déjà venue ${others} fois</span>` : '<span class="chip chip-new">Nouvelle cliente</span>'}${noShows ? `<span class="chip chip-danger">${noShows} absence${noShows > 1 ? 's' : ''}</span>` : ''}</div>
        <h2 id="rq-${e(a.id)}" class="request-when">${e(capitalize(dateTimeLabel(a.starts_at)))}</h2>
        <p class="request-service">${e(a.service_name)} · ${e(minutesLabel(a.duration_min))}${a.price_cents != null ? ` · ${e(safe(() => formatPrice(a.price_cents), ''))}` : ''}</p>
        <dl class="detail-list detail-list-compact">
          <div><dt>Cliente</dt><dd><strong>${e(client ? client.name : clientName(store, a.client_id))}</strong>${client?.phone ? ` · <a href="tel:${e(client.phone)}">${e(phoneDisplay(client.phone))}</a>` : ''}</dd></div>
          <div><dt>Lieu</dt><dd><span class="inline-icon">${locationLabel(a)}</span>${a.location_type === 'client' ? `<br>${e(addressText(a))}` : ''}</dd></div>
          ${a.client_message ? `<div><dt>Message</dt><dd class="quote">${e(a.client_message)}</dd></div>` : ''}
        </dl>
        <div class="request-actions">
          <button type="button" class="btn btn-primary" data-accept="${e(a.id)}">${icon('check')}Accepter</button>
          <button type="button" class="btn btn-secondary" data-decline="${e(a.id)}">Refuser</button>
          <button type="button" class="btn btn-ghost" data-appointment="${e(a.id)}">Détail</button>
        </div>
      </li>`;
    }).join('')}</ul>` : `<div class="empty-state">${icon('inbox', { className: 'icon-xl' })}<h2>Boîte vide</h2><p>Les demandes faites depuis votre page de réservation arrivent ici.</p>${s.publicProfile?.slug ? `<a class="btn btn-secondary" href="/r/${e(s.publicProfile.slug)}" target="_blank" rel="noopener">${icon('eye')}Voir ma page</a>` : ''}</div>`}
    ${recent.length ? `<h2 class="section-title">Traitées récemment</h2><div class="card-list">${recent.map(a => appointmentCard(a, store, { showDate: true, compact: true })).join('')}</div>` : ''}
  </section>`;
}

export function bind(root, ctx) {
  const { store } = ctx;
  root.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await store.acceptRequest(b.dataset.accept); afterDecision(ctx, b.dataset.accept, 'confirmation'); }
    catch (error) { ctx.noticeError(error); b.disabled = false; }
  }));
  root.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => {
    const a = store.state.appointments.find(x => x.id === b.dataset.decline);
    if (a) declineFlow(ctx, a);
  }));
  root.querySelectorAll('[data-appointment]').forEach(b => b.addEventListener('click', () => ctx.openAppointment(b.dataset.appointment)));
}
