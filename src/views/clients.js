// F7, F12 — fiches clientes : recherche, coordonnées, adresses, préférences, consentements, export, suppression.
import { CLIENT_SOURCES, HEALTH_WARNING, whatsappLink, mapsLink, toCsv, formatPrice } from '../domain.js';
import { icon } from '../components/icons.js';
import { e, initials, phoneDisplay, capitalize, dateTimeLabel, download, today } from '../components/format.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { addressFields, pickAddress, addressText } from '../components/address-fields.js';
import { appointmentCard } from '../components/appointment-card.js';

let search = '';
let showArchived = false;
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

function matches(c, q) {
  if (!q) return true;
  const hay = `${c.name} ${c.preferred_name || ''} ${c.phone} ${phoneDisplay(c.phone)} ${c.email}`.toLocaleLowerCase('fr');
  return hay.includes(q.toLocaleLowerCase('fr').trim());
}

function listItems(ctx) {
  const { store } = ctx;
  const now = Date.now();
  const clients = store.state.clients.filter(c => (showArchived ? c.archived : !c.archived) && matches(c, search)).sort((x, y) => x.name.localeCompare(y.name, 'fr'));
  if (!clients.length) return `<div class="empty-state">${icon('users', { className: 'icon-xl' })}<h2>${search ? 'Aucun résultat' : showArchived ? 'Aucune cliente archivée' : 'Votre carnet commence ici'}</h2><p>${search ? 'Essayez un autre nom ou numéro.' : 'Ajoutez une cliente ou partagez votre lien : les réservations en ligne créent la fiche automatiquement.'}</p></div>`;
  return `<ul class="client-list" aria-label="${clients.length} clientes">${clients.map(c => {
    const own = store.state.appointments.filter(a => a.client_id === c.id);
    const next = own.filter(a => ['booked', 'pending'].includes(a.status) && Date.parse(a.starts_at) > now).sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at))[0];
    const last = own.filter(a => a.status === 'done').sort((x, y) => Date.parse(y.starts_at) - Date.parse(x.starts_at))[0];
    return `<li><a class="client-row" href="#/clientes/${e(c.id)}">
      <span class="avatar">${e(initials(c.name))}</span>
      <span class="client-row-main"><strong>${e(c.name)}</strong><small>${c.phone ? e(phoneDisplay(c.phone)) : 'Téléphone non renseigné'}</small></span>
      <span class="client-row-meta">${next ? `<span class="chip chip-plum">${icon('calendar')}${e(capitalize(dateTimeLabel(next.starts_at)).replace(/ à .*/, ''))}</span>` : last ? `<small>Dernière visite : ${e(dateTimeLabel(last.starts_at).replace(/ à .*/, ''))}</small>` : c.source === 'online' ? '<span class="chip chip-new">En ligne</span>' : ''}</span>
      ${icon('chevronRight')}</a></li>`;
  }).join('')}</ul>`;
}

export function render(ctx) {
  if (ctx.route.name === 'cliente') return detail(ctx, ctx.route.params.id);
  const count = ctx.store.state.clients.filter(c => !c.archived).length;
  return `<section class="page">
    <header class="page-head"><div><p class="eyebrow">Mon carnet</p><h1>Clientes</h1><p class="lead">${count} fiche${count > 1 ? 's' : ''} active${count > 1 ? 's' : ''}.</p></div>
      <button type="button" class="btn btn-primary btn-new" data-new-client>${icon('plus')}<span>Nouvelle cliente</span></button></header>
    <div class="toolbar">
      <label class="search-field"><span class="sr-only">Rechercher une cliente</span>${icon('search')}<input type="search" data-search placeholder="Nom, téléphone ou e-mail" value="${e(search)}" autocomplete="off"></label>
      <div class="segmented segmented-sm" role="group" aria-label="Filtre"><button type="button" class="segment-btn${showArchived ? '' : ' is-active'}" aria-pressed="${!showArchived}" data-archived="0">Actives</button><button type="button" class="segment-btn${showArchived ? ' is-active' : ''}" aria-pressed="${showArchived}" data-archived="1">Archivées</button></div>
    </div>
    <div data-results aria-live="polite">${listItems(ctx)}</div>
  </section>`;
}

function detail(ctx, id) {
  const { store } = ctx;
  const s = store.state;
  const c = s.clients.find(x => x.id === id);
  if (!c) return `<section class="page empty-state"><h1>Fiche introuvable</h1><p>Cette cliente a peut-être été supprimée.</p><a class="btn btn-secondary" href="#/clientes">Retour aux clientes</a></section>`;
  const own = s.appointments.filter(a => a.client_id === id).sort((x, y) => Date.parse(y.starts_at) - Date.parse(x.starts_at));
  const upcoming = own.filter(a => ['booked', 'pending'].includes(a.status) && Date.parse(a.starts_at) > Date.now()).reverse();
  const pastList = own.filter(a => !upcoming.includes(a));
  const done = own.filter(a => a.status === 'done');
  const noShows = own.filter(a => a.status === 'no_show').length;
  const spent = done.reduce((sum, a) => sum + (a.price_cents || 0), 0);
  const addresses = (s.addresses || []).filter(a => a.client_id === id).sort((x, y) => Number(y.is_primary) - Number(x.is_primary));
  const consents = (s.consents || []).filter(x => x.client_id === id).sort((x, y) => Date.parse(y.recorded_at) - Date.parse(x.recorded_at));
  return `<section class="page client-detail">
    <a class="back-link" href="#/clientes">${icon('chevronLeft')}Clientes</a>
    <header class="client-hero card">
      <span class="avatar avatar-lg">${e(initials(c.name))}</span>
      <div class="client-hero-main"><h1>${e(c.name)}</h1>
        <p class="muted">${c.preferred_name ? `Prénom d’usage : ${e(c.preferred_name)} · ` : ''}${e(CLIENT_SOURCES[c.source] || 'Saisie')}${c.archived ? ' · <strong>Archivée</strong>' : ''}</p>
        <div class="contact-actions">
          ${c.phone ? `<a class="btn btn-secondary btn-sm" href="tel:${e(c.phone)}">${icon('phone')}${e(phoneDisplay(c.phone))}</a>
          <a class="btn btn-whatsapp btn-sm" href="${e(safe(() => whatsappLink(c.phone, ''), '#'))}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')}WhatsApp</a>` : '<span class="muted">Aucun téléphone</span>'}
          ${c.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${e(c.email)}">${e(c.email)}</a>` : ''}
        </div></div>
      <div class="client-hero-actions">${c.archived ? '' : `<button type="button" class="btn btn-primary" data-book>${icon('plus')}Nouveau RDV</button>`}<button type="button" class="btn btn-secondary" data-edit>${icon('edit')}Modifier</button></div>
    </header>
    <div class="stats stats-3">
      <div class="stat"><span class="stat-value">${done.length}</span><span class="stat-label">Visite${done.length > 1 ? 's' : ''}</span></div>
      <div class="stat${noShows ? ' stat-alert' : ''}"><span class="stat-value">${noShows}</span><span class="stat-label">Absence${noShows > 1 ? 's' : ''}</span></div>
      <div class="stat"><span class="stat-value">${e(safe(() => formatPrice(spent), ''))}</span><span class="stat-label">Réalisé</span></div>
    </div>
    <div class="detail-grid">
      <section class="card"><header class="card-head"><h2 class="card-title">Adresses d’intervention</h2><button type="button" class="btn btn-ghost btn-sm" data-add-address>${icon('plus')}Ajouter</button></header>
        ${addresses.length ? `<ul class="address-list">${addresses.map(a => `<li><div><strong>${e(a.label || (a.is_primary ? 'Adresse principale' : 'Adresse'))}</strong>${a.is_primary ? ' <span class="chip chip-plum">Principale</span>' : ''}<p>${e(addressText(a))}</p>${a.access_info ? `<small>${icon('info')}${e(a.access_info)}</small>` : ''}</div>
          <div class="row-actions"><a class="icon-btn" href="${e(safe(() => mapsLink(addressText(a)), '#'))}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir dans Maps">${icon('pin')}</a><button type="button" class="icon-btn" data-edit-address="${e(a.id)}" aria-label="Modifier l’adresse">${icon('edit')}</button><button type="button" class="icon-btn" data-delete-address="${e(a.id)}" aria-label="Supprimer l’adresse">${icon('trash')}</button></div></li>`).join('')}</ul>` : '<p class="muted">Aucune adresse. Utile si vous vous déplacez chez elle.</p>'}
      </section>
      <section class="card"><header class="card-head"><h2 class="card-title">Préférences</h2></header>
        <p class="pre">${c.notes ? e(c.notes) : '<span class="muted">Forme, couleur, longueur, technique préférée…</span>'}</p>
        <p class="hint">${icon('shield')}${e(HEALTH_WARNING)}</p>
        <h3 class="mini-title">Accords de la cliente</h3>
        <ul class="consents"><li>${c.reminder_opt_in ? icon('check') : icon('close')}<span>Rappels de rendez-vous ${c.reminder_opt_in ? 'acceptés' : 'non acceptés'}</span></li>
          <li>${c.refill_opt_in ? icon('check') : icon('close')}<span>Relances ${c.refill_opt_in ? `acceptées (tous les ${e(c.refill_days)} jours)` : 'non acceptées'}</span></li></ul>
        ${consents.length ? `<details class="disclosure"><summary>Journal des consentements</summary><ul class="plain-list small">${consents.map(x => `<li>${e(dateTimeLabel(x.recorded_at))} · ${x.kind === 'reminders' ? 'Rappels' : 'Relances'} ${x.granted ? 'acceptés' : 'refusés'} · ${x.source === 'online_form' ? 'formulaire en ligne' : 'saisie pro'}</li>`).join('')}</ul></details>` : ''}
      </section>
    </div>
    <section class="card"><header class="card-head"><h2 class="card-title">Rendez-vous</h2></header>
      ${upcoming.length ? `<h3 class="mini-title">À venir</h3><div class="card-list">${upcoming.map(a => appointmentCard(a, store, { showDate: true, compact: true })).join('')}</div>` : ''}
      ${pastList.length ? `<h3 class="mini-title">Historique</h3><div class="card-list">${pastList.map(a => appointmentCard(a, store, { showDate: true, compact: true })).join('')}</div>` : '<p class="muted">Pas encore d’historique.</p>'}
    </section>
    <section class="card danger-zone"><h2 class="card-title">Données personnelles (RGPD)</h2>
      <p class="muted">Exportez ses données sur simple demande, ou supprimez sa fiche : l’historique est alors anonymisé.</p>
      <div class="button-row"><button type="button" class="btn btn-secondary btn-sm" data-export="json">${icon('download')}Exporter (JSON)</button><button type="button" class="btn btn-secondary btn-sm" data-export="csv">${icon('download')}Exporter (CSV)</button>
        ${c.archived ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-archive>${icon('archive')}Archiver</button>`}
        <button type="button" class="btn btn-ghost btn-sm btn-danger-text" data-delete>${icon('trash')}Supprimer définitivement</button></div>
    </section>
  </section>`;
}

export function clientDialog(ctx, client, { onSaved } = {}) {
  const c = client || { refill_days: 21, source: 'manual' };
  openDialog({
    title: client ? 'Modifier la fiche' : 'Nouvelle cliente', eyebrow: 'Fiche cliente', submitLabel: client ? 'Enregistrer' : 'Créer la fiche',
    body: `<div class="form form-dialog">
      <label class="field"><span class="label-text">Nom et prénom</span><input name="name" value="${e(c.name || '')}" maxlength="120" required autocomplete="off"></label>
      <div class="field-row"><label class="field"><span class="label-text">Prénom d’usage</span><input name="preferred_name" value="${e(c.preferred_name || '')}" maxlength="60"></label>
        <label class="field"><span class="label-text">Téléphone</span><input name="phone" type="tel" inputmode="tel" value="${e(phoneDisplay(c.phone || ''))}" placeholder="06 12 34 56 78"></label></div>
      <div class="field-row"><label class="field"><span class="label-text">E-mail</span><input name="email" type="email" value="${e(c.email || '')}" maxlength="254"></label>
        <label class="field"><span class="label-text">Comment vous a-t-elle connue ?</span><select name="source">${Object.entries(CLIENT_SOURCES).map(([k, v]) => `<option value="${k}" ${c.source === k ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label></div>
      <label class="field"><span class="label-text">Préférences et notes</span><textarea name="notes" rows="3" maxlength="2000" aria-describedby="health-hint" placeholder="Forme amande, teintes nude…">${e(c.notes || '')}</textarea><small class="hint hint-warn" id="health-hint">${icon('shield')}${e(HEALTH_WARNING)}</small></label>
      <fieldset class="fieldset"><legend>Accords de la cliente <span class="muted">(à recueillir auprès d’elle)</span></legend>
        <label class="check"><input type="checkbox" name="reminder_opt_in" ${c.reminder_opt_in ? 'checked' : ''}><span>Accepte les rappels de rendez-vous</span></label>
        <label class="check"><input type="checkbox" name="refill_opt_in" ${c.refill_opt_in ? 'checked' : ''}><span>Accepte les relances (remplissage, entretien)</span></label>
        <label class="field field-narrow"><span class="label-text">Délai de relance (jours)</span><input name="refill_days" type="number" min="7" max="90" value="${e(c.refill_days ?? 21)}" required inputmode="numeric"></label>
      </fieldset></div>`,
    onSubmit: async (values, form) => {
      const saved = await ctx.store.saveClient({ ...values, refill_days: Number(values.refill_days), reminder_opt_in: form.querySelector('[name=reminder_opt_in]').checked, refill_opt_in: form.querySelector('[name=refill_opt_in]').checked }, client?.id);
      ctx.notice(client ? 'Fiche mise à jour.' : 'Cliente ajoutée.');
      onSaved?.(saved);
    }
  });
}

function addressDialog(ctx, clientId, address) {
  openDialog({
    title: address ? 'Modifier l’adresse' : 'Nouvelle adresse', eyebrow: 'Adresse d’intervention',
    body: `<div class="form form-dialog"><label class="field"><span class="label-text">Libellé (facultatif)</span><input name="label" value="${e(address?.label || '')}" maxlength="40" placeholder="Domicile, travail, chez sa mère…"></label>
      ${addressFields(address || {}, { legend: 'Adresse' })}
      <label class="check"><input type="checkbox" name="is_primary" ${address?.is_primary || !(ctx.store.state.addresses || []).some(a => a.client_id === clientId) ? 'checked' : ''}><span>Adresse principale</span></label></div>`,
    onSubmit: async (values, form) => {
      await ctx.store.saveAddress(clientId, { label: values.label, ...pickAddress(values), is_primary: form.querySelector('[name=is_primary]').checked }, address?.id);
      ctx.notice('Adresse enregistrée.');
    }
  });
}

export function bind(root, ctx) {
  const { store } = ctx;
  if (ctx.route.name === 'clientes') {
    root.querySelector('[data-new-client]').addEventListener('click', () => clientDialog(ctx, null, { onSaved: c => c?.id && ctx.navigate(`clientes/${c.id}`) }));
    root.querySelector('[data-search]').addEventListener('input', event => { search = event.target.value; root.querySelector('[data-results]').innerHTML = listItems(ctx); });
    root.querySelectorAll('[data-archived]').forEach(b => b.addEventListener('click', () => { showArchived = b.dataset.archived === '1'; ctx.rerender(); }));
    return;
  }
  const id = ctx.route.params.id;
  const c = store.state.clients.find(x => x.id === id);
  if (!c) return;
  root.querySelector('[data-book]')?.addEventListener('click', () => ctx.openAppointment({ clientId: id, day: today() }));
  root.querySelector('[data-edit]').addEventListener('click', () => clientDialog(ctx, c));
  root.querySelectorAll('[data-appointment]').forEach(b => b.addEventListener('click', () => ctx.openAppointment(b.dataset.appointment)));
  root.querySelector('[data-add-address]').addEventListener('click', () => addressDialog(ctx, id));
  root.querySelectorAll('[data-edit-address]').forEach(b => b.addEventListener('click', () => addressDialog(ctx, id, store.state.addresses.find(a => a.id === b.dataset.editAddress))));
  root.querySelectorAll('[data-delete-address]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Supprimer cette adresse ?', message: 'Les rendez-vous passés gardent leur adresse.', confirmLabel: 'Supprimer', danger: true }))) return;
    try { await store.deleteAddress(b.dataset.deleteAddress); ctx.notice('Adresse supprimée.'); } catch (error) { ctx.noticeError(error); }
  }));
  root.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', async () => {
    try {
      const data = await store.exportClient(id);
      const slug = c.name.toLocaleLowerCase('fr').normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cliente';
      if (b.dataset.export === 'json') download(`nailpilot-${slug}.json`, JSON.stringify(data, null, 2));
      else download(`nailpilot-${slug}.csv`, toCsv((data.appointments || []).map(a => ({ date: a.starts_at, prestation: a.service_name, duree_min: a.duration_min, prix_cents: a.price_cents ?? '', lieu: a.location_type, statut: a.status }))), 'text/csv');
      ctx.notice('Export prêt.');
    } catch (error) { ctx.noticeError(error); }
  }));
  root.querySelector('[data-archive]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Archiver cette cliente ?', message: 'Sa fiche et son historique sont conservés, mais elle n’apparaît plus dans vos listes.', confirmLabel: 'Archiver' }))) return;
    try { await store.archiveClient(id); ctx.notice('Cliente archivée.'); } catch (error) { ctx.noticeError(error); }
  });
  root.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Supprimer définitivement ?', message: `La fiche de ${c.name}, ses adresses et ses consentements seront effacés. Les rendez-vous passés seront anonymisés. Cette action est irréversible.`, confirmLabel: 'Supprimer définitivement', danger: true }))) return;
    try { await store.deleteClient(id); ctx.notice('Fiche supprimée.'); ctx.navigate('clientes'); } catch (error) { ctx.noticeError(error); }
  });
}
