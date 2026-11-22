/**
 * Every /api/<action> the server answers. One file per subject, each listing its actions with who may call them
 * (auth: none = anyone, user = signed in, owner = the owner only).
 */
import { backgroundRoutes } from './background';
import { bookingRoutes } from './bookings';
import type { Route } from './context';
import { dataRoutes } from './data';
import { roomRoutes } from './rooms';
import { sessionRoutes } from './session';
import { sheetRoutes } from './sheet';
import { staffRoutes } from './staff';

export const ROUTES: Record<string, Route> = {
  ...sessionRoutes,
  ...dataRoutes,
  ...bookingRoutes,
  ...roomRoutes,
  ...staffRoutes,
  ...sheetRoutes,
  ...backgroundRoutes,
};
