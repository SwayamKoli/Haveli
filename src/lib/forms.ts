/**
 * Shared by the pop-up forms: which error clears which field, and moving focus to the first wrong field.
 */
import type { FieldErrors } from '../../shared/types';

/** Which error messages to clear when a form field changes. */
export const CLEARS: Record<string, string[]> = {
  name: ['name'], mobile: ['mob'], source: ['source'], ci: ['ci', 'out', 'room'], co: ['out', 'room'], rooms: ['room', 'people'],
  discount: ['discount'], discMode: ['discount'], advance: ['adv'], method: ['adv'], people: ['people', 'room'], eta: ['eta'],
  email: ['email'], city: ['city'], idType: ['idType', 'idLast4'], idLast4: ['idLast4'], notes: ['notes'],
};

export const FIELD_ID: Record<string, string> = {
  name: 'f_name', mob: 'f_mob', source: 'f_src', ci: 'f_in', out: 'f_out', room: 'f_rooms', discount: 'f_disc', adv: 'f_adv',
  people: 'f_people', eta: 'f_eta', email: 'f_email', city: 'f_city', idType: 'f_idt', idLast4: 'f_id4', notes: 'f_notes',
};

export function focusFirst(errors: FieldErrors, ids: Record<string, string>) {
  const key = Object.keys(errors)[0];
  if (key) document.getElementById(ids[key] ?? '')?.focus();
}
