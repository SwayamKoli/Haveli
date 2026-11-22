/**
 * The line chart and the horizontal bars used on the dashboard and analytics.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { inr } from '../lib/format';
import { gsap, motionOn } from '../lib/motion';

function niceMax(v: number): number {
  const s = v > 400000 ? 100000 : v > 100000 ? 50000 : v > 40000 ? 20000 : 10000;
  return Math.max(s, Math.ceil(v / s) * s);
}

function kfmt(v: number): string {
  if (v === 0) return '0';
  return v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : `₹${v / 1000}k`;
}

/** Smooth line chart that fits its container and shows a tooltip on hover. */
export function LineChart({ vals, labels, h = 230, label }: { vals: number[]; labels: string[]; h?: number; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const drawn = useRef(false);
  const [W, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setW((prev) => (Math.abs(prev - Math.round(el.clientWidth)) < 3 ? prev : Math.round(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const p = lineRef.current;
    if (!p || drawn.current || !motionOn() || W < 80) return;
    drawn.current = true;
    const len = p.getTotalLength?.() ?? 0;
    if (len) gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out', clearProps: 'strokeDasharray,strokeDashoffset' });
  }, [W]);

  const n = vals.length;
  const pl = 48;
  const pr = 12;
  const pt = 14;
  const pb = 30;
  const max = niceMax(Math.max(...vals, 1));
  const x = (i: number) => pl + ((W - pl - pr) * i) / Math.max(1, n - 1);
  const y = (v: number) => pt + (h - pt - pb) * (1 - v / max);

  let body: ReactNode = null;
  if (W >= 80 && n >= 2) {
    let d = `M${x(0)},${y(vals[0])}`;
    for (let i = 1; i < n; i++) {
      const mx = (x(i - 1) + x(i)) / 2;
      d += ` C${mx},${y(vals[i - 1])} ${mx},${y(vals[i])} ${x(i)},${y(vals[i])}`;
    }
    const area = `${d} L${x(n - 1)},${h - pb} L${x(0)},${h - pb} Z`;
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - pl) / 78))));
    const xl: ReactNode[] = [];
    for (let j = n - 1; j >= 0; j -= every) {
      xl.push(
        <text key={j} x={x(j)} y={h - 8} textAnchor={j === n - 1 ? 'end' : 'middle'}>
          {labels[j]}
        </text>,
      );
    }
    const at = hover ?? n - 1;
    body = (
      <>
        <svg
          ref={svgRef}
          width={W}
          height={h}
          viewBox={`0 0 ${W} ${h}`}
          role="img"
          aria-label={label}
          onPointerMove={(e) => {
            const r = svgRef.current?.getBoundingClientRect();
            if (!r) return;
            setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - pl) / (W - pl - pr)) * (n - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--accent)' }} stopOpacity=".26" />
              <stop offset="1" style={{ stopColor: 'var(--accent)' }} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((t) => {
            const yy = y((max * t) / 4);
            return (
              <g key={t}>
                <line x1={pl} x2={W - pr} y1={yy} y2={yy} stroke="rgb(var(--t))" strokeOpacity={t === 0 ? 0.2 : 0.1} strokeDasharray={t === 0 ? undefined : '3 5'} />
                <text x={pl - 9} y={yy + 4} textAnchor="end">
                  {kfmt((max * t) / 4)}
                </text>
              </g>
            );
          })}
          {xl}
          <path d={area} fill={`url(#${gid})`} />
          <path ref={lineRef} className="ln" d={d} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <line className="guide" x1={x(at)} x2={x(at)} y1={pt} y2={h - pb} stroke="rgb(var(--t))" strokeOpacity=".3" strokeDasharray="3 4" opacity={hover === null ? 0 : 1} />
          <circle className="gd" r="5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2.2" cx={x(at)} cy={y(vals[at])} />
        </svg>
        <div className="tipbox" style={{ left: Math.max(60, Math.min(W - 60, x(at))), top: y(vals[at]), opacity: hover === null ? 0 : 1 }}>
          <b>{inr(vals[at])}</b>
          <span>{labels[at] + (at === n - 1 ? ' · so far' : '')}</span>
        </div>
      </>
    );
  }
  return (
    <div className="lc" ref={wrap} style={{ height: h }}>
      {body}
    </div>
  );
}

export function HBars({ items }: { items: { l: string; v: number; t: string }[] }) {
  const mx = Math.max(...items.map((i) => i.v), 0) || 1;
  return (
    <div className="hb">
      {items.map((i) => (
        <div key={i.l}>
          <div className="l">
            <b style={{ fontWeight: 400 }}>{i.l}</b>
            <span className="num">{i.t}</span>
          </div>
          <div className="t">
            <i style={{ width: `${Math.max(3, (i.v / mx) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
