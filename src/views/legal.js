// F12 — politique de confidentialité et mentions légales (modèles à compléter par la pro).
import { HEALTH_WARNING } from '../domain.js';
import { e } from '../components/format.js';

export function render(ctx) {
  const pub = ctx.store.state?.publicProfile;
  const owner = pub?.display_name ? e(pub.display_name) : '[Nom commercial de la professionnelle]';
  if (ctx.route.name === 'mentions-legales') {
    return `<article class="page legal"><p class="eyebrow">Informations légales</p><h1>Mentions légales</h1>
      <p class="callout callout-info">Modèle à compléter par la professionnelle avant toute mise en ligne.</p>
      <h2>Éditrice de la page de réservation</h2><p>${owner} — [statut : micro-entreprise], SIRET [numéro], [adresse professionnelle ou domiciliation], [e-mail de contact].</p>
      <h2>Outil</h2><p>Page propulsée par NailPilot, outil de prise de rendez-vous pour professionnelles de la beauté. Hébergement de l’application : Vercel Inc. ; données : Supabase, région Union européenne.</p>
      <h2>Propriété intellectuelle</h2><p>Les textes et visuels publiés par la professionnelle restent sa propriété.</p>
      <p><a href="#/confidentialite">Politique de confidentialité</a></p></article>`;
  }
  return `<article class="page legal"><p class="eyebrow">Vos données</p><h1>Politique de confidentialité</h1>
    <p class="callout callout-info">Modèle à compléter par la professionnelle, responsable du traitement.</p>
    <h2>Responsable du traitement</h2><p>${owner}, joignable à [e-mail de contact].</p>
    <h2>Données collectées</h2><p>Lors d’une réservation : prénom, nom, téléphone, e-mail facultatif, adresse d’intervention si la prestation a lieu chez vous, message facultatif, prestation et créneau choisis. Aucune donnée de santé n’est demandée. ${e(HEALTH_WARNING)}</p>
    <h2>Finalités et bases légales</h2><ul><li>Gestion de votre rendez-vous : exécution de la demande de prestation.</li><li>Rappel la veille et relances (remplissage, entretien) : uniquement avec votre consentement, retirable à tout moment.</li><li>Prévention des abus de réservation : intérêt légitime (limitation du nombre de demandes).</li></ul>
    <h2>Durée de conservation</h2><p>3 ans après votre dernier rendez-vous, puis suppression ou anonymisation.</p>
    <h2>Destinataires</h2><p>La professionnelle uniquement. Sous-traitants techniques : Supabase (hébergement des données dans l’Union européenne), Vercel (hébergement de l’application). Aucune revente, aucune publicité.</p>
    <h2>Vos droits</h2><p>Accès, rectification, effacement, opposition, limitation, portabilité : contactez la professionnelle. Vous pouvez saisir la CNIL (cnil.fr).</p>
    <p><a href="#/mentions-legales">Mentions légales</a></p></article>`;
}
export function bind() {}
