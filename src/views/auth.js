// F1 — connexion, inscription, mot de passe oublié et réinitialisation.
import { icon } from '../components/icons.js';
import { e, formValues } from '../components/format.js';

let sentTo = '';

const pitch = `<aside class="auth-pitch" aria-label="Pourquoi NailPilot">
  <p class="eyebrow eyebrow-light">Pour les pros beauté qui se déplacent</p>
  <p class="auth-quote">Votre lien en bio, vos trajets comptés, vos clientes rappelées.</p>
  <ul class="auth-benefits">
    <li>${icon('link')}<span>Une page de réservation à partager sur Instagram</span></li>
    <li>${icon('car')}<span>Les temps de trajet bloqués automatiquement</span></li>
    <li>${icon('message')}<span>Rappels et relances prêts à envoyer par WhatsApp ou SMS</span></li>
  </ul>
  <p class="auth-small">0 % de commission. Vos clientes restent les vôtres.</p>
</aside>`;

function password(name, label, autocomplete) {
  return `<label class="field"><span class="label-text">${label}</span>
    <span class="input-with-action"><input name="${name}" type="password" minlength="8" autocomplete="${autocomplete}" required aria-describedby="${name}-hint">
    <button type="button" class="input-action" data-toggle-password aria-label="Afficher le mot de passe" aria-pressed="false">${icon('eye')}</button></span>
    <small class="hint" id="${name}-hint">8 caractères minimum.</small></label>`;
}

export function render(ctx) {
  const { name } = ctx.route;
  const demo = ctx.store.mode === 'demo'
    ? `<p class="callout callout-info">${icon('info')}<span>Démonstration : n’importe quelle adresse e-mail et un mot de passe de 8 caractères suffisent. Rien ne quitte votre navigateur.</span></p>` : '';
  let card;
  if (name === 'inscription') {
    card = sentTo ? `<div class="auth-done">${icon('message', { className: 'icon-xl' })}<h1>Vérifiez votre boîte mail</h1>
        <p>Nous avons envoyé un lien de confirmation à <strong>${e(sentTo)}</strong>. Ouvrez-le pour accéder à votre agenda.</p>
        <a class="btn btn-secondary btn-block" href="#/connexion">J’ai confirmé, je me connecte</a></div>`
      : `<p class="eyebrow">Bienvenue</p><h1>Créez votre espace en 2 minutes</h1>
        <p class="lead">Sans carte bancaire. Vous pourrez partager votre page de réservation dès aujourd’hui.</p>${demo}
        <form class="form" data-form="signup" novalidate>
          <label class="field"><span class="label-text">E-mail professionnel</span><input name="email" type="email" autocomplete="email" required></label>
          ${password('password', 'Mot de passe', 'new-password')}
          <label class="check"><input type="checkbox" name="terms" required><span>J’ai lu la <a href="#/confidentialite">politique de confidentialité</a>.</span></label>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Créer mon compte</button>
        </form>
        <p class="auth-switch">Déjà inscrite ? <a href="#/connexion">Se connecter</a></p>`;
  } else if (name === 'mot-de-passe') {
    card = sentTo ? `<div class="auth-done">${icon('message', { className: 'icon-xl' })}<h1>C’est envoyé</h1>
        <p>Si un compte existe pour <strong>${e(sentTo)}</strong>, vous recevrez un lien pour choisir un nouveau mot de passe.</p>
        <a class="btn btn-secondary btn-block" href="#/connexion">Retour à la connexion</a></div>`
      : `<p class="eyebrow">Mot de passe oublié</p><h1>Pas de panique</h1>
        <p class="lead">Indiquez votre e-mail : nous vous envoyons un lien de réinitialisation.</p>
        <form class="form" data-form="reset" novalidate>
          <label class="field"><span class="label-text">E-mail</span><input name="email" type="email" autocomplete="email" required></label>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Recevoir le lien</button>
        </form><p class="auth-switch"><a href="#/connexion">Retour à la connexion</a></p>`;
  } else if (name === 'nouveau-mot-de-passe') {
    card = `<p class="eyebrow">Sécurité</p><h1>Choisissez un nouveau mot de passe</h1>
        <form class="form" data-form="update" novalidate>${password('password', 'Nouveau mot de passe', 'new-password')}
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Enregistrer</button></form>`;
  } else {
    card = `<p class="eyebrow">Ravie de vous revoir</p><h1>Connexion</h1>
        <p class="lead">Retrouvez votre journée, vos clientes et vos demandes.</p>${demo}
        <form class="form" data-form="login" novalidate>
          <label class="field"><span class="label-text">E-mail</span><input name="email" type="email" autocomplete="username" required></label>
          ${password('password', 'Mot de passe', 'current-password')}
          <p class="form-row-end"><a href="#/mot-de-passe">Mot de passe oublié ?</a></p>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Se connecter</button>
        </form>
        <p class="auth-switch">Nouvelle sur NailPilot ? <a href="#/inscription">Créer mon compte</a></p>`;
  }
  return `<div class="auth-split"><section class="auth-card">${card}</section>${pitch}</div>`;
}

export function bind(root, ctx) {
  const { store, navigate, notice } = ctx;
  root.querySelectorAll('[data-toggle-password]').forEach(button => button.addEventListener('click', () => {
    const input = button.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  }));
  const form = root.querySelector('[data-form]');
  if (!form) return;
  const error = form.querySelector('.form-error');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    if (!form.checkValidity()) {
      const invalid = form.querySelector(':invalid');
      error.textContent = invalid.type === 'checkbox' ? 'Merci de cocher la case pour continuer.' : invalid.type === 'email' ? 'Saisissez une adresse e-mail valide.' : invalid.type === 'password' || invalid.name === 'password' ? 'Le mot de passe doit contenir au moins 8 caractères.' : 'Vérifiez le formulaire.';
      error.hidden = false; invalid.focus(); return;
    }
    const values = formValues(form);
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    try {
      const kind = form.dataset.form;
      if (kind === 'login') {
        await store.login(values.email, values.password);
        navigate(store.needsOnboarding ? 'bienvenue' : 'aujourdhui');
      } else if (kind === 'signup') {
        const result = await store.signUp(values.email, values.password);
        if (result?.needsEmailConfirmation && !store.user) { sentTo = values.email; ctx.rerender(); }
        else navigate('bienvenue');
      } else if (kind === 'reset') {
        await store.requestPasswordReset(values.email);
        sentTo = values.email; ctx.rerender();
      } else if (kind === 'update') {
        await store.updatePassword(values.password);
        notice('Mot de passe mis à jour.');
        navigate('aujourdhui');
      }
    } catch (err) {
      error.textContent = err.message || 'Une erreur est survenue.';
      error.hidden = false;
    } finally { submit.disabled = false; submit.removeAttribute('aria-busy'); }
  });
  window.addEventListener('hashchange', () => { sentTo = ''; }, { once: true });
}
