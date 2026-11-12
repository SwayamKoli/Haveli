/**
 * Tiny .env reader (no extra package). Understands:
 *   NAME=value     NAME="value with \n escapes"     NAME='raw value'
 * Quoted values may continue over several lines. A value that starts with { is read up to
 * its matching }, with or without quotes around it, so the Google key file works however
 * it was pasted. Lines starting with # are comments.
 */
import { existsSync, readFileSync } from 'node:fs';

const KEY = /[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/y;
const VALUE = /'([^']*)'|"((?:[^"\\]|\\.)*)"|([^\r\n]*)/y;

/** Index just after the } that closes the { at `start` (JSON-aware), or -1. */
function endOfObject(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

export function parseDotEnv(input: string): Record<string, string> {
  const text = input.replace(/^\uFEFF/, '');
  const out: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    KEY.lastIndex = i;
    const k = KEY.exec(text);
    if (!k) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    let p = KEY.lastIndex;
    const wrap = text[p] === '"' || text[p] === "'" ? text[p] : '';
    const open = wrap ? p + 1 : p;
    if (text[open] === '{') {
      const end = endOfObject(text, open);
      if (end > 0) {
        out[k[1]] = text.slice(open, end);
        p = wrap && text[end] === wrap ? end + 1 : end;
        const nl = text.indexOf('\n', p);
        i = nl === -1 ? text.length : nl + 1;
        continue;
      }
    }
    VALUE.lastIndex = p;
    const v = VALUE.exec(text)!;
    if (v[1] !== undefined) out[k[1]] = v[1];
    else if (v[2] !== undefined) out[k[1]] = v[2].replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1');
    else out[k[1]] = (v[3] ?? '').replace(/[ \t]+#.*$/, '').trim();
    i = VALUE.lastIndex;
    const nl = text.indexOf('\n', i);
    i = nl === -1 ? text.length : nl + 1;
  }
  return out;
}

/** Fills process.env from a file. Variables that are already set win. */
export function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const [k, v] of Object.entries(parseDotEnv(readFileSync(file, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
