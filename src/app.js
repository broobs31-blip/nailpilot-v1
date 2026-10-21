import './style.css';
import { createStore, configured } from './store.js';
import { escapeHtml as e, SERVICES, STATUSES, parisLocal, fromParisLocal, formatDate } from './domain.js';

const store = createStore();
const app = document.querySelector('#app');
const tabs = { agenda: ['◷', 'Agenda'], clients: ['♧', 'Clientes'], reminders: ['◇', 'Rappels'], refills: ['↻', 'Remplissages'] };
let view = 'agenda', selectedDay = parisLocal().slice(0, 10), search = '', showHistory = false, loading = true;
let dialogContext = null, busy = false;
const name = id => store.state.clients.find(c => c.id === id)?.name || 'Cliente archivée';
const active = () => store.state.clients.filter(c => !c.archived);
function ready(kind) { return store.state.notifications.filter(n => n.kind === kind && n.status === 'ready'); }
function notice(message, error = false) {
  const element = document.querySelector('#notice');
  element.textContent = message; element.className = `notice ${error ? 'error' : ''}`; element.hidden = false;
}
function empty(title, detail) { return `<div class="empty"><span aria-hidden="true">✧</span><h3>${title}</h3><p>${detail}</p></div>`; }

function render() {
  const loggedIn = !configured || Boolean(store.user);
  app.innerHTML = `<div class="layout"><aside class="sidebar"><a class="brand" href="#agenda" aria-label="NailPilot, agenda"><span class="brand-mark">n.</span><span>NailPilot<small>VOTRE ASSISTANT QUOTIDIEN</small></span></a><div class="workspace"><span class="avatar">N</span><div>Mon studio<small>Indépendante · V1</small></div></div><p class="nav-label">MON ORGANISATION</p><nav aria-label="Navigation principale">${Object.entries(tabs).map(([key, [icon, label]]) => `<button data-view="${key}" class="nav-item ${view === key ? 'selected' : ''}" ${!loggedIn ? 'disabled' : ''} ${view === key ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}${key === 'reminders' && ready('reminder').length ? `<b>${ready('reminder').length}</b>` : ''}${key === 'refills' && ready('refill').length ? `<b>${ready('refill').length}</b>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><span class="status-dot"></span>${configured ? 'Supabase configuré' : 'Espace de démonstration'}<small>Un peu moins de gestion.<br>Un peu plus de temps pour vous.</small>${store.user ? '<button class="text-button" id="logout">Se déconnecter</button>' : ''}</div></aside><main><div class="topline"><span>MON STUDIO / ${tabs[view][1].toUpperCase()}</span><span>${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}</span></div><div class="banner">${configured ? 'Prévisualisation NailPilot · données du projet dédié.' : 'Démonstration locale · exemples fictifs · aucune connexion Supabase ni aucun envoi de message. N’ajoutez pas de données réelles.'}</div><div id="notice" class="notice" role="status" aria-live="polite" hidden></div>${loading ? '<p class="loading">Chargement de votre espace…</p>' : !loggedIn ? loginView() : content()}</main></div><dialog id="editor" aria-labelledby="dialog-title"></dialog>`;
  app.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; search = ''; showHistory = false; history.replaceState(null, '', `#${view}`); render(); }));
  app.querySelector('#logout')?.addEventListener('click', async () => { try { await store.logout(); render(); } catch (error) { notice(error.message, true); } });
  bindView();
}

function loginView() {
  return `<section class="login card"><p class="eyebrow">BIENVENUE DANS VOTRE STUDIO</p><h1>Ravie de vous retrouver.</h1><p>Connectez-vous pour retrouver vos clientes et votre agenda.</p><form id="login"><label>E-mail<input name="email" type="email" autocomplete="username" required></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Se connecter</button></form><p class="muted">Accès sur invitation : le compte est créé dans le projet Supabase NailPilot.</p></section>`;
}

function content() {
  if (view === 'clients') return clientsView();
  if (view === 'reminders' || view === 'refills') return notificationsView(view === 'reminders' ? 'reminder' : 'refill');
  return agendaView();
}
function heading(eyebrow, title, description, action = '') { return `<header class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>${action}</header>`; }

function agendaView() {
  const appointments = store.state.appointments.filter(a => parisLocal(a.starts_at).slice(0, 10) === selectedDay).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const booked = appointments.filter(a => a.status === 'booked');
  return `${heading('UNE JOURNÉE BIEN ORGANISÉE', 'Votre agenda, l’esprit léger.', 'Tous vos rendez-vous, au même endroit.', '<button class="primary" id="new-appointment">+ Nouveau rendez-vous</button>')}<section class="stats" aria-label="Vue d’ensemble"><article class="stat"><span>Rendez-vous du jour choisi</span><strong>${booked.length.toString().padStart(2, '0')}</strong><small>confirmé${booked.length > 1 ? 's' : ''}</small></article><article class="stat"><span>Votre carnet de clientes</span><strong>${active().length.toString().padStart(2, '0')}</strong><small>fiches actives</small></article><article class="stat accent"><span>Remplissages à proposer</span><strong>${ready('refill').length.toString().padStart(2, '0')}</strong><small>relances à traiter</small></article></section><section class="card"><div class="section-toolbar"><div><p class="eyebrow">LE PROGRAMME</p><h2>${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${selectedDay}T12:00:00Z`))}</h2></div><div class="date-controls"><button id="previous-day" class="icon-button" aria-label="Jour précédent">←</button><label class="sr-only" for="agenda-date">Date de l’agenda</label><input id="agenda-date" type="date" value="${selectedDay}" required><button id="next-day" class="icon-button" aria-label="Jour suivant">→</button><button class="secondary" id="today">Aujourd’hui</button></div></div>${appointments.length ? `<div class="appointments">${appointments.map(a => `<button class="appointment ${a.status}" data-appointment="${e(a.id)}"><span class="time">${formatDate(a.starts_at, { day: undefined, month: undefined })}<small>${Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60000)} min</small></span><span class="appointment-content"><strong>${e(name(a.client_id))}</strong><span>${e(a.service)}</span></span><span class="badge ${a.status}">${STATUSES[a.status]}</span><span aria-hidden="true">↗</span></button>`).join('')}</div>` : empty('Du temps pour vous.', 'Aucun rendez-vous ce jour-là. Ajoutez votre prochain créneau.')}<div class="card-footer">Heures de Paris · cliquez sur un rendez-vous pour le modifier ou changer son statut.</div></section><div class="tip"><span aria-hidden="true">✧</span><p><strong>Une petite attention fait la différence.</strong><br>Retrouvez les rappels à préparer 24 h avant chaque rendez-vous dans l’onglet Rappels.</p></div>`;
}

function clientsView() {
  const clients = active().filter(c => `${c.name} ${c.phone} ${c.email}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return `${heading('DES RELATIONS QUI DURENT', 'Vos clientes, bien accompagnées.', 'Coordonnées, préférences et historique des rendez-vous.', '<button class="primary" id="new-client">+ Nouvelle cliente</button>')}<section class="card"><div class="section-toolbar"><h2>Votre carnet <span class="count">${clients.length}</span></h2><label class="search"><span class="sr-only">Rechercher une cliente</span><input type="search" id="client-search" placeholder="Nom, téléphone ou e-mail…" value="${e(search)}"></label></div><div id="client-results">${clients.length ? `<div class="client-grid">${clients.map(c => `<button class="client-card" data-client="${e(c.id)}"><span class="avatar">${e(c.name[0].toUpperCase())}</span><strong>${e(c.name)}</strong><span>${e(c.phone || 'Téléphone non renseigné')}</span><small>Remplissage : ${c.refill_days} jours</small><span class="client-link">Ouvrir la fiche ↗</span></button>`).join('')}</div>` : empty('Votre carnet commence ici.', search ? 'Aucune cliente ne correspond à votre recherche.' : 'Ajoutez votre première cliente pour planifier un rendez-vous.')}</div></section>`;
}

function notificationsView(kind) {
  const isReminder = kind === 'reminder';
  const rows = store.state.notifications.filter(n => n.kind === kind && (showHistory ? n.status === 'dismissed' : n.status === 'ready')).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  return `${heading(isReminder ? 'LE BON MESSAGE, AU BON MOMENT' : 'FAITES VIVRE VOTRE CARNET', isReminder ? 'N’oublier aucun rendez-vous.' : 'Le prochain rendez-vous se prépare.', isReminder ? 'Rappels préparés 24 heures avant le rendez-vous, avec l’accord de la cliente.' : 'Relances après la dernière prestation terminée, selon le délai de chaque cliente.')}<div class="info-panel"><strong>Messages préparés · aucun envoi automatique</strong><p>Les suggestions apparaissent automatiquement ici. Vous pouvez copier un message et contacter la cliente vous-même. Aucun SMS ou e-mail n’est envoyé par NailPilot.</p></div><section class="card"><div class="section-toolbar"><h2>${showHistory ? 'Traités' : 'À traiter'} <span class="count">${rows.length}</span></h2><div class="toggle"><button class="${!showHistory ? 'active' : ''}" id="show-ready">À traiter</button><button class="${showHistory ? 'active' : ''}" id="show-history">Traités</button></div></div>${rows.length ? rows.map(n => `<article class="notification"><div><span class="badge">${isReminder ? 'Rappel' : 'Remplissage'}</span><h3>${e(name(n.client_id))}</h3><small>À partir du ${formatDate(n.due_at)}</small><p class="message">${e(n.message || messageFor(n))}</p></div><div class="notification-actions"><button class="secondary" data-copy="${e(n.id)}">Copier le message</button>${!showHistory ? `<button class="primary" data-dismiss="${e(n.id)}">Marquer comme traité</button>` : '<span class="muted">Traité manuellement</span>'}</div></article>`).join('') : empty(showHistory ? 'Aucun message traité.' : 'Tout est à jour.', isReminder ? 'Les rendez-vous à venir dans les 24 h apparaîtront ici si les rappels sont autorisés.' : 'Les clientes ayant autorisé les relances apparaîtront ici à l’échéance, si aucun rendez-vous à venir n’est prévu.')}<div class="card-footer">Actualisation chaque minute quand l’application est ouverte. La planification serveur reste à activer sur la base dédiée.</div></section>`;
}
function messageFor(n) {
  if (n.kind === 'refill') return `Bonjour ${name(n.client_id)}, c’est le moment de prévoir votre remplissage. Contactez-moi pour choisir votre prochain créneau !`;
  const a = store.state.appointments.find(a => a.id === n.appointment_id);
  return a ? `Bonjour ${name(n.client_id)}, rappel de votre rendez-vous ${a.service.toLowerCase()} le ${formatDate(a.starts_at)}. À bientôt !` : '';
}

function bindView() {
  app.querySelector('#login')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form); const submit = form.querySelector('button');
    submit.disabled = true;
    try { await store.login(data.get('email'), data.get('password')); render(); } catch { notice('Connexion impossible. Vérifiez vos identifiants et la configuration du projet.', true); submit.disabled = false; }
  });
  app.querySelector('#new-client')?.addEventListener('click', () => clientEditor());
  app.querySelectorAll('[data-client]').forEach(el => el.addEventListener('click', () => clientEditor(el.dataset.client)));
  app.querySelector('#new-appointment')?.addEventListener('click', () => active().length ? appointmentEditor() : notice('Ajoutez d’abord une cliente dans l’onglet Clientes.', true));
  app.querySelectorAll('[data-appointment]').forEach(el => el.addEventListener('click', () => appointmentEditor(el.dataset.appointment)));
  app.querySelector('#client-search')?.addEventListener('input', event => {
    search = event.target.value; const position = event.target.selectionStart; render(); const input = app.querySelector('#client-search'); input.focus(); input.setSelectionRange(position, position);
  });
  app.querySelector('#agenda-date')?.addEventListener('change', event => { if (event.target.value) { selectedDay = event.target.value; render(); } });
  function shift(days) { const day = new Date(`${selectedDay}T12:00Z`); day.setUTCDate(day.getUTCDate() + days); selectedDay = day.toISOString().slice(0, 10); render(); }
  app.querySelector('#previous-day')?.addEventListener('click', () => shift(-1));
  app.querySelector('#next-day')?.addEventListener('click', () => shift(1));
  app.querySelector('#today')?.addEventListener('click', () => { selectedDay = parisLocal().slice(0, 10); render(); });
  app.querySelector('#show-ready')?.addEventListener('click', () => { showHistory = false; render(); });
  app.querySelector('#show-history')?.addEventListener('click', () => { showHistory = true; render(); });
  app.querySelectorAll('[data-copy]').forEach(el => el.addEventListener('click', async () => {
    const n = store.state.notifications.find(n => n.id === el.dataset.copy);
    try { await navigator.clipboard.writeText(n.message || messageFor(n)); notice('Message copié. Aucun envoi effectué.'); } catch { notice('Copie indisponible : sélectionnez le texte du message pour le copier.', true); }
  }));
  app.querySelectorAll('[data-dismiss]').forEach(el => el.addEventListener('click', async () => {
    el.disabled = true; try { await store.dismissNotification(el.dataset.dismiss); render(); notice('Message marqué comme traité.'); } catch (error) { notice(error.message, true); el.disabled = false; }
  }));
}

function openEditor(title, body, onSave) {
  const dialog = document.querySelector('#editor');
  dialog.innerHTML = `<form id="editor-form"><div class="dialog-header"><h2 id="dialog-title">${title}</h2><button type="button" class="icon-button" id="close-dialog" aria-label="Fermer">×</button></div>${body}<p id="form-error" class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="secondary" id="cancel-dialog">Annuler</button><button type="submit" class="primary">Enregistrer</button></div></form>`;
  const close = () => { if (!busy) { dialog.close(); dialogContext = null; } };
  dialog.querySelector('#close-dialog').addEventListener('click', close);
  dialog.querySelector('#cancel-dialog').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else dialogContext = null; }, { once: true });
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; busy = true;
    const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
    try { await onSave(new FormData(event.currentTarget)); busy = false; close(); render(); notice('Enregistrement effectué.'); }
    catch (error) { const output = dialog.querySelector('#form-error'); output.textContent = error.message; output.hidden = false; busy = false; submit.disabled = false; }
  });
  dialog.showModal();
}

function clientEditor(id) {
  const c = store.state.clients.find(c => c.id === id) || { refill_days: 21 };
  dialogContext = { type: 'client', id };
  const historyRows = store.state.appointments.filter(a => a.client_id === id).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  openEditor(id ? 'Fiche cliente' : 'Nouvelle cliente', `<div class="form-grid"><label class="full">Nom et prénom<input name="name" value="${e(c.name || '')}" maxlength="120" autocomplete="name" required></label><label>Téléphone<input name="phone" type="tel" value="${e(c.phone || '')}" autocomplete="tel"></label><label>E-mail<input name="email" type="email" value="${e(c.email || '')}" maxlength="254" autocomplete="email"></label><label>Délai de remplissage (jours)<input name="refill_days" type="number" min="7" max="90" value="${c.refill_days}" required></label><label class="full">Préférences et notes<textarea name="notes" maxlength="2000" rows="3" placeholder="Couleurs, forme préférée…">${e(c.notes || '')}</textarea><small>Évitez les informations médicales ou sensibles.</small></label><fieldset class="full"><legend>Accord de la cliente</legend><label class="checkbox"><input name="reminder_opt_in" type="checkbox" ${c.reminder_opt_in ? 'checked' : ''}> Autorise les rappels de rendez-vous</label><label class="checkbox"><input name="refill_opt_in" type="checkbox" ${c.refill_opt_in ? 'checked' : ''}> Autorise les relances de remplissage</label></fieldset></div>${id ? `<section class="history"><h3>Historique des rendez-vous</h3>${historyRows.length ? historyRows.map(a => `<p>${formatDate(a.starts_at)} · ${e(a.service)} <span class="badge ${a.status}">${STATUSES[a.status]}</span></p>`).join('') : '<p>Aucun rendez-vous.</p>'}<button type="button" id="client-appointment" class="secondary">+ Prendre rendez-vous</button> <button type="button" id="archive-client" class="text-button danger">Archiver cette cliente</button><p class="muted">L’archivage conserve l’historique et retire la cliente des listes actives.</p></section>` : ''}`, async data => store.saveClient({ ...Object.fromEntries(data), reminder_opt_in: data.has('reminder_opt_in'), refill_opt_in: data.has('refill_opt_in') }, id));
  document.querySelector('#client-appointment')?.addEventListener('click', () => { document.querySelector('#editor').close(); appointmentEditor(null, id); });
  document.querySelector('#archive-client')?.addEventListener('click', async () => {
    if (busy) return; busy = true;
    try { await store.archiveClient(id); document.querySelector('#editor').close(); dialogContext = null; render(); notice('Cliente archivée.'); }
    catch (error) { const output = document.querySelector('#form-error'); output.textContent = error.message; output.hidden = false; }
    finally { busy = false; }
  });
}

function appointmentEditor(id, clientId) {
  const a = store.state.appointments.find(a => a.id === id);
  dialogContext = { type: 'appointment', id };
  const editableClients = store.state.clients.filter(c => !c.archived || c.id === a?.client_id);
  openEditor(a ? 'Votre rendez-vous' : 'Nouveau rendez-vous', `<div class="form-grid"><label class="full">Cliente<select name="client_id" required><option value="">Choisir une cliente</option>${editableClients.map(c => `<option value="${e(c.id)}" ${c.id === (a?.client_id || clientId) ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select></label><label class="full">Prestation<select name="service">${SERVICES.map(s => `<option ${s === a?.service ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Début (heure de Paris)<input name="start_local" type="datetime-local" value="${a ? parisLocal(a.starts_at) : `${selectedDay}T09:00`}" required></label><label>Durée (minutes)<input name="duration" type="number" min="1" max="480" value="${a ? Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60000) : 60}" required></label><label class="full">Statut<select name="status">${Object.entries(STATUSES).map(([value, label]) => `<option value="${value}" ${a?.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><p class="muted">Les chevauchements sont bloqués. Un rendez-vous annulé libère le créneau.</p>`, async data => {
    const starts = fromParisLocal(data.get('start_local'));
    await store.saveAppointment({ id: a?.id, client_id: data.get('client_id'), service: data.get('service'), starts_at: starts, ends_at: new Date(Date.parse(starts) + Number(data.get('duration')) * 60000).toISOString(), status: data.get('status') });
    selectedDay = data.get('start_local').slice(0, 10);
  });
}

async function start() {
  if (Object.hasOwn(tabs, location.hash.slice(1))) view = location.hash.slice(1);
  render();
  try { await store.load(); loading = false; render(); }
  catch (error) { loading = false; render(); notice(`Chargement impossible : ${error.message}`, true); }
}
await start();
setInterval(async () => {
  if (busy || dialogContext || document.hidden || (configured && !store.user)) return;
  const focused = document.activeElement;
  if (focused?.tagName === 'INPUT') return;
  try { await store.load(); render(); } catch (error) { notice(`Actualisation impossible : ${error.message}`, true); }
}, 60000);
