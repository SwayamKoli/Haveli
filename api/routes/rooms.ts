/**
 * Rooms: change a room's status, add one room (everyone), add many rooms at once (owner).
 */
import { readBody } from '../lib/http';
import { parseNewRoom, parseRoomsGenerate, parseRoomStatus } from '../lib/input';
import * as repo from '../sheets';
import type { Route } from './context';

export const roomRoutes: Record<string, Route> = {
  'room-status': {
    method: 'POST',
    auth: 'user',
    run: ({ req }) => {
      const { no, status } = parseRoomStatus(readBody(req));
      return repo.changeRoomStatus(no, status);
    },
  },
  'room-create': { method: 'POST', auth: 'user', run: ({ req }) => repo.addRoom(parseNewRoom(readBody(req))) },
  'rooms-generate': { method: 'POST', auth: 'owner', run: ({ req }) => repo.generateRooms(parseRoomsGenerate(readBody(req))) },
};
