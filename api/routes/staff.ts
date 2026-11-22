/**
 * Employees (owner only): the list, and adding or changing one.
 */
import { readBody } from '../lib/http';
import { parseStaffSave } from '../lib/input';
import * as repo from '../sheets';
import { audit, type Route } from './context';

export const staffRoutes: Record<string, Route> = {
  'staff-list': { method: 'GET', auth: 'owner', run: async () => ({ staff: await repo.listStaff() }) },
  'staff-save': {
    method: 'POST',
    auth: 'owner',
    run: async (ctx) => {
      const input = parseStaffSave(readBody(ctx.req));
      const staff = await repo.saveStaff(input, ctx.by);
      audit(ctx, 'staff-saved', `${input.username}${input.password ? ', new password' : ''}${input.active ? '' : ', switched off'}`);
      return { staff };
    },
  },
};
