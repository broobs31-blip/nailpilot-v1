// F2 + F4 — assistant de démarrage en 3 étapes : métier, lieu de travail, page de réservation.
import { TRADES, WORK_MODES, DEFAULT_CATALOG, slugify, formatDuration, formatPrice } from '../domain.js';
import { icon, tradeIcon } from '../components/icons.js';
import { e, formValues } from '../components/format.js';
import { addressFields, pickAddress } from '../components/address-fields.js';
import { isValidSlug } from '../router.js';

let step = 1;
let draft = null;

const HOURS_PRESETS = {
  'tue-sat': { label: 'Du mardi au samedi, 9 h – 19 h', days: [2, 3, 4, 5, 6], start: 540, end: 1140 },
  'mon-fri': { label: 'Du lundi au vendredi, 9 h – 18 h', days: [1, 2, 3, 4, 5], start: 540, end: 1080 },
  'mon-sat': { label: 'Du lundi au samedi, 8 h 30 – 19 h 30', days: [1, 2, 3, 4, 5, 6], start: 510, end: 1170 },
  later: { label: 'Je les règle plus tard', days: [] }
};

function initDraft(store) {
  const p = store.state.profile || {}, pub = store.state.publicProfile || {};
  return {
    trades: p.trades?.length ? [...p.trades] : [], display_name: pub.display_name || '', city: pub.city || p.base_city || '',
    work_mode: p.work_mode || 'home_studio',
    base_address_line: p.base_address_line || '', base_postal_code: p.base_postal_code || '', base_city: p.base_city || '', base_access_info: p.base_access_info || '',
    zone_postal_codes: (p.zone_postal_codes || []).join(', '), zone_radius_km: p.zone_radius_km ?? '', travel_buffer_min: p.travel_buffer_min ?? 30,
    slug: pub.slug || '', seed: !(store.state.services || []).some(s => !s.archived), hours: (store.state.openingHours || []).length ? 'keep' : 'tue-sat',
    published: true
  };
}

export function render(ctx) {
  if (!draft) draft = initDraft(ctx.store);
  const progress = `<ol class="stepper" aria-label="Étapes">${['Votre métier', 'Votre lieu', 'Votre page'].map((label, i) =>
    `<li class="${i + 1 === step ? 'is-current' : i + 1 < step ? 'is-done' : ''}"${i + 1 === step ? ' aria-current="step"' : ''}><span class="step-dot">${i + 1 < step ? icon('check') : i + 1}</span><span class="step-label">${label}</span></li>`).join('')}</ol>`;
  let body = '';
  if (step === 1) {
    body = `<p class="eyebrow">Étape 1 sur 3</p><h1>Parlez-nous de votre activité</h1>
      <p class="lead">Nous préparons votre catalogue et votre page selon votre métier.</p>
      <fieldset class="fieldset"><legend>Vos métiers <span class="muted">(plusieurs choix possibles)</span></legend>
        <div class="choice-grid">${Object.entries(TRADES).map(([key, label]) => `<label class="choice-card"><input type="checkbox" name="trades" value="${key}" ${draft.trades.includes(key) ? 'checked' : ''}>
          <span class="choice-body">${icon(tradeIcon(key), { className: 'icon-lg' })}<strong>${e(label)}</strong></span></label>`).join('')}</div></fieldset>
      <label class="field"><span class="label-text">Nom de votre activité</span><input name="display_name" value="${e(draft.display_name)}" maxlength="80" required placeholder="Ex. Les ongles d’Inès" autocomplete="organization"><small class="hint">Affiché sur votre page de réservation.</small></label>
      <label class="field"><span class="label-text">Ville</span><input name="city" value="${e(draft.city)}" maxlength="80" required autocomplete="address-level2"></label>`;
  } else if (step === 2) {
    const needsBase = draft.work_mode !== 'mobile', needsZone = draft.work_mode !== 'home_studio';
    const descriptions = { home_studio: 'Mes clientes viennent chez moi ou à mon studio.', mobile: 'Je me déplace chez mes clientes.', both: 'Je reçois et je me déplace.' };
    body = `<p class="eyebrow">Étape 2 sur 3</p><h1>Où travaillez-vous ?</h1>
      <p class="lead">NailPilot bloque automatiquement vos temps de trajet entre deux clientes.</p>
      <fieldset class="fieldset"><legend>Mode de travail</legend><div class="choice-grid choice-grid-3">${Object.entries(WORK_MODES).map(([key, label]) => `<label class="choice-card"><input type="radio" name="work_mode" value="${key}" ${draft.work_mode === key ? 'checked' : ''} data-work-mode>
        <span class="choice-body">${icon(key === 'home_studio' ? 'home' : key === 'mobile' ? 'car' : 'sparkle', { className: 'icon-lg' })}<strong>${e(label)}</strong><small>${descriptions[key]}</small></span></label>`).join('')}</div></fieldset>
      ${needsBase ? `<div class="sub-panel">${addressFields({ address_line: draft.base_address_line, postal_code: draft.base_postal_code, city: draft.base_city, access_info: draft.base_access_info }, { prefix: 'base_', legend: 'Adresse où vous recevez', accessLabel: 'Infos d’accès pour vos clientes (étage, code)' })}
        <p class="hint">${icon('shield')} Jamais affichée sur votre page publique : seule la ville l’est. L’adresse est communiquée une fois le rendez-vous confirmé.</p></div>` : ''}
      ${needsZone ? `<fieldset class="fieldset sub-panel"><legend>Votre zone de déplacement</legend>
        <label class="field"><span class="label-text">Codes postaux desservis</span><input name="zone_postal_codes" value="${e(draft.zone_postal_codes)}" inputmode="numeric" placeholder="69100, 69500, 69200" aria-describedby="zone-hint"><small class="hint" id="zone-hint">Séparés par des virgules. Laissez vide pour accepter toutes les adresses.</small></label>
        <div class="field-row"><label class="field"><span class="label-text">Rayon indicatif (km)</span><input name="zone_radius_km" type="number" min="1" max="200" value="${e(draft.zone_radius_km)}" inputmode="numeric"></label>
        <label class="field"><span class="label-text">Trajet entre deux clientes (min)</span><input name="travel_buffer_min" type="number" min="0" max="120" step="5" value="${e(draft.travel_buffer_min)}" required inputmode="numeric"></label></div>
        <p class="hint">${icon('car')} Ce temps est bloqué avant et après chaque rendez-vous à domicile, sans être compté deux fois entre deux clientes.</p></fieldset>` : ''}`;
  } else {
    const suggestion = draft.slug || safeSlugify(draft.display_name);
    const catalog = draft.trades.flatMap(t => (DEFAULT_CATALOG[t] || []).map(s => ({ ...s, trade: t })));
    body = `<p class="eyebrow">Étape 3 sur 3</p><h1>Votre page de réservation</h1>
      <p class="lead">C’est le lien à mettre dans votre bio Instagram.</p>
      <label class="field"><span class="label-text">Adresse de votre page</span>
        <span class="input-prefix"><span aria-hidden="true">${e(location.host)}/r/</span><input name="slug" value="${e(suggestion)}" minlength="3" maxlength="40" pattern="[a-z0-9][a-z0-9\\-]{1,38}[a-z0-9]" required autocapitalize="off" spellcheck="false" aria-describedby="slug-status" data-slug></span>
        <small class="hint" id="slug-status" aria-live="polite">Lettres minuscules, chiffres et tirets.</small></label>
      ${catalog.length ? `<fieldset class="fieldset"><legend>Votre catalogue</legend>
        <label class="check"><input type="checkbox" name="seed" ${draft.seed ? 'checked' : ''}><span>Ajouter les prestations types (modifiables ensuite)</span></label>
        <ul class="mini-list">${catalog.slice(0, 8).map(s => `<li><span>${e(s.name)}</span><small>${e(safe(() => formatDuration(s.duration_min), `${s.duration_min} min`))} · ${e(safe(() => formatPrice(s.price_cents ?? null), ''))}</small></li>`).join('')}${catalog.length > 8 ? `<li class="muted">… et ${catalog.length - 8} autres</li>` : ''}</ul></fieldset>` : ''}
      ${draft.hours !== 'keep' ? `<label class="field"><span class="label-text">Vos horaires habituels</span><select name="hours">${Object.entries(HOURS_PRESETS).map(([k, v]) => `<option value="${k}" ${draft.hours === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select><small class="hint">Vous pourrez ajouter des pauses et des fermetures dans Réglages.</small></label>` : ''}
      <label class="check"><input type="checkbox" name="published" ${draft.published ? 'checked' : ''}><span>Mettre ma page en ligne dès maintenant</span></label>`;
  }
  return `<div class="onboarding">${progress}<form class="card form onboarding-card" data-onboarding novalidate>${body}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions">${step > 1 ? '<button type="button" class="btn btn-ghost" data-back>Retour</button>' : '<span></span>'}
      <button type="submit" class="btn btn-primary btn-lg">${step < 3 ? 'Continuer' : 'Terminer et voir ma journée'}${icon('arrowRight')}</button></div></form></div>`;
}

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const safeSlugify = name => safe(() => slugify(name), '');

function collect(form) {
  const v = formValues(form);
  if (step === 1) Object.assign(draft, { trades: [...form.querySelectorAll('[name=trades]:checked')].map(i => i.value), display_name: v.display_name, city: v.city });
  if (step === 2) {
    draft.work_mode = v.work_mode || draft.work_mode;
    if ('base_address_line' in v) { const a = pickAddress(v, 'base_'); Object.assign(draft, { base_address_line: a.address_line, base_postal_code: a.postal_code, base_city: a.city, base_access_info: a.access_info }); }
    if ('zone_postal_codes' in v) Object.assign(draft, { zone_postal_codes: v.zone_postal_codes, zone_radius_km: v.zone_radius_km, travel_buffer_min: v.travel_buffer_min });
  }
  if (step === 3) Object.assign(draft, { slug: v.slug.toLowerCase(), seed: form.querySelector('[name=seed]')?.checked ?? false, published: form.querySelector('[name=published]').checked, hours: v.hours || draft.hours });
}

export function bind(root, ctx) {
  const { store, navigate, notice } = ctx;
  const form = root.querySelector('[data-onboarding]');
  const error = form.querySelector('.form-error');
  const fail = (message, focus) => { error.textContent = message; error.hidden = false; focus?.focus(); };
  form.querySelector('[data-back]')?.addEventListener('click', () => { collect(form); step--; ctx.rerender(); root.querySelector('h1')?.focus(); });
  form.querySelectorAll('[data-work-mode]').forEach(r => r.addEventListener('change', () => { collect(form); ctx.rerender(); root.querySelector(`[data-work-mode][value="${draft.work_mode}"]`)?.focus(); }));
  const slugInput = form.querySelector('[data-slug]');
  let timer;
  const checkSlug = async () => {
    const status = root.querySelector('#slug-status');
    const slug = slugInput.value.trim().toLowerCase();
    if (!isValidSlug(slug)) { status.textContent = 'De 3 à 40 caractères : lettres minuscules, chiffres et tirets.'; status.className = 'hint hint-error'; return false; }
    if (slug === store.state.publicProfile?.slug) { status.textContent = 'C’est votre adresse actuelle.'; status.className = 'hint hint-ok'; return true; }
    try {
      const ok = await store.isSlugAvailable(slug);
      status.textContent = ok ? 'Disponible !' : 'Cette adresse est déjà prise ou réservée.';
      status.className = `hint ${ok ? 'hint-ok' : 'hint-error'}`;
      return ok;
    } catch (err) { status.textContent = err.message; status.className = 'hint hint-error'; return false; }
  };
  if (slugInput) {
    slugInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(checkSlug, 350); });
    checkSlug();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    collect(form);
    if (step === 1) {
      if (!draft.trades.length) return fail('Choisissez au moins un métier.', form.querySelector('[name=trades]'));
      if (!draft.display_name) return fail('Indiquez le nom de votre activité.', form.querySelector('[name=display_name]'));
      if (!draft.city) return fail('Indiquez votre ville.', form.querySelector('[name=city]'));
      if (!draft.base_city) draft.base_city = draft.city;
      step = 2; ctx.rerender(); root.querySelector('h1')?.focus(); return;
    }
    if (!form.checkValidity()) { const bad = form.querySelector(':invalid'); return fail(`${bad.labels?.[0]?.querySelector('.label-text')?.textContent || 'Ce champ'} : ${bad.validationMessage}`, bad); }
    if (step === 2) { step = 3; ctx.rerender(); root.querySelector('h1')?.focus(); return; }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    try {
      if (!(await checkSlug())) throw new Error('Choisissez une autre adresse pour votre page.');
      const zones = draft.zone_postal_codes.split(/[\s,;]+/).filter(Boolean);
      await store.saveProfile({
        trades: draft.trades, work_mode: draft.work_mode,
        base_address_line: draft.work_mode === 'mobile' ? '' : draft.base_address_line,
        base_postal_code: draft.work_mode === 'mobile' ? '' : draft.base_postal_code,
        base_city: draft.work_mode === 'mobile' ? '' : draft.base_city,
        base_access_info: draft.work_mode === 'mobile' ? '' : draft.base_access_info,
        zone_postal_codes: draft.work_mode === 'home_studio' ? [] : zones,
        zone_radius_km: draft.work_mode === 'home_studio' || draft.zone_radius_km === '' ? null : Number(draft.zone_radius_km),
        travel_buffer_min: Number(draft.travel_buffer_min ?? 30),
        slug: draft.slug, display_name: draft.display_name, city: draft.city, published: draft.published,
        onboarded: true, onboarded_at: new Date().toISOString()
      });
      if (draft.seed) await store.seedCatalog(draft.trades);
      const preset = HOURS_PRESETS[draft.hours];
      if (preset?.days.length) await store.saveOpeningHours(preset.days.map(weekday => ({ weekday, start_min: preset.start, end_min: preset.end })));
      draft = null; step = 1;
      notice('Votre espace est prêt. Belle journée !');
      navigate('aujourdhui');
    } catch (err) { fail(err.message); }
    finally { submit.disabled = false; submit.removeAttribute('aria-busy'); }
  });
}
