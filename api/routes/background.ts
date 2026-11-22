/**
 * The website background (owner only): plain, the drawn hotel scene, or an uploaded photo / short video.
 */
import { HttpError, readBody } from '../lib/http';
import * as media from '../media/media';
import type { Route } from './context';

export const backgroundRoutes: Record<string, Route> = {
  'background-set': {
    method: 'POST',
    auth: 'owner',
    run: ({ req }) => {
      const kind = readBody(req).kind;
      if (kind !== 'none' && kind !== 'scene') throw new HttpError(400, 'Choose the plain theme or the hotel scene. Photos and videos are uploaded.');
      return { background: media.setSimpleBackground(kind) };
    },
  },
  'background-upload': {
    method: 'POST',
    auth: 'owner',
    run: async ({ req }) => {
      const q = req.query.kind;
      const kind = Array.isArray(q) ? q[0] : (q ?? '');
      return { background: await media.saveUpload(kind, req.raw ?? Buffer.alloc(0)) };
    },
  },
};
