import { STATUSES } from '../domain.js';
import { e } from './format.js';

export function statusBadge(status, { expired = false } = {}) {
  const label = expired ? 'Expirée' : STATUSES[status] || status;
  return `<span class="badge badge-${e(expired ? 'expired' : status)}">${e(label)}</span>`;
}
