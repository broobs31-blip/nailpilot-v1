// Routeur NailPilot : chemin /r/<slug> pour la page publique, hash pour l'espace pro.
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** @typedef {{ name: string, params: Record<string, string>, path: string }} Route */

/** Lit la page publique depuis le chemin (/r/slug) puis le hash (#/r/slug). */
export function publicSlug(loc = location) {
  const fromPath = loc.pathname.match(/^\/r\/([^/]+)\/?$/);
  const fromHash = loc.hash.match(/^#\/r\/([^/?]+)/);
  const slug = decodeURIComponent((fromPath || fromHash || [])[1] || '').toLowerCase();
  return fromPath || fromHash ? slug : null;
}

export const isValidSlug = slug => SLUG.test(slug) && !slug.includes('--');

const PATTERNS = [
  ['connexion', /^connexion$/], ['inscription', /^inscription$/], ['mot-de-passe', /^mot-de-passe$/],
  ['nouveau-mot-de-passe', /^nouveau-mot-de-passe$/],
  ['bienvenue', /^bienvenue$/], ['aujourdhui', /^aujourdhui$/],
  ['agenda', /^agenda\/(jour|semaine)\/(\d{4}-\d{2}-\d{2})$/, ['mode', 'day']],
  ['agenda', /^agenda$/],
  ['demandes', /^demandes$/],
  ['clientes', /^clientes$/], ['cliente', /^clientes\/([^/]+)$/, ['id']],
  ['prestations', /^prestations$/],
  ['messages', /^messages\/(rappels|relances)$/, ['tab']], ['messages', /^messages$/],
  ['reglages', /^reglages\/(profil|horaires|reservation|compte)$/, ['tab']], ['reglages', /^reglages$/],
  ['plus', /^plus$/],
  ['confidentialite', /^confidentialite$/], ['mentions-legales', /^mentions-legales$/]
];

/** @returns {Route} */
export function parseHash(hash = location.hash) {
  const path = hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');
  for (const [name, regex, keys = []] of PATTERNS) {
    const match = path.match(regex);
    if (match) return { name, path, params: Object.fromEntries(keys.map((key, i) => [key, decodeURIComponent(match[i + 1])])) };
  }
  return { name: path ? 'introuvable' : 'aujourdhui', path, params: {} };
}

export const PUBLIC_ROUTES = new Set(['connexion', 'inscription', 'mot-de-passe', 'nouveau-mot-de-passe', 'confidentialite', 'mentions-legales']);

export function navigate(path, { replace = false } = {}) {
  const target = `#/${path.replace(/^#?\/?/, '')}`;
  if (location.hash === target) { window.dispatchEvent(new HashChangeEvent('hashchange')); return; }
  if (replace) { history.replaceState(null, '', target); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else location.hash = target;
}

export function startRouter(onChange) {
  const handler = () => onChange(parseHash());
  window.addEventListener('hashchange', handler);
  handler();
  return () => window.removeEventListener('hashchange', handler);
}

export function bookingUrl(slug) {
  return `${location.origin}/r/${encodeURIComponent(slug)}`;
}
