// Point d'entrée : la page publique (/r/<slug>) et l'espace pro sont chargés à la demande,
// pour que les clientes ne téléchargent jamais le code de l'espace pro.
import './style.css';
import { publicSlug } from './router.js';

const root = document.querySelector('#app');
const slug = publicSlug();

function fatal(error) {
  root.innerHTML = `<main class="fatal"><h1>Oups, la page n’a pas pu s’afficher.</h1><p></p><a class="btn btn-primary" href="/">Revenir à l’accueil</a></main>`;
  root.querySelector('p').textContent = error?.message || 'Erreur inconnue.';
}

if (slug !== null) import('./public-booking.js').then(m => m.mount(root, slug)).catch(fatal);
else import('./views/pro.js').then(m => m.mount(root)).catch(fatal);
