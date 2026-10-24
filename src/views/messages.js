// F10, F11 — rappels 24 h et relances : messages prêts à copier, WhatsApp (wa.me) ou SMS. Aucun envoi automatique.
import { icon } from '../components/icons.js';
import { e, capitalize, dateTimeLabel, clientName } from '../components/format.js';
import { messageActions, bindMessageActions } from '../components/message-actions.js';
import { messageFor } from './appointment-dialog.js';

let history = false;
const KINDS = { rappels: ['reminder', 'confirmation'], relances: ['refill'] };
const LABELS = { reminder: 'Rappel', confirmation: 'Confirmation', refill: 'Relance' };

export function render(ctx) {
  const { store } = ctx;
  const tab = ctx.route.params.tab || 'rappels';
  const s = store.state;
  const status = history ? 'dismissed' : 'ready';
  const rows = (s.notifications || []).filter(n => KINDS[tab].includes(n.kind) && n.status === status).sort((x, y) => Date.parse(x.due_at) - Date.parse(y.due_at));
  const count = kinds => (s.notifications || []).filter(n => kinds.includes(n.kind) && n.status === 'ready').length;
  return `<section class="page">
    <header class="page-head"><div><p class="eyebrow">Messages préparés</p><h1>Rappels & relances</h1>
      <p class="lead">Vos messages sont prêts : copiez-les ou ouvrez WhatsApp / SMS. NailPilot n’envoie rien à votre place.</p></div></header>
    <nav class="tabs" aria-label="Type de message">
      <a class="tab-link${tab === 'rappels' ? ' is-active' : ''}" href="#/messages/rappels"${tab === 'rappels' ? ' aria-current="page"' : ''}>Rappels ${count(KINDS.rappels) ? `<span class="count-badge">${count(KINDS.rappels)}</span>` : ''}</a>
      <a class="tab-link${tab === 'relances' ? ' is-active' : ''}" href="#/messages/relances"${tab === 'relances' ? ' aria-current="page"' : ''}>Relances ${count(KINDS.relances) ? `<span class="count-badge">${count(KINDS.relances)}</span>` : ''}</a>
    </nav>
    <div class="toolbar"><p class="muted">${tab === 'rappels' ? 'Préparés 24 h avant chaque rendez-vous confirmé, si la cliente a accepté les rappels.' : 'Proposées après la dernière prestation, selon le délai de la prestation ou de la cliente.'}</p>
      <div class="segmented segmented-sm" role="group" aria-label="Filtre"><button type="button" class="segment-btn${history ? '' : ' is-active'}" aria-pressed="${!history}" data-history="0">À traiter</button><button type="button" class="segment-btn${history ? ' is-active' : ''}" aria-pressed="${history}" data-history="1">Traités</button></div></div>
    ${rows.length ? `<ul class="message-list">${rows.map(n => {
      const a = s.appointments.find(x => x.id === n.appointment_id);
      const client = s.clients.find(c => c.id === n.client_id);
      const msgKind = n.kind === 'refill' ? 'refill' : n.kind === 'confirmation' ? 'confirmation' : 'reminder';
      return `<li class="card message-card"><header class="message-head"><div><span class="chip chip-plum">${e(LABELS[n.kind] || n.kind)}</span><h2 class="card-title">${e(clientName(store, n.client_id))}</h2>
          <p class="muted">${a ? `${e(a.service_name)} · ${e(capitalize(dateTimeLabel(a.starts_at)))}` : ''}</p></div></header>
        ${a ? messageActions({ text: messageFor(ctx, msgKind, a), phone: client?.phone || '', label: 'Message à envoyer' }) : ''}
        ${history ? '<p class="hint">Marqué comme traité (cela ne garantit pas l’envoi).</p>' : `<button type="button" class="btn btn-ghost btn-sm" data-dismiss="${e(n.id)}">${icon('check')}Marquer comme traité</button>`}</li>`;
    }).join('')}</ul>` : `<div class="empty-state">${icon('message', { className: 'icon-xl' })}<h2>${history ? 'Aucun message traité' : 'Tout est à jour'}</h2><p>${tab === 'rappels' ? 'Les rappels apparaissent ici la veille de chaque rendez-vous.' : 'Les relances apparaissent ici quand une cliente est due pour revenir.'}</p></div>`}
  </section>`;
}

export function bind(root, ctx) {
  if (!ctx.route.params.tab) { ctx.navigate('messages/rappels', { replace: true }); return; }
  bindMessageActions(root);
  root.querySelectorAll('[data-history]').forEach(b => b.addEventListener('click', () => { history = b.dataset.history === '1'; ctx.rerender(); }));
  root.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await ctx.store.dismissNotification(b.dataset.dismiss); ctx.notice('Marqué comme traité.'); } catch (error) { ctx.noticeError(error); b.disabled = false; }
  }));
}
