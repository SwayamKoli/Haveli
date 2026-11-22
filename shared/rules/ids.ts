/**
 * The next free id for a new booking, guest, room or payment.
 */
/** Next ID like BK0007, based on the biggest number already used. */
export function nextId(prefix: string, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const m = /(\d+)\s*$/.exec(id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + String(max + 1).padStart(4, '0');
}
