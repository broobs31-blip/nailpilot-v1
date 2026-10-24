// Champs d'adresse d'intervention (rue, CP, ville, infos d'accès).
import { e } from './format.js';

export function addressFields(values = {}, { prefix = '', required = true, legend = 'Adresse', accessLabel = 'Infos d’accès (digicode, étage, stationnement)' } = {}) {
  const req = required ? 'required' : '';
  return `<fieldset class="fieldset address-fields"><legend>${e(legend)}</legend>
    <label class="field field-full"><span class="label-text">Adresse</span>
      <input name="${prefix}address_line" value="${e(values.address_line || '')}" maxlength="200" autocomplete="street-address" ${req}></label>
    <div class="field-row">
      <label class="field field-cp"><span class="label-text">Code postal</span>
        <input name="${prefix}postal_code" value="${e(values.postal_code || '')}" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" autocomplete="postal-code" ${req}></label>
      <label class="field"><span class="label-text">Ville</span>
        <input name="${prefix}city" value="${e(values.city || '')}" maxlength="80" autocomplete="address-level2" ${req}></label>
    </div>
    <label class="field field-full"><span class="label-text">${e(accessLabel)}</span>
      <input name="${prefix}access_info" value="${e(values.access_info || '')}" maxlength="300"></label>
  </fieldset>`;
}

export const pickAddress = (values, prefix = '') => ({
  address_line: values[`${prefix}address_line`] || '',
  postal_code: values[`${prefix}postal_code`] || '',
  city: values[`${prefix}city`] || '',
  access_info: values[`${prefix}access_info`] || ''
});

export const addressText = a => [a?.address_line, [a?.postal_code, a?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
