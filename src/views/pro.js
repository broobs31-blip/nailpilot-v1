// Espace pro : shell (navigation, bannière démo), garde d'authentification et rendu des vues.
import { createStore } from '../store.js';
import { startRouter, navigate, PUBLIC_ROUTES, bookingUrl } from '../router.js';
import { icon } from '../components/icons.js';
import { e, initials, readyMessages } from '../components/format.js';
import { notice, noticeError } from '../components/notice.js';
import * as auth from './auth.js';
import * as onboarding from './onboarding.js';
import * as today from './today.js';
import * as agenda from './agenda.js';
import * as requests from './requests.js';
import * as clients from './clients.js';
import * as services from './services.js';
import * as messages from './messages.js';
import * as settings from './settings.js';
import * as legal from './legal.js';
import * as more from './more.js';
import { openAppointmentDialog } from './appointment-dialog.js';

const VIEWS = {
  connexion: auth, inscription: auth, 'mot-de-passe': auth, 'nouveau-mot-de-passe': auth,
  bienvenue: onboarding, aujourdhui: today, agenda, demandes: requests, clientes: clients, cliente: clients,
  prestations: services, messages, reglages: settings, confidentialite: legal, 'mentions-legales': legal, plus: more
};
const TITLES = {
  connexion: 'Connexion', inscription: 'Créer mon compte', 'mot-de-passe': 'Mot de passe oublié', 'nouveau-mot-de-passe': 'Nouveau mot de passe',
  bienvenue: 'Bienvenue', aujourdhui: 'Aujourd’hui', agenda: 'Agenda', demandes: 'Demandes', clientes: 'Clientes', cliente: 'Fiche cliente',
  prestations: 'Prestations', messages: 'Messages', reglages: 'Réglages', confidentialite: 'Confidentialité', 'mentions-legales': 'Mentions légales', plus: 'Plus', introuvable: 'Page introuvable'
};
const NAV = [
  { route: 'aujourdhui', href: 'aujourdhui', label: 'Aujourd’hui', icon: 'sun', mobile: true },
  { route: 'agenda', href: 'agenda', label: 'Agenda', icon: 'calendar', mobile: true },
  { route: 'demandes', href: 'demandes', label: 'Demandes', icon: 'inbox', mobile: true, badge: s => s.pendingCount },
  { route: 'clientes', href: 'clientes', label: 'Clientes', icon: 'users', mobile: true, also: ['cliente'] },
  { route: 'messages', href: 'messages/rappels', label: 'Rappels & relances', icon: 'message', badge: s => readyMessages(s) },
  { route: 'prestations', href: 'prestations', label: 'Prestations', icon: 'sparkle' },
  { route: 'reglages', href: 'reglages/profil', label: 'Réglages', icon: 'settings' }
];


export async function mount(root) {
  const store = createStore();
  let route = null, loading = true, lastRouteKey = '';
  const ctx = {
    store, navigate, notice, noticeError,
    get route() { return route; },
    rerender: () => render(false),
    openAppointment: (target) => openAppointmentDialog(ctx, target)
  };

  const loggedIn = () => Boolean(store.user);

  function guard(r) {
    if (r.path.startsWith('r/')) { location.assign(`/${r.path}`); return null; }
    if (!loggedIn() && !PUBLIC_ROUTES.has(r.name)) return 'connexion';
    if (loggedIn() && ['connexion', 'inscription', 'mot-de-passe'].includes(r.name)) return store.needsOnboarding ? 'bienvenue' : 'aujourdhui';
    if (loggedIn() && store.needsOnboarding && !['bienvenue', 'nouveau-mot-de-passe', 'confidentialite', 'mentions-legales'].includes(r.name)) return 'bienvenue';
    return null;
  }

  function shell(content) {
    const s = store.state;
    const pub = s.publicProfile;
    const bare = !loggedIn() || route.name === 'bienvenue';
    const navItem = (item, mobile = false) => {
      const active = item.route === route.name || item.also?.includes(route.name);
      const count = item.badge?.(store) || 0;
      return `<a class="${mobile ? 'tab' : 'nav-link'}${active ? ' is-active' : ''}" href="#/${item.href}"${active ? ' aria-current="page"' : ''}>
        ${icon(item.icon)}<span class="nav-text">${e(item.label)}</span>${count ? `<span class="count-badge" aria-label="${count} en attente">${count}</span>` : ''}</a>`;
    };
    const demo = store.mode === 'demo'
      ? `<div class="demo-banner" role="note">${icon('info')}<span><strong>Mode démonstration</strong> · données fictives enregistrées dans ce navigateur, aucun message envoyé.</span></div>` : '';
    if (bare) {
      return `${demo}<div class="bare-layout"><a class="brand brand-center" href="#/">${brand()}</a><main id="main" class="bare-main" tabindex="-1">${content}</main>
        <footer class="bare-footer"><a href="#/confidentialite">Confidentialité</a><span aria-hidden="true">·</span><a href="#/mentions-legales">Mentions légales</a></footer></div>`;
    }
    const name = pub?.display_name || 'Mon activité';
    const myPage = pub?.slug ? `<a class="sidebar-page" href="${e(bookingUrl(pub.slug))}" target="_blank" rel="noopener">${icon('eye')}<span>Voir ma page<small>${e(location.host)}/r/${e(pub.slug)}</small></span></a>` : '';
    return `<a class="skip-link" href="#main">Aller au contenu</a>${demo}
      <div class="app-layout">
        <aside class="sidebar" aria-label="Navigation principale">
          <a class="brand" href="#/aujourdhui">${brand()}</a>
          <div class="workspace"><span class="avatar">${e(initials(name))}</span><span><strong>${e(name)}</strong><small>${pub?.published ? '<span class="dot dot-on"></span>Page en ligne' : '<span class="dot"></span>Page non publiée'}</small></span></div>
          <nav class="nav">${NAV.map(item => navItem(item)).join('')}</nav>
          <div class="sidebar-foot">${myPage}<button type="button" class="nav-link nav-logout" data-logout>${icon('logout')}<span class="nav-text">Se déconnecter</span></button></div>
        </aside>
        <header class="topbar"><a class="brand brand-compact" href="#/aujourdhui" aria-label="NailPilot, aujourd’hui">${brandMark()}</a>
          <span class="topbar-title">${e(TITLES[route.name] || '')}</span>
          ${pub?.slug ? `<a class="icon-btn" href="${e(bookingUrl(pub.slug))}" target="_blank" rel="noopener" aria-label="Voir ma page de réservation">${icon('eye')}</a>` : ''}</header>
        <main id="main" class="main" tabindex="-1">${content}</main>
        <nav class="tabbar" aria-label="Navigation principale (mobile)">
          ${NAV.filter(i => i.mobile).map(i => navItem(i, true)).join('')}
          <a class="tab${['plus', 'prestations', 'messages', 'reglages'].includes(route.name) ? ' is-active' : ''}" href="#/plus"${route.name === 'plus' ? ' aria-current="page"' : ''}>${icon('menu')}<span class="nav-text">Plus</span>${readyMessages(store) ? `<span class="count-badge" aria-label="${readyMessages(store)} messages à préparer">${readyMessages(store)}</span>` : ''}</a>
        </nav>
      </div>`;
  }

  function render(routeChanged) {
    if (!route) return;
    const scroll = window.scrollY;
    if (loading) { root.innerHTML = `<div class="splash" role="status">${brandMark()}<p>Chargement de votre espace…</p></div>`; return; }
    const view = VIEWS[route.name];
    let content;
    try { content = view ? view.render(ctx) : notFound(); }
    catch (error) { console.error(error); content = errorPanel(error); }
    root.innerHTML = shell(content);
    document.title = `${TITLES[route.name] || 'NailPilot'} · NailPilot`;
    const main = root.querySelector('#main');
    try { view?.bind?.(main, ctx); } catch (error) { console.error(error); noticeError(error); }
    // Le routeur lit le hash : « #main » ouvrirait « Page introuvable ». On déplace donc le focus sans toucher à l'URL.
    root.querySelector('.skip-link')?.addEventListener('click', event => { event.preventDefault(); main.focus(); });
    root.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', async () => {
      try { await store.logout(); navigate('connexion'); notice('Vous êtes déconnectée. À bientôt !'); } catch (error) { noticeError(error); }
    }));
    if (routeChanged) {
      window.scrollTo(0, 0);
      (main.querySelector('h1') || main).setAttribute('tabindex', '-1');
      if (lastRouteKey) (main.querySelector('h1') || main).focus({ preventScroll: true });
    } else window.scrollTo(0, scroll);
  }

  store.subscribe(() => {
    if (loading || !route) return;
    const redirect = guard(route);
    if (redirect) navigate(redirect, { replace: true }); else render(false);
  });

  startRouter(r => {
    route = r;
    if (loading) { render(true); return; }
    const redirect = guard(r);
    if (redirect) { navigate(redirect, { replace: true }); return; }
    const key = `${r.name}:${r.path}`;
    const changed = key !== lastRouteKey;
    render(changed);
    lastRouteKey = key;
  });

  try { await store.load(); }
  catch (error) { noticeError(new Error(`Chargement impossible : ${error.message}`)); }
  loading = false;
  const redirect = guard(route);
  if (redirect) navigate(redirect, { replace: true }); else render(true);
  lastRouteKey = `${route.name}:${route.path}`;

  setInterval(async () => {
    if (document.hidden || document.querySelector('dialog[open]') || !loggedIn()) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    try { await store.load(); render(false); } catch { /* réseau : on réessaiera */ }
  }, 60000);
}

export function brandMark() { return '<span class="brand-mark" aria-hidden="true">n.</span>'; }
export function brand() { return `${brandMark()}<span class="brand-name">NailPilot<small>Beauté à domicile</small></span>`; }

function notFound() {
  return `<section class="empty-state page-pad"><h1>Page introuvable</h1><p>Ce lien ne mène nulle part.</p><a class="btn btn-primary" href="#/aujourdhui">Revenir à ma journée</a></section>`;
}
function errorPanel(error) {
  return `<section class="empty-state page-pad"><h1>Cet écran n’a pas pu s’afficher</h1><p>${e(error?.message || 'Erreur inconnue.')}</p><button type="button" class="btn btn-secondary" data-reload>Réessayer</button></section>`;
}
