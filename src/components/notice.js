// Messages éphémères (toast) annoncés aux lecteurs d'écran.
let region;
function ensureRegion() {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.className = 'toasts';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  document.body.append(region);
  return region;
}

export function notice(message, { error = false, duration = 4500 } = {}) {
  const host = ensureRegion();
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' toast-error' : ''}`;
  toast.textContent = message;
  if (error) toast.setAttribute('role', 'alert');
  host.append(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => { toast.classList.remove('is-visible'); setTimeout(() => toast.remove(), 300); }, duration);
}

export const noticeError = error => notice(error?.message || String(error), { error: true, duration: 7000 });
