// F2, F3, F9, F10, F12 — réglages : profil & page publique, horaires & fermetures, réservation & modèles, compte.
import { TRADES, WORK_MODES, SLOT_STEPS, DEFAULT_TEMPLATES, addDays, minutesToTime, timeToMinutes } from '../domain.js';
import { icon, tradeIcon } from '../components/icons.js';
import { e, formValues, dayLabel, hm, copyText, download, capitalize, today } from '../components/format.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { addressFields, pickAddress } from '../components/address-fields.js';
import { bookingUrl, isValidSlug } from '../router.js';

const TABS = { profil: 'Profil & page', horaires: 'Horaires', reservation: 'Réservation', compte: 'Compte' };
const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const NOTICE = [[0, 'Aucun délai'], [60, '1 heure'], [120, '2 heures'], [360, '6 heures'], [720, '12 heures'], [1440, '24 heures'], [2880, '48 heures'], [4320, '3 jours'], [10080, '7 jours']];
const HORIZON = [[7, '1 semaine'], [14, '2 semaines'], [30, '1 mois'], [60, '2 mois'], [90, '3 mois'], [180, '6 mois'], [366, '12 mois']];
const TEMPLATE_LABELS = { confirmation: 'Confirmation de rendez-vous', decline: 'Refus d’une demande', reminder: 'Rappel la veille', refill: 'Relance (remplissage, entretien)' };
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const toTime = m => safe(() => minutesToTime(m), `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const toMin = t => safe(() => timeToMinutes(t), (([h, m]) => h * 60 + m)(t.split(':').map(Number)));

function fullProfile(store) {
  const p = store.state.profile || {}, pub = store.state.publicProfile || {};
  return { ...p, slug: pub.slug, display_name: pub.display_name, city: pub.city, bio: pub.bio, instagram: pub.instagram, published: pub.published };
}

export function render(ctx) {
  const tab = ctx.route.params.tab || 'profil';
  const content = { profil, horaires, reservation, compte }[tab](ctx);
  return `<section class="page settings-page">
    <header class="page-head"><div><p class="eyebrow">Mon activité</p><h1>Réglages</h1></div></header>
    <nav class="tabs" aria-label="Sections des réglages">${Object.entries(TABS).map(([k, v]) => `<a class="tab-link${k === tab ? ' is-active' : ''}" href="#/reglages/${k}"${k === tab ? ' aria-current="page"' : ''}>${v}</a>`).join('')}</nav>
    ${content}
  </section>`;
}

function profil(ctx) {
  const p = fullProfile(ctx.store);
  const url = p.slug ? bookingUrl(p.slug) : '';
  return `<div class="settings-grid">
    <section class="card publish-card"><div><h2 class="card-title">${icon('link')}Ma page de réservation</h2>
      ${url ? `<p class="share-url">${e(url.replace(/^https?:\/\//, ''))}</p>` : ''}
      <p class="muted">${p.published ? 'En ligne : vos clientes peuvent réserver.' : 'Hors ligne : personne ne peut réserver.'}</p></div>
      <div class="button-row">
        <label class="switch"><input type="checkbox" data-published ${p.published ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>Page en ligne</span></label>
        ${url ? `<button type="button" class="btn btn-secondary btn-sm" data-copy-link>${icon('copy')}Copier mon lien</button><a class="btn btn-ghost btn-sm" href="${e(url)}" target="_blank" rel="noopener">${icon('eye')}Voir ma page</a>` : ''}
      </div></section>
    <form class="card form" data-profile novalidate>
      <h2 class="card-title">Vitrine publique</h2>
      <div class="field-row"><label class="field"><span class="label-text">Nom de votre activité</span><input name="display_name" value="${e(p.display_name || '')}" maxlength="80" required></label>
        <label class="field"><span class="label-text">Ville affichée</span><input name="city" value="${e(p.city || '')}" maxlength="80"></label></div>
      <label class="field"><span class="label-text">Adresse de la page</span><span class="input-prefix"><span aria-hidden="true">/r/</span><input name="slug" value="${e(p.slug || '')}" minlength="3" maxlength="40" required autocapitalize="off" spellcheck="false" aria-describedby="slug-status" data-slug></span><small class="hint" id="slug-status" aria-live="polite">Attention : changer l’adresse casse l’ancien lien.</small></label>
      <label class="field"><span class="label-text">Présentation</span><textarea name="bio" maxlength="300" rows="3" data-counter aria-describedby="bio-count">${e(p.bio || '')}</textarea><small class="hint" id="bio-count" data-count>${(p.bio || '').length}/300</small></label>
      <label class="field"><span class="label-text">Compte Instagram</span><span class="input-prefix"><span aria-hidden="true">@</span><input name="instagram" value="${e(p.instagram || '')}" maxlength="30" pattern="[A-Za-z0-9._]{1,30}" autocapitalize="off"></span></label>
      <h2 class="card-title">Activité</h2>
      <fieldset class="fieldset"><legend>Métiers</legend><div class="choice-grid">${Object.entries(TRADES).map(([k, v]) => `<label class="choice-card choice-sm"><input type="checkbox" name="trades" value="${k}" ${(p.trades || []).includes(k) ? 'checked' : ''}><span class="choice-body">${icon(tradeIcon(k))}<strong>${e(v)}</strong></span></label>`).join('')}</div></fieldset>
      <fieldset class="fieldset"><legend>Mode de travail</legend><div class="segmented">${Object.entries(WORK_MODES).map(([k, v]) => `<label class="segment"><input type="radio" name="work_mode" value="${k}" ${p.work_mode === k ? 'checked' : ''}><span>${e(v)}</span></label>`).join('')}</div></fieldset>
      ${addressFields({ address_line: p.base_address_line, postal_code: p.base_postal_code, city: p.base_city, access_info: p.base_access_info }, { prefix: 'base_', required: false, legend: 'Adresse où vous recevez (privée)', accessLabel: 'Infos d’accès communiquées après confirmation' })}
      <fieldset class="fieldset"><legend>Déplacements</legend>
        <label class="field"><span class="label-text">Codes postaux desservis</span><input name="zone_postal_codes" value="${e((p.zone_postal_codes || []).join(', '))}" inputmode="numeric" placeholder="Vide = toutes les adresses"></label>
        <div class="field-row"><label class="field"><span class="label-text">Rayon indicatif (km)</span><input name="zone_radius_km" type="number" min="1" max="200" value="${e(p.zone_radius_km ?? '')}" inputmode="numeric"></label>
          <label class="field"><span class="label-text">Trajet par défaut (min)</span><input name="travel_buffer_min" type="number" min="0" max="120" step="5" value="${e(p.travel_buffer_min ?? 30)}" inputmode="numeric"></label></div>
      </fieldset>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><span></span><button type="submit" class="btn btn-primary">Enregistrer</button></div>
    </form></div>`;
}

function rangeRow(start = 540, end = 1140) {
  return `<span class="range-row"><label><span class="sr-only">Début</span><input type="time" step="300" data-start value="${e(toTime(start))}" required></label><span aria-hidden="true">–</span>
    <label><span class="sr-only">Fin</span><input type="time" step="300" data-end value="${e(toTime(end))}" required></label>
    <button type="button" class="icon-btn icon-btn-sm" data-remove-range aria-label="Retirer cette plage">${icon('close')}</button></span>`;
}

function horaires(ctx) {
  const s = ctx.store.state;
  const closures = [...(s.closures || [])].filter(c => Date.parse(c.ends_at) > Date.now()).sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
  return `<div class="settings-grid">
    <form class="card form" data-hours novalidate><h2 class="card-title">Horaires de la semaine</h2>
      <p class="muted">Jusqu’à 3 plages par jour (ex. 9 h – 12 h et 13 h 30 – 19 h). Vos rendez-vous existants ne sont jamais modifiés.</p>
      <ul class="hours-list">${WEEKDAYS.map((label, i) => {
        const ranges = (s.openingHours || []).filter(h => h.weekday === i + 1).sort((x, y) => x.start_min - y.start_min);
        return `<li class="hours-day" data-weekday="${i + 1}"><label class="switch"><input type="checkbox" data-open ${ranges.length ? 'checked' : ''} aria-label="${label} ouvert"><span class="switch-track" aria-hidden="true"></span><span class="hours-name">${label}</span></label>
          <div class="hours-ranges" data-ranges>${ranges.length ? ranges.map(r => rangeRow(r.start_min, r.end_min)).join('') : '<span class="muted" data-closed-label>Fermé</span>'}</div>
          <button type="button" class="btn btn-ghost btn-sm" data-add-range ${ranges.length >= 3 || !ranges.length ? 'hidden' : ''}>${icon('plus')}Plage</button></li>`;
      }).join('')}</ul>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><span></span><button type="submit" class="btn btn-primary">Enregistrer les horaires</button></div></form>
    <section class="card"><header class="card-head"><h2 class="card-title">Fermetures exceptionnelles</h2><button type="button" class="btn btn-secondary btn-sm" data-add-closure>${icon('plus')}Ajouter</button></header>
      <p class="muted">Congés, formation, rendez-vous perso : elles priment sur vos horaires.</p>
      ${closures.length ? `<ul class="plain-list closure-list">${closures.map(c => `<li><span><strong>${e(closureLabel(c))}</strong>${c.reason ? `<br><small>${e(c.reason)}</small>` : ''}</span><button type="button" class="icon-btn" data-delete-closure="${e(c.id)}" aria-label="Supprimer la fermeture">${icon('trash')}</button></li>`).join('')}</ul>` : '<p class="muted">Aucune fermeture prévue.</p>'}
    </section></div>`;
}

function closureLabel(c) {
  const from = c.starts_at, to = c.ends_at;
  const local = iso => safe(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)), iso);
  const [fd, ft] = local(from).split(' '), [td, tt] = local(to).split(' ');
  if (ft === '00:00' && tt === '00:00') {
    const last = addDays(td, -1);
    return last === fd ? capitalize(dayLabel(fd)) : `Du ${dayLabel(fd, { day: 'numeric', month: 'long' })} au ${dayLabel(last, { day: 'numeric', month: 'long' })}`;
  }
  return `${capitalize(dayLabel(fd))}, ${hm(from)} – ${fd === td ? hm(to) : `${dayLabel(td, { day: 'numeric', month: 'short' })} ${hm(to)}`}`;
}

function reservation(ctx) {
  const p = ctx.store.state.profile || {};
  const option = (list, value) => list.map(([v, label]) => `<option value="${v}" ${Number(value) === v ? 'selected' : ''}>${label}</option>`).join('');
  return `<form class="card form" data-reservation novalidate>
    <h2 class="card-title">Validation des demandes</h2>
    <div class="choice-grid choice-grid-2">
      <label class="choice-card"><input type="radio" name="auto_confirm" value="false" ${p.auto_confirm ? '' : 'checked'}><span class="choice-body">${icon('inbox', { className: 'icon-lg' })}<strong>Je valide chaque demande</strong><small>Le créneau est bloqué 24 h au maximum en attendant votre réponse.</small></span></label>
      <label class="choice-card"><input type="radio" name="auto_confirm" value="true" ${p.auto_confirm ? 'checked' : ''}><span class="choice-body">${icon('check', { className: 'icon-lg' })}<strong>Confirmation automatique</strong><small>Les clientes reçoivent directement la confirmation à l’écran.</small></span></label>
    </div>
    <h2 class="card-title">Créneaux proposés</h2>
    <div class="field-row field-row-3">
      <label class="field"><span class="label-text">Délai minimum avant un RDV</span><select name="min_notice_min">${option(NOTICE, p.min_notice_min ?? 720)}</select></label>
      <label class="field"><span class="label-text">Réservation jusqu’à</span><select name="max_horizon_days">${option(HORIZON, p.max_horizon_days ?? 60)}</select></label>
      <label class="field"><span class="label-text">Créneaux toutes les</span><select name="slot_step_min">${SLOT_STEPS.map(v => `<option value="${v}" ${Number(p.slot_step_min ?? 30) === v ? 'selected' : ''}>${v} min</option>`).join('')}</select></label>
    </div>
    <h2 class="card-title">Modèles de messages</h2>
    <p class="muted">Variables disponibles : <code>{prenom}</code> <code>{date}</code> <code>{heure}</code> <code>{prestation}</code> <code>{adresse}</code> <code>{lien}</code>. Laissez vide pour utiliser le modèle NailPilot.</p>
    ${Object.entries(TEMPLATE_LABELS).map(([k, label]) => `<label class="field"><span class="label-text">${label}</span><textarea name="template_${k}" rows="3" maxlength="1000" placeholder="${e(DEFAULT_TEMPLATES[k] || '')}">${e(p[`template_${k}`] || '')}</textarea></label>`).join('')}
    <p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><span></span><button type="submit" class="btn btn-primary">Enregistrer</button></div>
  </form>`;
}

function compte(ctx) {
  const { store } = ctx;
  const p = store.state.profile || {};
  return `<div class="settings-grid">
    <section class="card"><h2 class="card-title">Mon compte</h2>
      <dl class="detail-list"><div><dt>E-mail</dt><dd>${e(store.user?.email || '—')}</dd></div><div><dt>Mode</dt><dd>${store.mode === 'demo' ? 'Démonstration (données locales)' : 'Compte en ligne'}</dd></div></dl>
      <div class="button-row"><button type="button" class="btn btn-secondary btn-sm" data-password>Changer mon mot de passe</button><button type="button" class="btn btn-ghost btn-sm" data-logout-inline>${icon('logout')}Se déconnecter</button></div>
      <button type="button" class="btn btn-ghost btn-sm" data-restart-onboarding>${icon('refresh')}Relancer l’assistant de démarrage</button>
    </section>
    <section class="card"><h2 class="card-title">${icon('shield')}Mes données</h2>
      <p class="muted">Vous êtes responsable du traitement des données de vos clientes. Complétez votre identité dans les <a href="#/mentions-legales">mentions légales</a> et la <a href="#/confidentialite">politique de confidentialité</a>.</p>
      <div class="button-row"><button type="button" class="btn btn-secondary btn-sm" data-export-account>${icon('download')}Exporter toutes mes données (JSON)</button></div>
    </section>
    <section class="card danger-zone"><h2 class="card-title">Supprimer mon compte</h2>
      ${p.deletion_requested_at ? `<p class="callout callout-warn">${icon('alert')}<span>Suppression demandée le ${e(dayLabel(p.deletion_requested_at.slice(0, 10)))}. Votre page est hors ligne ; l’effacement intervient sous 30 jours.</span></p>`
      : `<p class="muted">Votre page sera immédiatement dépubliée, puis toutes vos données effacées sous 30 jours.</p><button type="button" class="btn btn-danger btn-sm" data-delete-account>${icon('trash')}Demander la suppression</button>`}
    </section></div>`;
}

function showError(form, error) {
  const box = form.querySelector('.form-error');
  box.textContent = error.message; box.hidden = false;
}

export function bind(root, ctx) {
  const { store } = ctx;
  if (!ctx.route.params.tab) { ctx.navigate('reglages/profil', { replace: true }); return; }
  root.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
    const ok = await copyText(bookingUrl(store.state.publicProfile.slug));
    ctx.notice(ok ? 'Lien copié : collez-le dans votre bio Instagram.' : 'Copie impossible.', { error: !ok });
  });
  root.querySelector('[data-published]')?.addEventListener('change', async event => {
    try { await store.setPublished(event.target.checked); ctx.notice(event.target.checked ? 'Votre page est en ligne.' : 'Votre page est hors ligne.'); }
    catch (error) { event.target.checked = !event.target.checked; ctx.noticeError(error); }
  });
  const bio = root.querySelector('[data-counter]');
  bio?.addEventListener('input', () => { root.querySelector('[data-count]').textContent = `${bio.value.length}/300`; });

  const profileForm = root.querySelector('[data-profile]');
  profileForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const v = formValues(profileForm);
    const submit = profileForm.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const slug = v.slug.toLowerCase();
      if (!isValidSlug(slug)) throw new Error('L’adresse de la page doit contenir 3 à 40 caractères : lettres minuscules, chiffres et tirets.');
      if (slug !== store.state.publicProfile?.slug && !(await store.isSlugAvailable(slug))) throw new Error('Cette adresse de page est déjà prise.');
      await store.saveProfile({
        ...fullProfile(store), display_name: v.display_name, city: v.city, slug, bio: v.bio, instagram: v.instagram.replace(/^@/, ''),
        trades: [...profileForm.querySelectorAll('[name=trades]:checked')].map(i => i.value), work_mode: v.work_mode,
        ...Object.fromEntries(Object.entries(pickAddress(v, 'base_')).map(([k, val]) => [`base_${k}`, val])),
        zone_postal_codes: v.zone_postal_codes.split(/[\s,;]+/).filter(Boolean), zone_radius_km: v.zone_radius_km === '' ? null : Number(v.zone_radius_km),
        travel_buffer_min: Number(v.travel_buffer_min || 0)
      });
      ctx.notice('Profil enregistré.');
    } catch (error) { showError(profileForm, error); }
    finally { submit.disabled = false; }
  });

  const hoursForm = root.querySelector('[data-hours]');
  if (hoursForm) {
    const refresh = day => {
      const count = day.querySelectorAll('.range-row').length;
      day.querySelector('[data-add-range]').hidden = count === 0 || count >= 3;
    };
    const bindRow = row => row.querySelector('[data-remove-range]').addEventListener('click', () => {
      const day = row.closest('.hours-day');
      row.remove();
      if (!day.querySelector('.range-row')) { day.querySelector('[data-open]').checked = false; day.querySelector('[data-ranges]').innerHTML = '<span class="muted" data-closed-label>Fermé</span>'; }
      refresh(day);
    });
    hoursForm.querySelectorAll('.range-row').forEach(bindRow);
    hoursForm.querySelectorAll('.hours-day').forEach(day => {
      day.querySelector('[data-open]').addEventListener('change', event => {
        const box = day.querySelector('[data-ranges]');
        box.innerHTML = event.target.checked ? rangeRow() : '<span class="muted" data-closed-label>Fermé</span>';
        box.querySelectorAll('.range-row').forEach(bindRow);
        refresh(day);
      });
      day.querySelector('[data-add-range]').addEventListener('click', () => {
        const box = day.querySelector('[data-ranges]');
        const last = [...box.querySelectorAll('[data-end]')].at(-1)?.value || '12:00';
        const start = Math.min(toMin(last) + 60, 1380);
        box.insertAdjacentHTML('beforeend', rangeRow(start, Math.min(start + 180, 1435)));
        bindRow(box.lastElementChild); refresh(day);
        box.lastElementChild.querySelector('input').focus();
      });
    });
    hoursForm.addEventListener('submit', async event => {
      event.preventDefault();
      const rows = [...hoursForm.querySelectorAll('.hours-day')].flatMap(day => [...day.querySelectorAll('.range-row')].map(r => ({
        weekday: Number(day.dataset.weekday), start_min: toMin(r.querySelector('[data-start]').value), end_min: toMin(r.querySelector('[data-end]').value)
      })));
      try { await store.saveOpeningHours(rows); ctx.notice('Horaires enregistrés.'); } catch (error) { showError(hoursForm, error); }
    });
  }
  root.querySelector('[data-add-closure]')?.addEventListener('click', () => closureDialog(ctx));
  root.querySelectorAll('[data-delete-closure]').forEach(b => b.addEventListener('click', async () => {
    try { await store.deleteClosure(b.dataset.deleteClosure); ctx.notice('Fermeture supprimée.'); } catch (error) { ctx.noticeError(error); }
  }));

  const resForm = root.querySelector('[data-reservation]');
  resForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const v = formValues(resForm);
    try {
      await store.saveProfile({ ...fullProfile(store), auto_confirm: v.auto_confirm === 'true', min_notice_min: Number(v.min_notice_min), max_horizon_days: Number(v.max_horizon_days), slot_step_min: Number(v.slot_step_min),
        template_confirmation: v.template_confirmation, template_decline: v.template_decline, template_reminder: v.template_reminder, template_refill: v.template_refill });
      ctx.notice('Réglages de réservation enregistrés.');
    } catch (error) { showError(resForm, error); }
  });

  root.querySelector('[data-password]')?.addEventListener('click', () => openDialog({
    title: 'Nouveau mot de passe', body: '<label class="field"><span class="label-text">Nouveau mot de passe</span><input name="password" type="password" minlength="8" required autocomplete="new-password"><small class="hint">8 caractères minimum.</small></label>',
    onSubmit: async values => { await store.updatePassword(values.password); ctx.notice('Mot de passe mis à jour.'); }
  }));
  root.querySelector('[data-logout-inline]')?.addEventListener('click', async () => { try { await store.logout(); ctx.navigate('connexion'); } catch (error) { ctx.noticeError(error); } });
  root.querySelector('[data-restart-onboarding]')?.addEventListener('click', () => ctx.navigate('bienvenue'));
  root.querySelector('[data-export-account]')?.addEventListener('click', async () => {
    try { const data = await store.exportAccount(); download(`nailpilot-export-${today()}.json`, JSON.stringify(data, null, 2)); ctx.notice('Export téléchargé.'); }
    catch (error) { ctx.noticeError(error); }
  });
  root.querySelector('[data-delete-account]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Supprimer votre compte ?', message: 'Votre page de réservation sera dépubliée immédiatement et toutes vos données (clientes, rendez-vous, prestations) effacées sous 30 jours. Pensez à exporter vos données avant.', confirmLabel: 'Supprimer mon compte', danger: true }))) return;
    try { await store.requestAccountDeletion(); ctx.notice('Demande de suppression enregistrée.'); } catch (error) { ctx.noticeError(error); }
  });
}

function closureDialog(ctx) {
  const t = today();
  openDialog({
    title: 'Nouvelle fermeture', eyebrow: 'Horaires',
    body: `<div class="form form-dialog">
      <div class="field-row"><label class="field"><span class="label-text">Du</span><input name="from_day" type="date" value="${t}" required></label>
        <label class="field"><span class="label-text">Au</span><input name="to_day" type="date" value="${t}" required></label></div>
      <label class="check"><input type="checkbox" name="all_day" checked data-all-day><span>Journée(s) entière(s)</span></label>
      <div class="field-row" data-times hidden><label class="field"><span class="label-text">De</span><input name="from_time" type="time" step="300" value="12:00"></label>
        <label class="field"><span class="label-text">À</span><input name="to_time" type="time" step="300" value="14:00"></label></div>
      <label class="field"><span class="label-text">Motif (privé)</span><input name="reason" maxlength="120" placeholder="Congés, formation…"></label></div>`,
    onBind: dialog => dialog.querySelector('[data-all-day]').addEventListener('change', event => { dialog.querySelector('[data-times]').hidden = event.target.checked; }),
    onSubmit: async (v, form) => {
      const allDay = form.querySelector('[data-all-day]').checked;
      if (v.to_day < v.from_day) throw new Error('La date de fin doit suivre la date de début.');
      const input = allDay ? { from: `${v.from_day}T00:00`, to: `${addDays(v.to_day, 1)}T00:00`, reason: v.reason }
        : { from: `${v.from_day}T${v.from_time}`, to: `${v.to_day}T${v.to_time}`, reason: v.reason };
      await ctx.store.saveClosure(input);
      ctx.notice('Fermeture ajoutée.');
    }
  });
}
