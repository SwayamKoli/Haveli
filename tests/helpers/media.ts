/** Tiny valid-looking photo and video files, made in memory, so tests need no real media. */

export function jpeg(extra = 64): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(extra, 7), Buffer.from([0xff, 0xd9])]);
}
export function png(extra = 64): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 3)]);
}
export function webp(extra = 64): Buffer {
  return Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x40, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(extra, 1)]);
}

const box = (type: string, body: Buffer) => {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
};

/** An MP4 whose movie header says it lasts `seconds`. `mdatFirst` puts the media before the header, as some phones do. */
export function mp4(seconds: number, opts: { mdatFirst?: boolean; version1?: boolean; padding?: number } = {}): Buffer {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2avc1mp41')]));
  const timescale = 1000;
  let mvhd: Buffer;
  if (opts.version1) {
    const b = Buffer.alloc(112);
    b[0] = 1;
    b.writeUInt32BE(timescale, 20);
    b.writeBigUInt64BE(BigInt(Math.round(seconds * timescale)), 24);
    mvhd = box('mvhd', b);
  } else {
    const b = Buffer.alloc(100);
    b.writeUInt32BE(timescale, 12);
    b.writeUInt32BE(Math.round(seconds * timescale), 16);
    mvhd = box('mvhd', b);
  }
  const moov = box('moov', mvhd);
  const mdat = box('mdat', Buffer.alloc(opts.padding ?? 256, 9));
  return Buffer.concat(opts.mdatFirst ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

/** An MP4 with no movie header at all (cut off), so its length cannot be known. */
export function brokenMp4(): Buffer {
  return Buffer.concat([box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2')])), box('mdat', Buffer.alloc(256, 9))]);
}

/** A WebM whose Info element says it lasts `seconds`. */
export function webm(seconds: number, opts: { noDuration?: boolean } = {}): Buffer {
  const el = (id: number[], body: Buffer) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | body.length]), body]);
  const scale = el([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])); // 1,000,000 ns
  const dur = Buffer.alloc(8);
  dur.writeDoubleBE(seconds * 1000);
  const info = Buffer.concat([scale, opts.noDuration ? Buffer.alloc(0) : el([0x44, 0x89], dur)]);
  const infoEl = Buffer.concat([Buffer.from([0x15, 0x49, 0xa9, 0x66]), Buffer.from([0x80 | info.length]), info]);
  const header = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x84]), Buffer.from([0x42, 0x82, 0x81, 0x00])]);
  const segment = Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), infoEl, Buffer.alloc(64, 5)]);
  return Buffer.concat([header, segment]);
}
