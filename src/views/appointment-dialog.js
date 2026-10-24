// F5, F6, F9 — détail, création et modification d'un rendez-vous (lieu, adresse, tampons, statuts).
import {
  LOCATIONS, STATUSES, fromParisLocal, parisLocal, computeBuffers, blockRange, conflicts, appointmentWarnings,
  allowedTransitions, mapsLink, buildMessage, formatPrice, formatDuration
} from '../domain.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { icon } from '../components/icons.js';
import { e, hm, hmRange, dateTimeLabel, capitalize, minutesLabel, clientName, phoneDisplay, today } from '../components/format.js';
import { addressFields, pickAddress, addressText } from '../components/address-fields.js';
import { statusBadge } from '../components/status-badge.js';
import { messageActions, bindMessageActions } from '../components/message-actions.js';
import { locationLabel } from '../components/appointment-card.js';
import { bookingUrl } from '../router.js';

const WARNING_LABELS = {
  outside_hours: 'Ce créneau est en dehors de vos horaires d’ouverture.',
  closed: 'Ce jour tombe pendant une fermeture exceptionnelle.',
  outside_zone: 'Cette adresse est hors de votre zone de déplacement.'
};
const ACTION_LABELS = { booked: 'Confirmer', done: 'Marquer terminé', no_show: 'Cliente absente', cancelled: 'Annuler le RDV' };

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

/** @param {object} ctx @param {string | { day?: string, time?: string, clientId?: string }} target */
export function openAppointmentDialog(ctx, target) {
  if (typeof target === 'string') {
    const a = ctx.store.state.appointments.find(x => x.id === target);
    if (!a) { ctx.notice('Ce rendez-vous n’existe plus.', { error: true }); return; }
    return openDetail(ctx, a);
  }
  return openForm(ctx, null, target || {});
}

export function messageFor(ctx, kind, appointment) {
  const { store } = ctx;
  const client = store.state.clients.find(c => c.id === appointment.client_id) || null;
  const slug = store.state.publicProfile?.slug;
  return safe(() => buildMessage(kind, { appointment, client, profile: store.state.profile, publicProfile: store.state.publicProfile, bookingUrl: slug ? bookingUrl(slug) : '' }), '');
}

function openDetail(ctx, a) {
  const { store } = ctx;
  const client = store.state.clients.find(c => c.id === a.client_id);
  const now = new Date();
  const transitions = safe(() => allowedTransitions(a, now), []);
  const past = Date.parse(a.starts_at) <= Date.now();
  const address = a.location_type === 'client' ? addressText(a) : '';
  const maps = address ? safe(() => mapsLink(address), '') : '';
  const noShows = client ? store.state.appointments.filter(x => x.client_id === client.id && x.status === 'no_show').length : 0;
  const canEdit = !past && a.status === 'booked';
  const msgKind = a.status === 'booked' && !past ? 'reminder' : null;
  const body = `<div class="detail">
    <div class="detail-head">${statusBadge(a.status, { expired: a.expired })}${a.source === 'online' ? '<span class="chip">Réservé en ligne</span>' : ''}</div>
    <p class="detail-when">${e(capitalize(dateTimeLabel(a.starts_at)))}</p>
    <p class="detail-sub">${e(a.service_name)} · ${e(minutesLabel(a.duration_min))}${a.price_cents != null ? ` · ${e(safe(() => formatPrice(a.price_cents), ''))}` : ''}</p>
    <dl class="detail-list">
      <div><dt>Cliente</dt><dd>${client ? `<a href="#/clientes/${e(client.id)}" data-close-link>${e(client.preferred_name || client.name)}</a>${noShows ? ` <span class="chip chip-warn">${noShows} absence${noShows > 1 ? 's' : ''}</span>` : ''}${client.phone ? `<br><a href="tel:${e(client.phone)}">${e(phoneDisplay(client.phone))}</a>` : ''}` : 'Cliente supprimée'}</dd></div>
      <div><dt>Lieu</dt><dd><span class="inline-icon">${locationLabel(a)}</span>${address ? `<br>${e(address)}${a.access_info ? `<br><small>${e(a.access_info)}</small>` : ''}` : ''}
        ${maps ? `<br><a class="btn btn-secondary btn-sm" href="${e(maps)}" target="_blank" rel="noopener noreferrer">${icon('pin')}Ouvrir dans Maps</a>` : ''}</dd></div>
      <div><dt>Temps bloqué</dt><dd>${e(hmRange(a.block_start || a.starts_at, a.block_end || a.ends_at))}${a.buffer_before_min || a.buffer_after_min ? ` <small>(${a.location_type === 'client' ? 'trajet' : 'préparation'} : ${e(minutesLabel(a.buffer_before_min))} avant, ${e(minutesLabel(a.buffer_after_min))} après)</small>` : ''}</dd></div>
      ${a.client_message ? `<div><dt>Message de la cliente</dt><dd class="quote">${e(a.client_message)}</dd></div>` : ''}
      ${a.cancel_reason ? `<div><dt>Motif</dt><dd>${e(a.cancel_reason)}</dd></div>` : ''}
    </dl>
    ${a.status === 'pending' && !a.expired ? `<div class="callout callout-warn">${icon('inbox')}<span>Demande en ligne à valider${a.expires_at ? ` avant ${e(dateTimeLabel(a.expires_at))}` : ''}.</span></div>` : ''}
    ${msgKind && client ? `<details class="disclosure"><summary>${icon('message')}Préparer le rappel</summary>${messageActions({ text: messageFor(ctx, msgKind, a), phone: client.phone, label: 'Rappel' })}</details>` : ''}
    <div class="detail-actions">
      ${a.status === 'pending' && !a.expired ? `<button type="button" class="btn btn-primary" data-accept>${icon('check')}Accepter</button><button type="button" class="btn btn-secondary" data-decline>Refuser</button>` : ''}
      ${transitions.filter(s => s !== 'booked' && s !== 'pending').map(s => `<button type="button" class="btn ${s === 'cancelled' ? 'btn-ghost btn-danger-text' : 'btn-secondary'}" data-status="${e(s)}">${e(ACTION_LABELS[s] || STATUSES[s])}</button>`).join('')}
    </div>
  </div>`;
  openDialog({
    title: client ? (client.preferred_name || client.name) : 'Rendez-vous', eyebrow: 'Rendez-vous', body,
    submitLabel: canEdit ? 'Modifier' : null, cancelLabel: 'Fermer',
    onSubmit: () => { setTimeout(() => openForm(ctx, a, {})); },
    onBind: (dialog, api) => {
      bindMessageActions(dialog);
      dialog.querySelector('[data-close-link]')?.addEventListener('click', () => api.close());
      dialog.querySelector('[data-accept]')?.addEventListener('click', async () => {
        try { await store.acceptRequest(a.id); api.close(); afterDecision(ctx, a.id, 'confirmation'); } catch (error) { api.setError(error.message); }
      });
      dialog.querySelector('[data-decline]')?.addEventListener('click', () => { api.close(); declineFlow(ctx, a); });
      dialog.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', async () => {
        const status = button.dataset.status;
        if (status === 'cancelled') { api.close(); cancelFlow(ctx, a); return; }
        try { await store.setStatus(a.id, status); api.close(); ctx.notice(status === 'done' ? 'Rendez-vous terminé. Merci !' : 'Absence enregistrée.'); }
        catch (error) { api.setError(error.message); }
      }));
    }
  });
}

/** Après acceptation : message de confirmation prêt à envoyer. */
export function afterDecision(ctx, id, kind) {
  const a = ctx.store.state.appointments.find(x => x.id === id);
  const client = ctx.store.state.clients.find(c => c.id === a?.client_id);
  ctx.notice(kind === 'confirmation' ? 'Demande acceptée : le rendez-vous est confirmé.' : 'Demande refusée : le créneau est libéré.');
  if (!a) return;
  openDialog({
    title: kind === 'confirmation' ? 'Prévenez votre cliente' : 'Un petit mot pour votre cliente', eyebrow: kind === 'confirmation' ? 'Rendez-vous confirmé' : 'Demande refusée',
    body: `<p class="dialog-text">NailPilot n’envoie rien à votre place : copiez ce message ou ouvrez WhatsApp / SMS.</p>${messageActions({ text: messageFor(ctx, kind, a), phone: client?.phone || '', label: 'Message' })}`,
    submitLabel: null, cancelLabel: 'Terminé', onBind: dialog => bindMessageActions(dialog)
  });
}

export function declineFlow(ctx, a) {
  openDialog({
    title: 'Refuser la demande', eyebrow: 'Demande en ligne', danger: true, submitLabel: 'Refuser la demande',
    body: `<p class="dialog-text">Le créneau sera libéré immédiatement.</p><label class="field"><span class="label-text">Motif (facultatif)</span><textarea name="reason" maxlength="300" rows="2" placeholder="Ex. Je ne me déplace pas dans ce secteur"></textarea></label>`,
    onSubmit: async values => { await ctx.store.declineRequest(a.id, values.reason || ''); setTimeout(() => afterDecision(ctx, a.id, 'decline')); }
  });
}

function cancelFlow(ctx, a) {
  openDialog({
    title: 'Annuler le rendez-vous', eyebrow: 'Annulation', danger: true, submitLabel: 'Annuler le RDV', cancelLabel: 'Garder',
    body: `<p class="dialog-text">Le créneau sera libéré immédiatement.</p><label class="field"><span class="label-text">Motif (facultatif)</span><textarea name="reason" maxlength="300" rows="2"></textarea></label>`,
    onSubmit: async values => { await ctx.store.setStatus(a.id, 'cancelled', values.reason || ''); ctx.notice('Rendez-vous annulé.'); }
  });
}

function openForm(ctx, a, { day, time, clientId }) {
  const { store } = ctx;
  const s = store.state;
  const services = s.services.filter(x => !x.archived || x.id === a?.service_id);
  if (!services.length && !a) {
    ctx.notice('Ajoutez d’abord une prestation dans votre catalogue.', { error: true });
    ctx.navigate('prestations'); return;
  }
  const clients = s.clients.filter(c => !c.archived || c.id === a?.client_id).sort((x, y) => x.name.localeCompare(y.name, 'fr'));
  const startLocal = a ? parisLocal(a.starts_at) : `${day || today()}T${time || '09:00'}`;
  const selectedClient = a?.client_id || clientId || '';
  const service0 = services.find(x => x.id === a?.service_id) || services[0];
  const body = `<div class="form form-dialog">
    <label class="field"><span class="label-text">Cliente</span><select name="client_id" required data-client>
      <option value="">Choisir une cliente</option><option value="__new">+ Nouvelle cliente</option>
      ${clients.map(c => `<option value="${e(c.id)}" ${c.id === selectedClient ? 'selected' : ''}>${e(c.name)}${c.phone ? ` · ${e(phoneDisplay(c.phone))}` : ''}</option>`).join('')}</select></label>
    <div class="sub-panel" data-new-client hidden>
      <div class="field-row"><label class="field"><span class="label-text">Nom et prénom</span><input name="new_name" maxlength="120" autocomplete="off"></label>
      <label class="field"><span class="label-text">Téléphone</span><input name="new_phone" type="tel" inputmode="tel" autocomplete="off" placeholder="06 12 34 56 78"></label></div>
      <label class="check"><input type="checkbox" name="new_reminder"><span>Elle accepte de recevoir des rappels</span></label>
    </div>
    <label class="field"><span class="label-text">Prestation</span><select name="service_id" required data-service>
      ${services.map(x => `<option value="${e(x.id)}" ${x.id === service0?.id ? 'selected' : ''}>${e(x.name)} · ${e(safe(() => formatDuration(x.duration_min), `${x.duration_min} min`))}</option>`).join('')}
    </select></label>
    <fieldset class="fieldset"><legend>Lieu</legend><div class="segmented" data-locations></div></fieldset>
    <div data-address-zone></div>
    <div class="field-row">
      <label class="field"><span class="label-text">Date</span><input name="date" type="date" value="${e(startLocal.slice(0, 10))}" required></label>
      <label class="field"><span class="label-text">Heure de début</span><input name="time" type="time" step="300" value="${e(startLocal.slice(11, 16))}" required></label>
      <label class="field field-narrow"><span class="label-text">Durée (min)</span><input name="duration_min" type="number" min="5" max="480" step="5" value="${e(a?.duration_min ?? service0?.duration_min ?? 60)}" required inputmode="numeric" data-duration></label>
    </div>
    <fieldset class="fieldset buffer-box"><legend>${icon('car')} Temps bloqué autour du rendez-vous</legend>
      <div class="field-row">
        <label class="field"><span class="label-text" data-before-label>Avant (min)</span><input name="buffer_before_min" type="number" min="0" max="120" step="5" inputmode="numeric" data-buffer="before"></label>
        <label class="field"><span class="label-text" data-after-label>Après (min)</span><input name="buffer_after_min" type="number" min="0" max="120" step="5" inputmode="numeric" data-buffer="after"></label>
      </div>
      <p class="buffer-preview" data-preview aria-live="polite"></p>
    </fieldset>
    <div data-warnings aria-live="polite"></div>
    <label class="check" data-force hidden><input type="checkbox" name="force"><span>Je confirme ce créneau malgré tout</span></label>
  </div>`;
  openDialog({
    title: a ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous', eyebrow: a ? capitalize(dateTimeLabel(a.starts_at)) : 'Agenda', wide: true,
    body, submitLabel: a ? 'Enregistrer' : 'Créer le rendez-vous',
    onBind: (dialog) => bindForm(ctx, dialog, a),
    onSubmit: async (values, form) => {
      const input = readInput(ctx, form, a);
      const warnings = safe(() => appointmentWarnings(input, { ...store.state, now: new Date() }), []);
      if (warnings.length && !form.querySelector('[name=force]').checked) {
        form.querySelector('[data-force]').hidden = false;
        throw new Error('Cochez « Je confirme ce créneau malgré tout » pour enregistrer.');
      }
      if (values.client_id === '__new') {
        if (!values.new_name) throw new Error('Indiquez le nom de la nouvelle cliente.');
        const client = await store.saveClient({ name: values.new_name, phone: values.new_phone, reminder_opt_in: form.querySelector('[name=new_reminder]').checked, refill_opt_in: false, source: 'manual' });
        input.client_id = client?.id || store.state.clients.find(c => c.name === values.new_name)?.id;
        form.querySelector('[data-client]').insertAdjacentHTML('beforeend', `<option value="${e(input.client_id)}">${e(values.new_name)}</option>`);
        form.querySelector('[data-client]').value = input.client_id;
        form.querySelector('[data-new-client]').hidden = true;
      }
      await store.saveAppointment(input);
      ctx.notice(a ? 'Rendez-vous mis à jour.' : 'Rendez-vous créé.');
      const dayValue = values.date;
      if (ctx.route?.name === 'agenda' && ctx.route.params.day && ctx.route.params.day !== dayValue && ctx.route.params.mode === 'jour') ctx.navigate(`agenda/jour/${dayValue}`);
    }
  });
}

function readInput(ctx, form, a) {
  const v = Object.fromEntries(new FormData(form));
  const location = form.querySelector('[name=location_type]:checked')?.value || 'pro';
  const starts_at = fromParisLocal(`${v.date}T${v.time}`);
  const input = {
    id: a?.id, client_id: v.client_id === '__new' ? '' : v.client_id, service_id: v.service_id, location_type: location, starts_at,
    duration_min: Number(v.duration_min), buffer_before_min: Number(v.buffer_before_min || 0), buffer_after_min: Number(v.buffer_after_min || 0),
    status: a?.status || 'booked'
  };
  if (location === 'client') {
    if (v.address_id && v.address_id !== '__new') {
      const addr = ctx.store.state.addresses.find(x => x.id === v.address_id);
      Object.assign(input, { address_id: v.address_id }, pickAddress(addr || {}));
    } else Object.assign(input, pickAddress(v));
  }
  return input;
}

function bindForm(ctx, dialog, a) {
  const { store } = ctx;
  const form = dialog.querySelector('form');
  const $ = sel => form.querySelector(sel);
  const touched = { before: a != null, after: a != null };
  const serviceOf = () => store.state.services.find(x => x.id === $('[data-service]').value);

  function renderLocations() {
    const service = serviceOf();
    const allowed = !service || service.allowed_locations === 'both' ? ['pro', 'client'] : [service.allowed_locations];
    const work = store.state.profile?.work_mode;
    const preferred = a?.location_type || (work === 'mobile' ? 'client' : 'pro');
    const current = form.querySelector('[name=location_type]:checked')?.value || preferred;
    const chosen = allowed.includes(current) ? current : allowed[0];
    $('[data-locations]').innerHTML = allowed.map(loc => `<label class="segment"><input type="radio" name="location_type" value="${loc}" ${loc === chosen ? 'checked' : ''}><span>${icon(loc === 'pro' ? 'home' : 'car')}${e(LOCATIONS[loc])}</span></label>`).join('');
    form.querySelectorAll('[name=location_type]').forEach(r => r.addEventListener('change', () => { renderAddress(); defaults(); update(); }));
    renderAddress();
  }

  function renderAddress() {
    const zone = $('[data-address-zone]');
    const location = form.querySelector('[name=location_type]:checked')?.value;
    if (location !== 'client') { zone.innerHTML = ''; return; }
    const clientId = $('[data-client]').value;
    const saved = store.state.addresses.filter(x => x.client_id === clientId);
    const current = a?.location_type === 'client' ? pickAddress(a) : {};
    const matchId = saved.find(x => x.address_line === current.address_line && x.postal_code === current.postal_code)?.id;
    const primary = matchId || (a?.location_type === 'client' ? '__new' : saved.find(x => x.is_primary)?.id || saved[0]?.id || '__new');
    zone.innerHTML = `${saved.length ? `<label class="field"><span class="label-text">Adresse de la cliente</span><select name="address_id" data-address-select>
        ${saved.map(x => `<option value="${e(x.id)}" ${x.id === primary ? 'selected' : ''}>${e(x.label ? `${x.label} · ` : '')}${e(addressText(x))}</option>`).join('')}
        <option value="__new" ${primary === '__new' ? 'selected' : ''}>Autre adresse…</option></select></label>` : ''}
      <div data-address-fields ${primary !== '__new' ? 'hidden' : ''}>${addressFields(current, { required: primary === '__new', legend: 'Adresse d’intervention' })}</div>`;
    zone.querySelector('[data-address-select]')?.addEventListener('change', event => {
      const isNew = event.target.value === '__new';
      const fields = zone.querySelector('[data-address-fields]');
      fields.hidden = !isNew;
      fields.querySelectorAll('input').forEach(i => { if (i.name !== 'access_info') i.required = isNew; });
      update();
    });
    zone.querySelectorAll('input').forEach(i => i.addEventListener('input', update));
  }

  function defaults() {
    const service = serviceOf();
    const location = form.querySelector('[name=location_type]:checked')?.value || 'pro';
    const buffers = safe(() => computeBuffers({ location_type: location, service, profile: store.state.profile }), { before: 0, after: 0 });
    if (!touched.before) $('[data-buffer=before]').value = buffers.before;
    if (!touched.after) $('[data-buffer=after]').value = buffers.after;
    const travel = location === 'client';
    $('[data-before-label]').textContent = travel ? 'Trajet avant (min)' : 'Avant (min)';
    $('[data-after-label]').textContent = travel ? 'Trajet après (min)' : 'Préparation après (min)';
  }

  function update() {
    const preview = $('[data-preview]');
    const warningsBox = $('[data-warnings]');
    let input;
    try { input = readInput(ctx, form, a); } catch { preview.textContent = ''; warningsBox.innerHTML = ''; return; }
    const range = safe(() => blockRange(input), null);
    if (range) {
      preview.innerHTML = `${icon('clock')}<span>Prestation <strong>${e(hmRange(range.starts_at, range.ends_at))}</strong> · agenda bloqué <strong>${e(hmRange(range.block_start, range.block_end))}</strong></span>`;
    }
    const others = store.state.appointments.filter(x => x.id !== a?.id);
    const clash = range ? safe(() => conflicts({ ...input, ...range, status: 'booked' }, others, new Date()), null) : null;
    const warnings = safe(() => appointmentWarnings(input, { ...store.state, now: new Date() }), []);
    warningsBox.innerHTML = [
      clash ? `<p class="callout callout-error">${icon('alert')}<span>Ce créneau chevauche le rendez-vous de ${e(clientName(store, clash.client_id))} (${e(hmRange(clash.block_start || clash.starts_at, clash.block_end || clash.ends_at))}, trajets compris).</span></p>` : '',
      ...warnings.map(w => `<p class="callout callout-warn">${icon('alert')}<span>${e(WARNING_LABELS[w] || w)}</span></p>`)
    ].join('');
    $('[data-force]').hidden = !warnings.length;
  }

  $('[data-client]').addEventListener('change', event => {
    $('[data-new-client]').hidden = event.target.value !== '__new';
    $('[name=new_name]').required = event.target.value === '__new';
    renderAddress(); update();
  });
  $('[data-service]').addEventListener('change', () => {
    const service = serviceOf();
    if (service) $('[data-duration]').value = service.duration_min;
    renderLocations(); defaults(); update();
  });
  form.querySelectorAll('[data-buffer]').forEach(input => input.addEventListener('input', () => { touched[input.dataset.buffer] = true; update(); }));
  ['[name=date]', '[name=time]', '[data-duration]'].forEach(sel => $(sel).addEventListener('input', update));
  renderLocations();
  if (a) { $('[data-buffer=before]').value = a.buffer_before_min ?? 0; $('[data-buffer=after]').value = a.buffer_after_min ?? 0; }
  defaults(); update();
}

