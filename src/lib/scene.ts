/**
 * The drawn hotel scene: a haveli skyline with chhatris and lit arched windows, at dusk (dark theme)
 * or in the afternoon (light theme). Built once as SVG text; the movement is plain CSS (theme.css).
 * The numbers come from a fixed seed, so it always looks the same.
 */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function skyline(r: () => number, y: number, color: string, op: number, minH: number, maxH: number, gap: number): string {
  let d = '';
  let x = -40;
  while (x < 1700) {
    const w = 60 + r() * 80;
    const h = minH + r() * (maxH - minH);
    const t = r();
    d += `M${x},${y} V${y - h} `;
    if (t < 0.42) {
      const cx = x + w / 2;
      const rr = w * 0.42;
      d += `H${cx - rr} Q${cx - rr},${y - h - rr * 1.3} ${cx},${y - h - rr * 1.9} Q${cx + rr},${y - h - rr * 1.3} ${cx + rr},${y - h} `;
    } else if (t < 0.7) {
      for (let k = 0; k + 14 <= w; k += 14) d += 'h8 v-8 h6 v8 ';
    }
    d += `H${x + w} V${y} Z `;
    x += w + gap * r();
  }
  return `<path d="${d}" fill="${color}" opacity="${op}"/>`;
}

function chhatri(cx: number, y: number, c: string): string {
  return (
    `<g fill="${c}"><rect x="${cx - 34}" y="${y - 70}" width="7" height="70"/><rect x="${cx - 11}" y="${y - 70}" width="7" height="70"/>` +
    `<rect x="${cx + 4}" y="${y - 70}" width="7" height="70"/><rect x="${cx + 27}" y="${y - 70}" width="7" height="70"/>` +
    `<rect x="${cx - 42}" y="${y - 80}" width="84" height="12" rx="3"/>` +
    `<path d="M${cx - 34},${y - 80} Q${cx - 34},${y - 128} ${cx},${y - 150} Q${cx + 34},${y - 128} ${cx + 34},${y - 80}Z"/>` +
    `<rect x="${cx - 1.5}" y="${y - 172}" width="3" height="24"/><circle cx="${cx}" cy="${y - 174}" r="4"/></g>`
  );
}

/** `u` prefixes the gradient ids, so two copies on one page (background and settings preview) never clash. */
export function sceneSvg(day: boolean, u = 's'): string {
  const r = rng(11);
  const K = day
    ? { s: ['#efc296', '#f8dcc0', '#fff2e0'], far: '#d9a182', mid: '#bd6f50', near: '#8e4430', win: '#5b2a1f', ledge: '#a85a41', sun: '#fffaf0', glow: '#fff6e4' }
    : { s: ['#140908', '#43201a', '#ef9d5c'], far: '#7a3a2a', mid: '#38170f', near: '#1f0d09', win: '#ffb15c', ledge: '#33150e', sun: '#ffd9a0', glow: '#ffb06a' };
  let o =
    `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>` +
    `<linearGradient id="${u}sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K.s[0]}"/><stop offset=".55" stop-color="${K.s[1]}"/><stop offset="1" stop-color="${K.s[2]}"/></linearGradient>` +
    `<radialGradient id="${u}gl"><stop offset="0" stop-color="${K.glow}" stop-opacity="${day ? 0.9 : 0.85}"/><stop offset="1" stop-color="${K.glow}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${u}wg" cx=".5" cy=".75"><stop offset="0" stop-color="${day ? '#7a3a28' : '#ffd69a'}"/><stop offset="1" stop-color="${K.win}"/></radialGradient>` +
    `<filter id="${u}bl"><feGaussianBlur stdDeviation="14"/></filter></defs><rect width="1600" height="900" fill="url(#${u}sk)"/>`;
  if (!day) for (let i = 0; i < 46; i++) o += `<circle class="st" cx="${(r() * 1600).toFixed(1)}" cy="${(r() * 330).toFixed(1)}" r="${(0.6 + r() * 1.3).toFixed(2)}" fill="#ffe9c9" style="animation-delay:${(-r() * 4).toFixed(2)}s"/>`;
  o += `<g class="sun"><circle cx="1130" cy="520" r="360" fill="url(#${u}gl)"/><circle cx="1130" cy="520" r="${day ? 64 : 78}" fill="${K.sun}"/></g>`;
  o += `<g filter="url(#${u}bl)" opacity="${day ? 0.7 : 0.5}" fill="${day ? '#fff6ea' : '#d9805a'}"><ellipse class="cl" cx="420" cy="250" rx="240" ry="26"/><ellipse class="cl b" cx="1050" cy="190" rx="300" ry="22"/><ellipse class="cl" cx="1330" cy="380" rx="220" ry="20"/></g>`;
  o += skyline(r, 640, K.far, 0.55, 50, 150, 30) + skyline(r, 660, K.mid, 0.9, 30, 110, 20);
  [150, 250, 200].forEach((y, i) => {
    o += `<g class="bird" style="animation-delay:${-i * 17}s;animation-duration:${44 + i * 9}s" transform="translate(0,${y})" opacity=".8"><path d="M0,0 q8,-9 16,0 q8,-9 16,0" fill="none" stroke="${day ? '#6a3526' : '#241009'}" stroke-width="2.2" stroke-linecap="round" style="animation-delay:${-i * 0.3}s"/></g>`;
  });
  o += `<rect x="0" y="560" width="1600" height="340" fill="${K.near}"/>`;
  for (let x = 0; x < 1600; x += 40) o += `<path d="M${x},560 v-14 q10,-14 20,0 v14z" fill="${K.near}"/>`;
  [190, 560, 1040, 1410].forEach((cx) => (o += chhatri(cx, 560, K.near)));
  for (let i = 0; i < 9; i++) {
    const x = 48 + i * 172;
    const ya = 640;
    const yb = 820;
    const w = 104;
    const k = ['', 'b', 'c'][i % 3];
    o +=
      `<rect x="${x - 14}" y="${yb}" width="${w + 28}" height="12" fill="${K.ledge}"/>` +
      `<path d="M${x - 8},${yb} V${ya} A ${w} ${w} 0 0 1 ${x + w / 2},${ya - 70} A ${w} ${w} 0 0 1 ${x + w + 8},${ya} V${yb}Z" fill="${K.ledge}"/>` +
      `<path class="w ${k}" d="M${x},${yb} V${ya} A ${w} ${w} 0 0 1 ${x + w / 2},${ya - 62} A ${w} ${w} 0 0 1 ${x + w},${ya} V${yb}Z" fill="url(#${u}wg)"/>` +
      `<rect x="${x + w / 2 - 1.5}" y="${ya - 40}" width="3" height="${yb - ya + 40}" fill="${K.near}" opacity=".55"/>`;
  }
  for (let i = 0; i < 22; i++) o += `<circle class="pt" cx="${(r() * 1600).toFixed(1)}" cy="${(560 + r() * 320).toFixed(1)}" r="${(1 + r() * 2).toFixed(2)}" fill="${day ? '#d9803a' : '#ffc47a'}" style="animation-delay:${(-r() * 13).toFixed(2)}s;animation-duration:${(10 + r() * 8).toFixed(1)}s"/>`;
  return o + '</svg>';
}
