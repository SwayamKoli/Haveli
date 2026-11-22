/**
 * The "Set up sheet" button: creates missing tabs and columns, then gives every tab the Clay & Sand look.
 */
import { getConfig } from '../lib/env';
import { ALL_TABS, exclusive, fetchRanges, listTabs, why, writeCells, type CellWrite } from './access';
import { sheetsRequest } from './google';
import { colLetter, normHeader, TAB_SPECS } from './schema';
import { forgetStaffCache } from './staff';
import { FACTS_FIELDS, factsFrom, styleRequests } from './style';

async function setupSheetNow(): Promise<{ changes: string[]; style: string }> {
  getConfig();
  const changes: string[] = [];
  const have = await listTabs();
  const add = TAB_SPECS.filter((t) => !have.includes(t.tab));
  if (add.length) {
    await sheetsRequest('POST', ':batchUpdate', {
      requests: add.map((t) => ({ addSheet: { properties: { title: t.tab, gridProperties: { frozenRowCount: 1 } } } })),
    });
    for (const t of add) changes.push(`Added the ${t.tab} tab`);
  }
  const now = await fetchRanges(TAB_SPECS.map((t) => t.tab));
  const writes: CellWrite[] = [];
  for (const t of TAB_SPECS) {
    const header = (now.get(t.tab) ?? [])[0] ?? [];
    const have2 = header.map(normHeader);
    const missing = t.cols.filter((c) => !c.names.some((n) => have2.includes(normHeader(n))));
    if (!missing.length) continue;
    const start = header.length;
    writes.push({ range: `${t.tab}!${colLetter(start)}1`, values: [missing.map((c) => c.names[0])] });
    if (!add.some((x) => x.tab === t.tab)) changes.push(`Added columns to ${t.tab}: ${missing.map((c) => c.names[0]).join(', ')}`);
  }
  await writeCells(writes);
  forgetStaffCache();
  let style: string;
  try {
    style = await styleSheetNow();
  } catch (e) {
    // The sheet works without its colours, so a styling problem never undoes the setup.
    style = `Could not apply the Clay & Sand look: ${why(e)}`;
  }
  return { changes, style };
}

/** Colours, widths, number formats and drop-downs for every tab. Never touches a value. Safe to run again. */
async function styleSheetNow(): Promise<string> {
  const have = await listTabs();
  const present = ALL_TABS.filter((t) => have.includes(t));
  const raw = await sheetsRequest<Parameters<typeof factsFrom>[0]>('GET', `?fields=${encodeURIComponent(FACTS_FIELDS)}`);
  const headers = await fetchRanges(present);
  const facts = factsFrom(raw, headers).filter((f) => present.includes(f.tab));
  const requests = facts.flatMap(styleRequests);
  if (requests.length) await sheetsRequest('POST', ':batchUpdate', { requests });
  return `Applied the Clay & Sand look to ${facts.map((f) => f.tab).join(', ')}`;
}

export const setupSheet = () => exclusive(() => setupSheetNow());
