// F8 — page publique de réservation /r/<slug> : prestation → lieu → créneau → coordonnées → confirmation.
// Chargée seule (import dynamique) : aucune donnée ni code de l'espace pro.
import { createPublicApi } from './store.js';
import { TRADES, HEALTH_WARNING, formatPrice, formatDuration, isInZone, icsEvent, addDays } from './domain.js';
import { icon, tradeIcon } from './components/icons.js';
import { e, today, localDay, hm, dayLabel, capitalize, dateTimeLabel, initials, download, formValues, localMinutes } from './components/format.js';
import { addressFields, pickAddress } from './components/address-fields.js';

const STEPS = ['Prestation', 'Lieu', 'Créneau', 'Coordonnées'];
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export async function mount(root, slug) {
  const api = createPublicApi();
  const st = { page: null, step: 1, service: null, location: null, address: {}, from: today(), slots: [], day: null, slot: null, contact: {}, result: null, error: '', loading: true, slotsLoading: false };

  root.innerHTML = `<div class="pb-shell"><div class="splash" role="status"><span class="brand-mark" aria-hidden="true">n.</span><p>Chargement de la page…</p></div></div>`;
  try { st.page = await api.getPage(slug); }
  catch (error) { st.error = error.message; }
  st.loading = false;
  if (!st.page) {
    document.title = 'Page introuvable · NailPilot';
    root.innerHTML = `<div class="pb-shell"><main class="pb-main" id="main"><section class="pb-card pb-empty">${icon('calendar', { className: 'icon-xl' })}<h1>Cette page de réservation n’existe pas</h1>
      <p>${st.error ? e(st.error) : 'Le lien est peut-être incomplet, ou la page n’est plus en ligne. Contactez directement votre professionnelle.'}</p></section></main>${footer()}</div>`;
    return;
  }
  const page = st.page;
  document.title = `Réserver · ${page.display_name}`;
  const workAllows = loc => page.work_mode === 'both' || (page.work_mode === 'home_studio' ? loc === 'pro' : loc === 'client');
  const locationsFor = s => ['pro', 'client'].filter(loc => (s.allowed_locations === 'both' || s.allowed_locations === loc) && workAllows(loc));
  const services = (page.services || []).filter(s => locationsFor(s).length);

  function header() {
    const trades = (page.trades || []).map(t => `<span class="chip chip-soft">${icon(tradeIcon(t))}${e(TRADES[t] || t)}</span>`).join('');
    return `<header class="pb-hero">
      <span class="pb-avatar" aria-hidden="true">${e(initials(page.display_name))}</span>
      <div class="pb-hero-text"><p class="eyebrow">Réservation en ligne</p><h1>${e(page.display_name)}</h1>
        <p class="pb-place">${icon('pin')}${e(page.city || '')}${page.work_mode !== 'home_studio' ? ` · se déplace${page.zone_radius_km ? ` dans un rayon de ${e(page.zone_radius_km)} km` : ' à domicile'}` : ''}</p>
        <div class="pb-chips">${trades}${page.instagram ? `<a class="chip chip-soft" href="https://instagram.com/${encodeURIComponent(page.instagram)}" target="_blank" rel="noopener noreferrer">${icon('instagram')}@${e(page.instagram)}</a>` : ''}</div></div>
      ${page.bio ? `<p class="pb-bio">${e(page.bio)}</p>` : ''}
    </header>`;
  }

  function stepper() {
    if (st.step > 4) return '';
    return `<ol class="pb-steps" aria-label="Étapes de la réservation">${STEPS.map((label, i) => `<li class="${i + 1 === st.step ? 'is-current' : i + 1 < st.step ? 'is-done' : ''}"${i + 1 === st.step ? ' aria-current="step"' : ''}><span class="sr-only">Étape ${i + 1} : </span>${label}</li>`).join('')}</ol>`;
  }

  function summary() {
    if (!st.service) return '';
    const rows = [`<li>${icon(tradeIcon(st.service.trade))}<span><strong>${e(st.service.name)}</strong> · ${e(safe(() => formatDuration(st.service.duration_min), ''))} · ${e(safe(() => formatPrice(st.service.price_cents ?? null), ''))}</span></li>`];
    if (st.location && st.step > 2) rows.push(`<li>${icon(st.location === 'pro' ? 'home' : 'car')}<span>${st.location === 'pro' ? `Chez ${e(page.display_name)}, ${e(page.city)}` : `Chez vous · ${e(st.address.city || '')}`}</span></li>`);
    if (st.slot && st.step > 3) rows.push(`<li>${icon('calendar')}<span>${e(capitalize(dateTimeLabel(st.slot)))}</span></li>`);
    return `<ul class="pb-summary" aria-label="Votre choix">${rows.join('')}</ul>`;
  }

  function stepService() {
    const groups = [...new Set(services.map(s => s.trade || ''))];
    const card = s => `<li><button type="button" class="pb-service${st.service?.id === s.id ? ' is-selected' : ''}" data-service="${e(s.id)}">
      <span class="pb-service-main"><strong>${e(s.name)}</strong>${s.description ? `<span class="pb-desc">${e(s.description)}</span>` : ''}
        <span class="pb-meta">${icon('clock')}${e(safe(() => formatDuration(s.duration_min), `${s.duration_min} min`))}${locationsFor(s).map(l => ` · ${icon(l === 'pro' ? 'home' : 'car')}${l === 'pro' ? 'Chez moi' : 'À domicile'}`).join('')}</span></span>
      <span class="pb-price">${e(safe(() => formatPrice(s.price_cents ?? null), ''))}</span>${icon('chevronRight')}</button></li>`;
    if (!services.length) return `<section class="pb-card"><h2 tabindex="-1" data-step-title>Aucune prestation en ligne</h2><p class="muted">Contactez directement ${e(page.display_name)} pour prendre rendez-vous.</p></section>`;
    return `<section class="pb-card"><h2 tabindex="-1" data-step-title>Choisissez votre prestation</h2>
      ${groups.map(g => `${groups.length > 1 ? `<h3 class="pb-group">${icon(tradeIcon(g))}${e(TRADES[g] || 'Autres')}</h3>` : ''}<ul class="pb-services">${services.filter(s => (s.trade || '') === g).map(card).join('')}</ul>`).join('')}
    </section>`;
  }

  function stepLocation() {
    const locs = locationsFor(st.service);
    const zone = (page.zone_postal_codes || []).length ? `<p class="hint">${icon('car')}Secteurs desservis : ${e(page.zone_postal_codes.join(', '))}</p>` : '';
    return `<section class="pb-card"><h2 tabindex="-1" data-step-title>Où se passe le rendez-vous ?</h2>
      <form data-location-form novalidate>
      <fieldset class="fieldset"><legend class="sr-only">Lieu</legend><div class="choice-grid choice-grid-2">${locs.map(l => `<label class="choice-card"><input type="radio" name="location" value="${l}" ${st.location === l || locs.length === 1 ? 'checked' : ''} data-loc>
        <span class="choice-body">${icon(l === 'pro' ? 'home' : 'car', { className: 'icon-lg' })}<strong>${l === 'pro' ? `Je viens chez ${e(page.display_name)}` : 'Elle vient chez moi'}</strong>
        <small>${l === 'pro' ? `À ${e(page.city || 'proximité')}. L’adresse exacte vous est communiquée à la confirmation.` : 'Indiquez l’adresse du rendez-vous.'}</small></span></label>`).join('')}</div></fieldset>
      <div data-address ${st.location === 'client' || (locs.length === 1 && locs[0] === 'client') ? '' : 'hidden'}>${addressFields(st.address, { legend: 'Adresse du rendez-vous', accessLabel: 'Infos d’accès (digicode, étage, stationnement)' })}${zone}</div>
      <p class="form-error" role="alert" hidden></p>
      <div class="pb-actions"><button type="button" class="btn btn-ghost" data-back>${icon('chevronLeft')}Retour</button><button type="submit" class="btn btn-primary btn-lg">Voir les créneaux${icon('arrowRight')}</button></div></form></section>`;
  }

  function stepSlot() {
    const byDay = new Map();
    for (const s of st.slots) { const d = localDay(s); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(s); }
    const days = [...byDay.keys()];
    if (!st.day || !byDay.has(st.day)) st.day = days[0] || null;
    const list = st.day ? byDay.get(st.day) : [];
    const parts = [['Matin', s => localMinutes(s) < 720], ['Après-midi', s => localMinutes(s) >= 720 && localMinutes(s) < 1080], ['Soirée', s => localMinutes(s) >= 1080]];
    const horizonEnd = addDays(today(), page.max_horizon_days || 60);
    const canNext = addDays(st.from, 31) <= horizonEnd;
    return `<section class="pb-card"><h2 tabindex="-1" data-step-title>Choisissez votre créneau</h2>
      ${st.error ? `<p class="callout callout-warn" role="alert">${icon('alert')}<span>${e(st.error)}</span></p>` : ''}
      ${st.slotsLoading ? '<p class="pb-loading" role="status">Recherche des créneaux disponibles…</p>' : days.length ? `
        <div class="pb-days" role="group" aria-label="Jours disponibles">${days.map(d => `<button type="button" class="pb-day${d === st.day ? ' is-selected' : ''}" data-day="${e(d)}" aria-pressed="${d === st.day}">
          <small>${e(dayLabel(d, { weekday: 'short' }))}</small><strong>${e(String(Number(d.slice(8))))}</strong><small>${e(dayLabel(d, { month: 'short' }))}</small></button>`).join('')}</div>
        <h3 class="pb-day-title">${e(capitalize(dayLabel(st.day)))}</h3>
        ${parts.map(([label, test]) => { const group = list.filter(test); return group.length ? `<div class="pb-slot-group"><p class="pb-slot-label">${label}</p><div class="pb-slots">${group.map(s => `<button type="button" class="pb-slot${st.slot === s ? ' is-selected' : ''}" data-slot="${e(s)}" aria-label="${e(capitalize(dateTimeLabel(s)))}">${e(hm(s))}</button>`).join('')}</div></div>` : ''; }).join('')}`
      : `<div class="pb-empty-slots">${icon('calendar', { className: 'icon-xl' })}<p><strong>Aucun créneau disponible</strong> entre le ${e(dayLabel(st.from, { day: 'numeric', month: 'long' }))} et le ${e(dayLabel(addDays(st.from, 30), { day: 'numeric', month: 'long' }))}.</p></div>`}
      <div class="pb-period">${st.from > today() ? `<button type="button" class="btn btn-ghost btn-sm" data-period="-1">${icon('chevronLeft')}Période précédente</button>` : '<span></span>'}${canNext ? `<button type="button" class="btn btn-ghost btn-sm" data-period="1">Période suivante${icon('chevronRight')}</button>` : ''}</div>
      <div class="pb-actions"><button type="button" class="btn btn-ghost" data-back>${icon('chevronLeft')}Retour</button></div></section>`;
  }

  function stepDetails() {
    const c = st.contact;
    return `<section class="pb-card"><h2 tabindex="-1" data-step-title>Vos coordonnées</h2>
      <form class="form" data-details novalidate>
        <div class="field-row"><label class="field"><span class="label-text">Prénom</span><input name="firstName" value="${e(c.firstName || '')}" maxlength="60" required autocomplete="given-name"></label>
          <label class="field"><span class="label-text">Nom</span><input name="lastName" value="${e(c.lastName || '')}" maxlength="60" required autocomplete="family-name"></label></div>
        <label class="field"><span class="label-text">Téléphone mobile</span><input name="phone" type="tel" inputmode="tel" value="${e(c.phone || '')}" required autocomplete="tel" placeholder="06 12 34 56 78" aria-describedby="phone-hint"><small class="hint" id="phone-hint">Pour vous confirmer le rendez-vous.</small></label>
        <label class="field"><span class="label-text">E-mail <span class="muted">(facultatif)</span></span><input name="email" type="email" value="${e(c.email || '')}" maxlength="254" autocomplete="email"></label>
        <label class="field"><span class="label-text">Message <span class="muted">(facultatif)</span></span><textarea name="message" maxlength="300" rows="3" placeholder="Forme, couleur, inspiration…" aria-describedby="msg-hint">${e(c.message || '')}</textarea><small class="hint" id="msg-hint">${e(HEALTH_WARNING)}</small></label>
        <div class="pb-honeypot" aria-hidden="true"><label>Site web<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <fieldset class="fieldset"><legend>Vos préférences de contact</legend>
          <label class="check"><input type="checkbox" name="reminderOptIn" ${c.reminderOptIn ? 'checked' : ''}><span>J’accepte de recevoir un rappel la veille de mon rendez-vous.</span></label>
          <label class="check"><input type="checkbox" name="refillOptIn" ${c.refillOptIn ? 'checked' : ''}><span>J’accepte d’être recontactée quand il sera temps de revenir (remplissage, entretien).</span></label>
        </fieldset>
        <p class="pb-legal">Vos données servent uniquement à gérer votre rendez-vous avec ${e(page.display_name)}. <a href="/#/confidentialite" target="_blank" rel="noopener">Politique de confidentialité</a></p>
        <p class="form-error" role="alert" hidden></p>
        <div class="pb-actions"><button type="button" class="btn btn-ghost" data-back>${icon('chevronLeft')}Retour</button>
          <button type="submit" class="btn btn-primary btn-lg">${page.auto_confirm ? 'Confirmer ma réservation' : 'Envoyer ma demande'}</button></div>
      </form></section>`;
  }

  function stepDone() {
    const r = st.result;
    const booked = r.status === 'booked';
    return `<section class="pb-card pb-done">
      <span class="pb-done-icon">${icon('check', { className: 'icon-xl' })}</span>
      <h2 tabindex="-1" data-step-title>${booked ? 'C’est réservé !' : 'Demande envoyée !'}</h2>
      <p class="lead">${booked ? `Votre rendez-vous avec ${e(page.display_name)} est confirmé.` : `${e(page.display_name)} vous répond au plus vite${r.expires_at ? `, au plus tard ${e(dateTimeLabel(r.expires_at))}` : ' (sous 24 h)'}. Le créneau vous est réservé en attendant.`}</p>
      <ul class="pb-summary pb-summary-final">
        <li>${icon('calendar')}<span><strong>${e(capitalize(dateTimeLabel(r.starts_at)))}</strong> – ${e(hm(r.ends_at))}</span></li>
        <li>${icon(tradeIcon(st.service?.trade))}<span>${e(r.service_name)}${r.price_cents != null ? ` · ${e(safe(() => formatPrice(r.price_cents), ''))}` : ''}</span></li>
        <li>${icon(r.location_type === 'client' ? 'car' : 'home')}<span>${r.location_type === 'client' ? `Chez vous${r.city ? `, ${e(r.city)}` : ''}` : `Chez ${e(page.display_name)}${r.city ? `, ${e(r.city)}` : ''}`}</span></li>
        <li>${icon('info')}<span>Statut : <strong>${booked ? 'confirmé' : 'en attente de validation'}</strong></span></li>
      </ul>
      <div class="pb-actions pb-actions-stack"><button type="button" class="btn btn-secondary" data-ics>${icon('download')}Ajouter à mon calendrier</button>
        <button type="button" class="btn btn-ghost" data-restart>Réserver une autre prestation</button></div>
      <p class="hint">Pour annuler ou modifier, contactez directement ${e(page.display_name)}.</p>
    </section>`;
  }

  function render({ focus = true } = {}) {
    const body = st.step === 1 ? stepService() : st.step === 2 ? stepLocation() : st.step === 3 ? stepSlot() : st.step === 4 ? stepDetails() : stepDone();
    root.innerHTML = `<div class="pb-shell"><main class="pb-main${st.step > 1 ? ' is-compact' : ''}" id="main">${header()}${stepper()}${st.step > 1 && st.step < 5 ? summary() : ''}${body}</main>${footer()}</div>`;
    bind();
    if (focus) root.querySelector('[data-step-title]')?.focus({ preventScroll: false });
  }

  function go(step, { push = true } = {}) {
    st.step = step;
    if (push) history.pushState({ step }, '', location.pathname);
    render();
    if (step === 3 && !st.slots.length && !st.slotsLoading) loadSlots();
  }

  async function loadSlots() {
    st.slotsLoading = true; render({ focus: false });
    try {
      st.slots = await api.getSlots({ slug, serviceId: st.service.id, location: st.location, from: st.from, to: addDays(st.from, 30), postalCode: st.location === 'client' ? st.address.postal_code : undefined });
    } catch (error) { st.slots = []; st.error = error.message; }
    st.slotsLoading = false;
    render({ focus: false });
  }

  function bind() {
    root.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => history.back()));
    root.querySelectorAll('[data-service]').forEach(b => b.addEventListener('click', () => {
      const s = services.find(x => x.id === b.dataset.service);
      if (st.service?.id !== s.id) { st.slots = []; st.slot = null; st.day = null; st.from = today(); }
      st.service = s; st.error = '';
      const locs = locationsFor(s);
      if (locs.length === 1 && locs[0] === 'pro') { st.location = 'pro'; st.address = {}; go(3); }
      else { if (!locs.includes(st.location)) st.location = locs[0]; go(2); }
    }));
    const locForm = root.querySelector('[data-location-form]');
    if (locForm) {
      locForm.querySelectorAll('[data-loc]').forEach(r => r.addEventListener('change', () => {
        const isClient = r.value === 'client';
        const box = locForm.querySelector('[data-address]');
        box.hidden = !isClient;
      }));
      locForm.querySelector('[data-address]').querySelectorAll('input').forEach(i => { if (i.name !== 'access_info') i.required = true; });
      locForm.addEventListener('submit', event => {
        event.preventDefault();
        const error = locForm.querySelector('.form-error');
        const location = locForm.querySelector('[data-loc]:checked')?.value;
        if (!location) { error.textContent = 'Choisissez un lieu.'; error.hidden = false; return; }
        if (location === 'client') {
          const v = formValues(locForm);
          const address = pickAddress(v);
          const missing = locForm.querySelector('[data-address] input:invalid');
          if (missing) { error.textContent = missing.name === 'postal_code' ? 'Indiquez un code postal à 5 chiffres.' : 'Complétez l’adresse du rendez-vous.'; error.hidden = false; missing.focus(); return; }
          if (!safe(() => isInZone(page, address.postal_code), true)) { error.textContent = `Désolée, ${page.display_name} ne se déplace pas encore au ${address.postal_code}. Vous pouvez la contacter directement.`; error.hidden = false; return; }
          if (st.address.postal_code !== address.postal_code) { st.slots = []; st.slot = null; }
          st.address = address;
        } else st.address = {};
        if (st.location !== location) { st.slots = []; st.slot = null; }
        st.location = location; st.error = '';
        go(3);
      });
    }
    root.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { st.day = b.dataset.day; render({ focus: false }); root.querySelector(`[data-day="${b.dataset.day}"]`)?.focus(); }));
    root.querySelector('.pb-day.is-selected')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    root.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => { st.slot = b.dataset.slot; st.error = ''; go(4); }));
    root.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => {
      st.from = b.dataset.period === '1' ? addDays(st.from, 31) : (addDays(st.from, -31) < today() ? today() : addDays(st.from, -31));
      st.day = null; st.slots = []; loadSlots();
    }));
    const details = root.querySelector('[data-details]');
    details?.addEventListener('input', () => { st.contact = { ...formValues(details), reminderOptIn: details.querySelector('[name=reminderOptIn]').checked, refillOptIn: details.querySelector('[name=refillOptIn]').checked }; });
    details?.addEventListener('submit', async event => {
      event.preventDefault();
      const error = details.querySelector('.form-error');
      error.hidden = true;
      const invalid = details.querySelector(':invalid');
      if (invalid) { error.textContent = invalid.name === 'email' ? 'Adresse e-mail invalide.' : 'Merci de compléter votre prénom, nom et téléphone.'; error.hidden = false; invalid.focus(); return; }
      const v = formValues(details);
      const submit = details.querySelector('[type=submit]');
      submit.disabled = true; submit.setAttribute('aria-busy', 'true');
      try {
        st.result = await api.requestBooking({
          slug, serviceId: st.service.id, location: st.location, startsAt: st.slot,
          firstName: v.firstName, lastName: v.lastName, phone: v.phone, email: v.email, message: v.message,
          address: st.location === 'client' ? { line: st.address.address_line, postalCode: st.address.postal_code, city: st.address.city, accessInfo: st.address.access_info } : undefined,
          reminderOptIn: details.querySelector('[name=reminderOptIn]').checked, refillOptIn: details.querySelector('[name=refillOptIn]').checked, website: v.website || ''
        });
        st.step = 5; history.replaceState({ step: 5 }, '', location.pathname); render();
      } catch (err) {
        submit.disabled = false; submit.removeAttribute('aria-busy');
        if (err.code === 'slot_taken' || err.code === 'overlap') {
          st.error = 'Ce créneau vient d’être réservé. Voici les disponibilités à jour.';
          st.slot = null; st.slots = []; st.step = 3; history.replaceState({ step: 3 }, '', location.pathname); loadSlots(); return;
        }
        if (err.code === 'forbidden_location') { st.step = 2; render(); const box = root.querySelector('.form-error'); box.textContent = err.message; box.hidden = false; return; }
        error.textContent = err.message || 'La demande n’a pas pu être envoyée. Réessayez.'; error.hidden = false;
      }
    });
    root.querySelector('[data-ics]')?.addEventListener('click', () => {
      const r = st.result;
      const ics = safe(() => icsEvent({ title: `${r.service_name} · ${page.display_name}`, starts_at: r.starts_at, ends_at: r.ends_at, location: r.location_type === 'client' ? [st.address.address_line, st.address.postal_code, st.address.city].filter(Boolean).join(' ') : page.city }), '');
      if (ics) download('rendez-vous.ics', ics, 'text/calendar');
    });
    root.querySelector('[data-restart]')?.addEventListener('click', () => {
      Object.assign(st, { service: null, location: null, slot: null, slots: [], day: null, result: null, error: '', from: today() });
      go(1);
    });
  }

  window.addEventListener('popstate', event => {
    const target = event.state?.step || 1;
    if (st.step === 5) { Object.assign(st, { service: null, slot: null, slots: [], result: null }); st.step = 1; render(); return; }
    const allowed = target === 1 || (target >= 2 && st.service) ;
    st.step = allowed ? Math.min(target, st.slot ? 4 : st.location ? 3 : st.service ? 2 : 1) : 1;
    if (st.step === 2 && st.service && locationsFor(st.service).length === 1 && locationsFor(st.service)[0] === 'pro') st.step = 1;
    render();
    if (st.step === 3 && !st.slots.length) loadSlots();
  });

  history.replaceState({ step: 1 }, '', location.pathname);
  render({ focus: false });
}

function footer() {
  return `<footer class="pb-footer"><a href="/#/confidentialite">Confidentialité</a><span aria-hidden="true">·</span><a href="/#/mentions-legales">Mentions légales</a>
    <p class="pb-powered">Réservation propulsée par <strong>NailPilot</strong> · 0 % de commission</p></footer>`;
}
