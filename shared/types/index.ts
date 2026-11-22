/**
 * The shapes of the data the website and the server pass to each other. One file per subject:
 * booking.ts, rooms.ts, guests.ts, staff.ts, session.ts (sign-in, data bundle, health check), background.ts.
 */
export * from './background';
export * from './booking';
export * from './guests';
export * from './rooms';
export * from './session';
export * from './staff';
