/**
 * Business rules. The server uses these before it writes to the sheet, the website uses the same ones
 * to give instant feedback, and the demo mode uses them to behave exactly like the real thing.
 * format.ts (text, money, room lists) · rooms.ts (who is in a room, clashes) · validation.ts (booking and room forms)
 * stages.ts (check in / out / cancel, payments) · ids.ts (new ids)
 */
export * from './format';
export * from './ids';
export * from './rooms';
export * from './stages';
export * from './validation';
