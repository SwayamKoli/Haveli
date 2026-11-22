/**
 * The website background (owner only): plain, the drawn hotel scene, or an uploaded photo / short video.
 */
import { HttpError, readBody } from '../lib/http';
import * as media from '../media/media';
import { audit, type Route } from './context';

export const backgroundRoutes: Record<string, Route> = {
  'background-set': {
    method: 'POST',
    auth: 'owner',
    run: (ctx) => {
      const kind = readBody(ctx.req).kind;
      if (kind !== 'none' && kind !== 'scene') throw new HttpError(400, 'Choose the plain theme or the hotel scene. Photos and videos are uploaded.');
      audit(ctx, 'background-changed', kind);
      return { background: media.setSimpleBackground(kind) };
    },
  },
  'background-upload': {
    method: 'POST',
    auth: 'owner',
    run: async (ctx) => {
      const q = ctx.req.query.kind;
      const kind = Array.isArray(q) ? q[0] : (q ?? '');
      const background = await media.saveUpload(kind, ctx.req.raw ?? Buffer.alloc(0));
      audit(ctx, 'background-changed', kind);
      return { background };
    },
  },
};
