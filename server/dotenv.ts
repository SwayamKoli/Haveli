/**
 * Tiny .env reader (no extra package). Understands:
 *   NAME=value          NAME="value with \\n escapes"          NAME='raw value'
 * and quoted values that continue over several lines, so the Google key file can be
 * pasted exactly as downloaded. Lines starting with # are comments.
 */
import { existsSync, readFileSync } from 'node:fs';

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|([^\r\n]*))/gm;
  for (const m of text.replace(/^\uFEFF/, '').matchAll(re)) {
    const [, key, single, double, bare] = m;
    if (single !== undefined) out[key] = single;
    else if (double !== undefined) out[key] = double.replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1');
    else out[key] = (bare ?? '').replace(/[ \t]+#.*$/, '').trim();
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
