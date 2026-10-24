// F4 — catalogue de prestations : création, ordre (flèches), lieux autorisés, archivage.
import { TRADES, LOCATIONS, formatDuration, formatPrice } from '../domain.js';
import { icon, tradeIcon } from '../components/icons.js';
import { e } from '../components/format.js';
import { openDialog, confirmDialog } from '../components/dialog.js';

let showArchived = false;
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const LOCATION_CHOICES = { both: 'Chez moi et chez la cliente', pro: 'Chez moi uniquement', client: 'Chez la cliente uniquement' };

function sorted(store) { return [...store.state.services].sort((x, y) => (x.position ?? 0) - (y.position ?? 0)); }

export function render(ctx) {
  const { store } = ctx;
  const all = sorted(store);
  const active = all.filter(s => !s.archived);
  const archived = all.filter(s => s.archived);
  const trades = store.state.profile?.trades || [];
  const missing = trades.filter(t => !all.some(s => s.trade === t));
  return `<section class="page">
    <header class="page-head"><div><p class="eyebrow">Mon catalogue</p><h1>Prestations</h1><p class="lead">L’ordre ci-dessous est celui de votre page de réservation.</p></div>
      <button type="button" class="btn btn-primary btn-new" data-new-service>${icon('plus')}<span>Nouvelle prestation</span></button></header>
    ${missing.length ? `<p class="callout callout-info">${icon('sparkle')}<span>Gagnez du temps : ajoutez le catalogue type ${missing.map(t => `« ${e(TRADES[t])} »`).join(' et ')}, puis ajustez prix et durées.</span><button type="button" class="btn btn-secondary btn-sm" data-seed>Ajouter</button></p>` : ''}
    ${active.length ? `<ol class="service-list">${active.map((s, i) => `<li class="service-row card">
      <span class="service-icon">${icon(tradeIcon(s.trade))}</span>
      <div class="service-main"><strong>${e(s.name)}</strong>
        <span class="service-meta">${e(safe(() => formatDuration(s.duration_min), `${s.duration_min} min`))} · ${e(safe(() => formatPrice(s.price_cents ?? null), ''))}${s.category ? ` · ${e(s.category)}` : ''}</span>
        <span class="service-tags">${s.allowed_locations !== 'client' ? `<span class="chip">${icon('home')}Chez moi</span>` : ''}${s.allowed_locations !== 'pro' ? `<span class="chip">${icon('car')}À domicile</span>` : ''}${s.online ? '<span class="chip chip-ok">En ligne</span>' : '<span class="chip">Hors ligne</span>'}${s.refill_enabled && s.refill_days ? `<span class="chip">${icon('refresh')}Relance ${e(s.refill_days)} j</span>` : ''}</span></div>
      <div class="row-actions">
        <button type="button" class="icon-btn" data-move="${e(s.id)}" data-dir="-1" aria-label="Monter ${e(s.name)}" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp')}</button>
        <button type="button" class="icon-btn" data-move="${e(s.id)}" data-dir="1" aria-label="Descendre ${e(s.name)}" ${i === active.length - 1 ? 'disabled' : ''}>${icon('chevronDown')}</button>
        <button type="button" class="icon-btn" data-edit-service="${e(s.id)}" aria-label="Modifier ${e(s.name)}">${icon('edit')}</button>
      </div></li>`).join('')}</ol>` : `<div class="empty-state">${icon('sparkle', { className: 'icon-xl' })}<h2>Aucune prestation</h2><p>Ajoutez vos prestations pour pouvoir prendre des rendez-vous.</p></div>`}
    ${archived.length ? `<details class="disclosure"${showArchived ? ' open' : ''} data-archived-box><summary>${archived.length} prestation${archived.length > 1 ? 's' : ''} archivée${archived.length > 1 ? 's' : ''}</summary>
      <ul class="plain-list">${archived.map(s => `<li class="archived-row"><span>${e(s.name)}</span><span class="button-row"><button type="button" class="btn btn-ghost btn-sm" data-unarchive="${e(s.id)}">Réactiver</button><button type="button" class="btn btn-ghost btn-sm btn-danger-text" data-delete-service="${e(s.id)}">Supprimer</button></span></li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function serviceDialog(ctx, service) {
  const s = service || { duration_min: 60, price_cents: null, allowed_locations: 'both', online: true, prep_min: 10, refill_enabled: false, trade: ctx.store.state.profile?.trades?.[0] || 'nails' };
  const quote = s.price_cents == null && service;
  openDialog({
    title: service ? 'Modifier la prestation' : 'Nouvelle prestation', eyebrow: 'Catalogue', wide: true,
    submitLabel: 'Enregistrer',
    extraActions: service ? `<button type="button" class="btn btn-ghost btn-danger-text" data-archive>${icon('archive')}Archiver</button>` : '',
    body: `<div class="form form-dialog">
      <div class="field-row"><label class="field"><span class="label-text">Nom</span><input name="name" value="${e(s.name || '')}" maxlength="80" required></label>
        <label class="field"><span class="label-text">Métier</span><select name="trade">${Object.entries(TRADES).map(([k, v]) => `<option value="${k}" ${s.trade === k ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label></div>
      <div class="field-row"><label class="field"><span class="label-text">Catégorie</span><input name="category" value="${e(s.category || '')}" maxlength="40" placeholder="Ex. Gel, Couleur, Mariée"></label>
        <label class="field"><span class="label-text">Durée (min)</span><input name="duration_min" type="number" min="15" max="480" step="5" value="${e(s.duration_min)}" required inputmode="numeric"></label></div>
      <div class="field-row"><label class="field"><span class="label-text">Prix (€ TTC)</span><input name="price" type="number" min="0" max="2000" step="0.01" value="${s.price_cents != null ? e((s.price_cents / 100).toFixed(2)) : ''}" inputmode="decimal" data-price ${quote ? 'disabled' : ''}></label>
        <label class="check check-inline"><input type="checkbox" name="quote" ${quote ? 'checked' : ''} data-quote><span>Sur devis</span></label></div>
      <label class="field"><span class="label-text">Description</span><textarea name="description" maxlength="300" rows="2">${e(s.description || '')}</textarea></label>
      <label class="field"><span class="label-text">Où ?</span><select name="allowed_locations">${Object.entries(LOCATION_CHOICES).map(([k, v]) => `<option value="${k}" ${s.allowed_locations === k ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label>
      <div class="field-row"><label class="field"><span class="label-text">Préparation après (min)</span><input name="prep_min" type="number" min="0" max="60" step="5" value="${e(s.prep_min ?? 10)}" inputmode="numeric"><small class="hint">Nettoyage, désinfection (RDV chez vous).</small></label>
        <label class="field"><span class="label-text">Relance conseillée (jours)</span><input name="refill_days" type="number" min="7" max="90" value="${e(s.refill_days ?? '')}" inputmode="numeric" placeholder="Aucune"></label></div>
      <label class="check"><input type="checkbox" name="online" ${s.online ? 'checked' : ''}><span>Réservable sur ma page en ligne</span></label>
    </div>`,
    onBind: (dialog, api) => {
      const quoteBox = dialog.querySelector('[data-quote]'), price = dialog.querySelector('[data-price]');
      quoteBox.addEventListener('change', () => { price.disabled = quoteBox.checked; if (quoteBox.checked) price.value = ''; });
      dialog.querySelector('[data-archive]')?.addEventListener('click', async () => {
        try { await ctx.store.archiveService(service.id, true); api.close(); ctx.notice('Prestation archivée : elle reste visible sur les rendez-vous passés.'); } catch (error) { api.setError(error.message); }
      });
    },
    onSubmit: async (values, form) => {
      const quoteOn = form.querySelector('[data-quote]').checked;
      if (!quoteOn && values.price === '') throw new Error('Indiquez un prix ou cochez « Sur devis ».');
      await ctx.store.saveService({
        name: values.name, trade: values.trade, category: values.category, description: values.description,
        duration_min: Number(values.duration_min), price_cents: quoteOn ? null : Math.round(Number(String(values.price).replace(',', '.')) * 100),
        allowed_locations: values.allowed_locations, online: form.querySelector('[name=online]').checked, prep_min: Number(values.prep_min || 0),
        refill_enabled: values.refill_days !== '', refill_days: values.refill_days === '' ? null : Number(values.refill_days),
        ...(service ? {} : { position: ctx.store.state.services.length })
      }, service?.id);
      ctx.notice('Prestation enregistrée.');
    }
  });
}

export function bind(root, ctx) {
  const { store } = ctx;
  root.querySelector('[data-new-service]').addEventListener('click', () => serviceDialog(ctx));
  root.querySelector('[data-seed]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await store.seedCatalog(store.state.profile?.trades || []); ctx.notice('Catalogue type ajouté. Ajustez vos prix !'); } catch (error) { ctx.noticeError(error); }
  });
  root.querySelectorAll('[data-edit-service]').forEach(b => b.addEventListener('click', () => serviceDialog(ctx, store.state.services.find(s => s.id === b.dataset.editService))));
  root.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', async () => {
    const ids = sorted(store).filter(s => !s.archived).map(s => s.id);
    const i = ids.indexOf(b.dataset.move), j = i + Number(b.dataset.dir);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const archived = sorted(store).filter(s => s.archived).map(s => s.id);
    const focusKey = `[data-move="${b.dataset.move}"][data-dir="${b.dataset.dir}"]`;
    try { await store.reorderServices([...ids, ...archived]); document.querySelector(focusKey)?.focus(); } catch (error) { ctx.noticeError(error); }
  }));
  root.querySelector('[data-archived-box]')?.addEventListener('toggle', event => { showArchived = event.currentTarget.open; });
  root.querySelectorAll('[data-unarchive]').forEach(b => b.addEventListener('click', async () => {
    try { await store.archiveService(b.dataset.unarchive, false); ctx.notice('Prestation réactivée.'); } catch (error) { ctx.noticeError(error); }
  }));
  root.querySelectorAll('[data-delete-service]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Supprimer cette prestation ?', message: 'Les rendez-vous passés gardent son nom, sa durée et son prix.', confirmLabel: 'Supprimer', danger: true }))) return;
    try { await store.deleteService(b.dataset.deleteService); ctx.notice('Prestation supprimée.'); } catch (error) { ctx.noticeError(error); }
  }));
}
