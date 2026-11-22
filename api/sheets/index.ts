/**
 * Everything the server does with the Google Sheet. Every change follows the same pattern:
 *   1. read the sheet fresh, 2. check the business rules (shared/rules), 3. write only the cells that change.
 * Nothing is kept between requests, so edits made by hand in the sheet are always picked up.
 *
 *   access.ts    raw sheet access: reading ranges, writing cells, the write queue
 *   read.ts      turns sheet rows into rooms, guests, bookings, payments and staff
 *   bookings.ts  create / edit a booking, check in and out, take a payment
 *   rooms.ts     room status, add a room, add many rooms
 *   staff.ts     employees: sign-in checks, add and edit
 *   setup.ts     one-click setup of tabs and columns, and the Clay & Sand look
 *   health.ts    the connection check and the link to the sheet
 *   google.ts, schema.ts, style.ts   Google sign-in, tab and column definitions, the sheet's look
 */
export { createBooking, updateBooking, changeStage, collectPayment } from './bookings';
export { health, sheetUrl } from './health';
export { loadBundle } from './read';
export { addRoom, changeRoomStatus, generateRooms } from './rooms';
export { setupSheet } from './setup';
export { employeeStillValid, findActiveEmployee, forgetStaffCache, listStaff, saveStaff, verifyEmployee } from './staff';
