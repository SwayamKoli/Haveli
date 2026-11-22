/**
 * Bookings: create, correct a mistake, move between stages (check in / out / cancel) and take a payment.
 */
import { readBody } from '../lib/http';
import { parseEditBooking, parseNewBooking, parsePayment, parseStageInput } from '../lib/input';
import * as repo from '../sheets';
import type { Route } from './context';

export const bookingRoutes: Record<string, Route> = {
  'booking-create': { method: 'POST', auth: 'user', run: ({ req, by }) => repo.createBooking(parseNewBooking(readBody(req)), by) },
  'booking-update': { method: 'POST', auth: 'user', run: ({ req, by }) => repo.updateBooking(parseEditBooking(readBody(req)), by) },
  'booking-stage': {
    method: 'POST',
    auth: 'user',
    run: ({ req, by }) => {
      const { id, to, restore } = parseStageInput(readBody(req));
      return repo.changeStage(id, to, restore, by);
    },
  },
  'booking-payment': {
    method: 'POST',
    auth: 'user',
    run: ({ req, by }) => {
      const { id, amount, method, note } = parsePayment(readBody(req));
      return repo.collectPayment(id, amount, method, note, by);
    },
  },
};
