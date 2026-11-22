/**
 * The website background the owner can choose (plain, scene, photo, video) and its limits.
 */
/** The picture or video behind the website. Only the owner can change it; everyone sees the same one. */
export type BackgroundKind = 'none' | 'scene' | 'image' | 'video';

export interface BackgroundInfo {
  kind: BackgroundKind;
  /** Where the file is served from (image and video only). Changes with every upload, so browsers never show a stale one. */
  url: string | null;
  /** Counts up with every change. */
  version: number;
}

export const NO_BACKGROUND: BackgroundInfo = { kind: 'none', url: null, version: 0 };

/** The limits for the background, shared by the server (which enforces them) and the settings screen (which checks first). */
export const BACKGROUND_LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  videoBytes: 20 * 1024 * 1024,
  videoSeconds: 15,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  videoTypes: ['video/mp4', 'video/webm'],
} as const;
