// Message prêt à envoyer : modifiable, puis Copier / WhatsApp / SMS. Rien n'est envoyé par NailPilot.
import { smsLink, whatsappLink } from '../domain.js';
import { icon } from './icons.js';
import { e, copyText } from './format.js';
import { notice } from './notice.js';

let n = 0;
export function messageActions({ text, phone = '', label = 'Message', rows = 4 }) {
  const id = `msg-${++n}`;
  const links = phone ? `
      <a class="btn btn-whatsapp" data-wa target="_blank" rel="noopener noreferrer" href="${e(whatsappLink(phone, text))}">${icon('whatsapp')}WhatsApp</a>
      <a class="btn btn-secondary" data-sms href="${e(smsLink(phone, text))}">${icon('sms')}SMS</a>` : '';
  return `<div class="message-box" data-message-box data-phone="${e(phone)}">
    <label class="field"><span class="label-text">${e(label)}</span>
      <textarea id="${id}" rows="${rows}" data-message>${e(text)}</textarea></label>
    <div class="message-actions">
      <button type="button" class="btn btn-secondary" data-copy>${icon('copy')}Copier</button>${links}
    </div>
    ${phone ? '' : '<p class="hint">Pas de téléphone enregistré : copiez le message pour l’envoyer vous-même.</p>'}
  </div>`;
}

export function bindMessageActions(root) {
  root.querySelectorAll('[data-message-box]').forEach(box => {
    const area = box.querySelector('[data-message]');
    const phone = box.dataset.phone;
    area.addEventListener('input', () => {
      const wa = box.querySelector('[data-wa]'), sms = box.querySelector('[data-sms]');
      if (wa) wa.href = whatsappLink(phone, area.value);
      if (sms) sms.href = smsLink(phone, area.value);
    });
    box.querySelector('[data-copy]').addEventListener('click', async () => {
      const ok = await copyText(area.value);
      notice(ok ? 'Message copié. Collez-le dans votre messagerie : rien n’est envoyé automatiquement.' : 'Copie impossible : sélectionnez le texte pour le copier.', { error: !ok });
    });
  });
}
