/**
 * Everything the dashboard shows (rooms, guests, bookings, payments), read fresh from the sheet.
 */
import * as repo from '../sheets';
import type { Route } from './context';

export const dataRoutes: Record<string, Route> = {
  data: { method: 'GET', auth: 'user', run: () => repo.loadBundle() },
};
