// Boîte de dialogue modale native (<dialog>) : piège de focus, Échap, retour du focus.
import { icon } from './icons.js';
import { e, formValues } from './format.js';

let counter = 0;

/**
 * @param {{ title: string, body: string, submitLabel?: string|null, cancelLabel?: string, danger?: boolean,
 *   wide?: boolean, eyebrow?: string, onSubmit?: (values: object, form: HTMLFormElement, api: object) => any,
 *   onBind?: (dialog: HTMLDialogElement, api: object) => void, onClose?: () => void, extraActions?: string }} options
 */
export function openDialog(options) {
  const { title, body, submitLabel = 'Enregistrer', cancelLabel = 'Annuler', danger = false, wide = false, eyebrow = '', onSubmit, onBind, onClose, extraActions = '' } = options;
  const id = `dlg-${++counter}`;
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = `dialog${wide ? ' dialog-wide' : ''}`;
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.innerHTML = `<form class="dialog-form" novalidate>
    <header class="dialog-header"><div>${eyebrow ? `<p class="eyebrow">${e(eyebrow)}</p>` : ''}<h2 id="${id}-title">${e(title)}</h2></div>
      <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button></header>
    <div class="dialog-body">${body}<p class="form-error" role="alert" hidden></p></div>
    ${submitLabel || cancelLabel ? `<footer class="dialog-footer">${extraActions}<span class="spacer"></span>
      ${cancelLabel ? `<button type="button" class="btn btn-ghost" data-close>${e(cancelLabel)}</button>` : ''}
      ${submitLabel ? `<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-submit>${e(submitLabel)}</button>` : ''}</footer>` : ''}
  </form>`;
  document.body.append(dialog);
  let busy = false, closed = false;
  const form = dialog.querySelector('form');
  const errorBox = dialog.querySelector('.form-error');
  const api = {
    dialog, form,
    close() {
      if (closed) return; closed = true;
      if (dialog.open) dialog.close();
      dialog.remove(); onClose?.();
      if (opener?.isConnected) opener.focus?.();
    },
    setError(message) { errorBox.textContent = message || ''; errorBox.hidden = !message; if (message) errorBox.scrollIntoView?.({ block: 'nearest' }); },
    get busy() { return busy; }
  };
  dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { if (!busy) api.close(); }));
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) api.close(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && !busy) api.close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !onSubmit) return;
    if (!form.checkValidity()) {
      const invalid = form.querySelector(':invalid');
      api.setError(invalid?.validationMessage ? `${labelOf(invalid)}${invalid.validationMessage}` : 'Vérifiez le formulaire.');
      invalid?.focus();
      return;
    }
    busy = true; api.setError('');
    const submit = event.submitter?.matches?.('[data-submit],[type=submit]') ? event.submitter : dialog.querySelector('[data-submit]');
    submit?.setAttribute('aria-busy', 'true'); if (submit) submit.disabled = true;
    try {
      const result = await onSubmit(formValues(form), form, api);
      busy = false;
      if (result !== false) api.close();
    } catch (error) {
      busy = false;
      api.setError(error?.message || 'Une erreur est survenue.');
    } finally {
      if (submit) { submit.disabled = false; submit.removeAttribute('aria-busy'); }
    }
  });
  onBind?.(dialog, api);
  dialog.showModal();
  const first = dialog.querySelector('[autofocus]') || dialog.querySelector('.dialog-body input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .dialog-body select, .dialog-body textarea');
  (first || dialog.querySelector('[data-close]')).focus();
  return api;
}

function labelOf(input) {
  const label = input.labels?.[0]?.querySelector('.label-text')?.textContent || input.labels?.[0]?.textContent || '';
  return label ? `${label.trim().split('\n')[0]} : ` : '';
}

/** Confirmation simple → Promise<boolean> */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    openDialog({
      title, body: `<p class="dialog-text">${e(message)}</p>`, submitLabel: confirmLabel, danger,
      onSubmit: () => { answered = true; resolve(true); },
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}
