/**
 * The website background (a photo or a short looping video), chosen by the owner.
 *
 * The file lives in a folder called "media" next to the app (set MEDIA_DIR to move it), not in the
 * Google Sheet. Back that folder up together with the .env file. Everything is checked here, on the
 * server, whatever the browser says: file type by its first bytes, size, and the length of a video.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BACKGROUND_LIMITS,
  NO_BACKGROUND,
  type BackgroundInfo,
  type BackgroundKind,
} from '../../shared/types';
import { HttpError } from '../lib/http';

export function mediaDir(): string {
  return resolve(process.env.MEDIA_DIR || join(process.cwd(), 'media'));
}

interface Meta {
  kind: BackgroundKind;
  file: string | null;
  version: number;
}

const META = 'background.json';
const NAME = /^bg-(\d+)\.(jpg|png|webp|mp4|webm)$/;

export const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** The media file name this request may read, or null. Nothing else in the folder is ever served. */
export function servedName(name: string): string | null {
  return NAME.test(name) ? name : null;
}

function readMeta(): Meta {
  try {
    const m = JSON.parse(readFileSync(join(mediaDir(), META), 'utf8')) as Partial<Meta>;
    const kind = m.kind === 'scene' || m.kind === 'image' || m.kind === 'video' ? m.kind : 'none';
    const version = Number.isInteger(m.version) && (m.version as number) >= 0 ? (m.version as number) : 0;
    const file = typeof m.file === 'string' && NAME.test(m.file) && existsSync(join(mediaDir(), m.file)) ? m.file : null;
    if ((kind === 'image' || kind === 'video') && !file) return { kind: 'none', file: null, version };
    return { kind, file: kind === 'image' || kind === 'video' ? file : null, version };
  } catch {
    return { kind: 'none', file: null, version: 0 };
  }
}

function writeMeta(m: Meta): void {
  mkdirSync(mediaDir(), { recursive: true });
  const tmp = join(mediaDir(), `${META}.tmp`);
  writeFileSync(tmp, JSON.stringify(m));
  renameSync(tmp, join(mediaDir(), META));
}

export function readBackground(): BackgroundInfo {
  const m = readMeta();
  if (m.kind === 'none' && m.version === 0) return { ...NO_BACKGROUND };
  return { kind: m.kind, url: m.file ? `/media/${m.file}` : null, version: m.version };
}

function dropFile(file: string | null): void {
  if (!file || !NAME.test(file)) return;
  try {
    unlinkSync(join(mediaDir(), file));
  } catch {
    /* already gone */
  }
}

/** Plain theme (none) or the drawn hotel scene. Removes any uploaded file. */
export function setSimpleBackground(kind: 'none' | 'scene'): BackgroundInfo {
  const old = readMeta();
  writeMeta({ kind, file: null, version: old.version + 1 });
  dropFile(old.file);
  return readBackground();
}

/* ---------- checking an upload ---------- */

type Sniffed = { type: 'jpg' | 'png' | 'webp' | 'mp4' | 'webm' } | null;

export function sniff(b: Buffer): Sniffed {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'png' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { type: 'webp' };
  if (b.toString('latin1', 4, 8) === 'ftyp') return { type: 'mp4' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'webm' };
  return null;
}

/** Length in seconds of an MP4 / MOV file, read from its "mvhd" box. Null when it cannot be read. */
export function mp4Seconds(b: Buffer): number | null {
  const find = (from: number, to: number, want: string): { start: number; end: number } | null => {
    let p = from;
    while (p + 8 <= to) {
      let size = b.readUInt32BE(p);
      const type = b.toString('latin1', p + 4, p + 8);
      let head = 8;
      if (size === 1) {
        if (p + 16 > to) return null;
        size = Number(b.readBigUInt64BE(p + 8));
        head = 16;
      } else if (size === 0) size = to - p;
      if (size < head || p + size > to) return null;
      if (type === want) return { start: p + head, end: p + size };
      p += size;
    }
    return null;
  };
  const moov = find(0, b.length, 'moov');
  if (!moov) return null;
  const mvhd = find(moov.start, moov.end, 'mvhd');
  if (!mvhd) return null;
  const v = b[mvhd.start];
  let scale: number;
  let dur: number;
  if (v === 1) {
    if (mvhd.start + 32 > mvhd.end) return null;
    scale = b.readUInt32BE(mvhd.start + 20);
    dur = Number(b.readBigUInt64BE(mvhd.start + 24));
  } else {
    if (mvhd.start + 20 > mvhd.end) return null;
    scale = b.readUInt32BE(mvhd.start + 12);
    dur = b.readUInt32BE(mvhd.start + 16);
  }
  if (!scale || !Number.isFinite(dur)) return null;
  return dur / scale;
}

/** Length in seconds of a WebM file, read from the segment "Info" element. Null when it cannot be read. */
export function webmSeconds(b: Buffer): number | null {
  const readId = (p: number): { id: number; len: number } | null => {
    const first = b[p];
    if (first === undefined || first === 0) return null;
    const len = Math.clz32(first) - 23; // 1..4 bytes
    if (len > 4 || p + len > b.length) return null;
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
    return { id, len };
  };
  const readSize = (p: number): { size: number; len: number } | null => {
    const first = b[p];
    if (first === undefined || first === 0) return null;
    const len = Math.clz32(first) - 23; // 1..8 bytes
    if (len > 8 || p + len > b.length) return null;
    let size = first & (0xff >> len);
    let allOnes = size === 0xff >> len;
    for (let i = 1; i < len; i++) {
      size = size * 256 + b[p + i];
      if (b[p + i] !== 0xff) allOnes = false;
    }
    return { size: allOnes ? -1 : size, len };
  };
  const SEGMENT = 0x18538067;
  const INFO = 0x1549a966;
  const SCALE = 0x2ad7b1;
  const DURATION = 0x4489;
  let scale = 1_000_000;
  let duration: number | null = null;

  const walk = (from: number, to: number, depth: number): void => {
    let p = from;
    while (p < to && duration === null) {
      const id = readId(p);
      if (!id) return;
      const sz = readSize(p + id.len);
      if (!sz) return;
      const body = p + id.len + sz.len;
      const end = sz.size < 0 ? to : Math.min(to, body + sz.size);
      if (id.id === SEGMENT || id.id === INFO) {
        if (depth < 3) walk(body, end, depth + 1);
      } else if (id.id === SCALE) {
        let v = 0;
        for (let i = body; i < end; i++) v = v * 256 + b[i];
        if (v > 0) scale = v;
      } else if (id.id === DURATION) {
        if (end - body === 4) duration = b.readFloatBE(body);
        else if (end - body === 8) duration = b.readDoubleBE(body);
      }
      if (sz.size < 0) return;
      p = end;
    }
  };
  walk(0, Math.min(b.length, 4 * 1024 * 1024), 0);
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return null;
  return (duration * scale) / 1e9;
}

export function videoSeconds(b: Buffer, type: 'mp4' | 'webm'): number | null {
  try {
    return type === 'mp4' ? mp4Seconds(b) : webmSeconds(b);
  } catch {
    return null;
  }
}

/** Checks the file and returns what it is. Throws a message the owner can act on. */
export function checkUpload(kind: string, bytes: Buffer): { type: 'jpg' | 'png' | 'webp' | 'mp4' | 'webm'; seconds: number | null } {
  if (kind !== 'image' && kind !== 'video') throw new HttpError(400, 'Choose either a photo or a video.');
  const max = kind === 'image' ? BACKGROUND_LIMITS.imageBytes : BACKGROUND_LIMITS.videoBytes;
  const mb = Math.round(max / 1048576);
  if (!bytes.length) throw new HttpError(400, 'The file was empty. Please choose it again.');
  if (bytes.length > max) throw new HttpError(413, `That ${kind} is too big. The limit is ${mb} MB.`);
  const s = sniff(bytes);
  if (kind === 'image') {
    if (!s || !['jpg', 'png', 'webp'].includes(s.type)) throw new HttpError(400, 'That is not a JPG, PNG or WebP photo.');
    return { type: s.type, seconds: null };
  }
  if (!s || (s.type !== 'mp4' && s.type !== 'webm')) throw new HttpError(400, 'That is not an MP4 or WebM video.');
  const seconds = videoSeconds(bytes, s.type);
  if (seconds === null) {
    throw new HttpError(400, 'Could not read how long that video is. Please use a normal MP4 exported from your phone or a video editor.');
  }
  if (seconds > BACKGROUND_LIMITS.videoSeconds + 0.15) {
    throw new HttpError(400, `That video is ${Math.ceil(seconds)} seconds long. The limit is ${BACKGROUND_LIMITS.videoSeconds} seconds.`);
  }
  return { type: s.type, seconds };
}

let queue: Promise<unknown> = Promise.resolve();

/** Checks and stores an uploaded photo or video as the background. Only one is ever kept. */
export function saveUpload(kind: string, bytes: Buffer): Promise<BackgroundInfo> {
  const run = async (): Promise<BackgroundInfo> => {
    const { type } = checkUpload(kind, bytes);
    const old = readMeta();
    const version = old.version + 1;
    const file = `bg-${version}.${type}`;
    mkdirSync(mediaDir(), { recursive: true });
    writeFileSync(join(mediaDir(), file), bytes);
    writeMeta({ kind: kind as 'image' | 'video', file, version });
    dropFile(old.file);
    return readBackground();
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
