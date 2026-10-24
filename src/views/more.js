// Menu « Plus » (mobile) : accès aux écrans secondaires.
import { icon } from '../components/icons.js';
import { e, readyMessages } from '../components/format.js';
import { bookingUrl } from '../router.js';

export function render(ctx) {
  const { store } = ctx;
  const pub = store.state.publicProfile;
  const n = readyMessages(store);
  const item = (href, ic, label, detail = '', extra = '') => `<li><a class="menu-row" href="${href}"${extra}>${icon(ic)}<span><strong>${label}</strong>${detail ? `<small>${detail}</small>` : ''}</span>${icon('chevronRight')}</a></li>`;
  return `<section class="page">
    <header class="page-head"><div><p class="eyebrow">Mon activité</p><h1>Plus</h1></div></header>
    <ul class="menu card">
      ${item('#/messages/rappels', 'message', `Rappels & relances${n ? ` <span class="count-badge">${n}</span>` : ''}`, 'Messages prêts à envoyer')}
      ${item('#/prestations', 'sparkle', 'Prestations', 'Durées, prix, ordre')}
      ${item('#/reglages/horaires', 'clock', 'Horaires & fermetures')}
      ${item('#/reglages/reservation', 'inbox', 'Réservation en ligne', 'Validation, délais, modèles')}
      ${item('#/reglages/profil', 'settings', 'Profil & page publique')}
      ${pub?.slug ? item(e(bookingUrl(pub.slug)), 'eye', 'Voir ma page', e(`/r/${pub.slug}`), ' target="_blank" rel="noopener"') : ''}
      ${item('#/reglages/compte', 'shield', 'Compte & données', 'Export, suppression')}
    </ul>
    <ul class="menu card">${item('#/confidentialite', 'info', 'Confidentialité')}${item('#/mentions-legales', 'info', 'Mentions légales')}</ul>
    <button type="button" class="btn btn-ghost btn-block" data-logout>${icon('logout')}Se déconnecter</button>
  </section>`;
}
export function bind() {}
