/**
 * Employees (owner only): the list, and adding or changing one.
 */
import { readBody } from '../lib/http';
import { parseStaffSave } from '../lib/input';
import * as repo from '../sheets';
import type { Route } from './context';

export const staffRoutes: Record<string, Route> = {
  'staff-list': { method: 'GET', auth: 'owner', run: async () => ({ staff: await repo.listStaff() }) },
  'staff-save': {
    method: 'POST',
    auth: 'owner',
    run: async ({ req, by }) => ({ staff: await repo.saveStaff(parseStaffSave(readBody(req)), by) }),
  },
};
