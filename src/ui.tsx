/** Small building blocks shared by every screen: icons, chips, dialogs, charts, toasts. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { ROOM_STATE_LABEL, STAGES, STAGE_LABEL } from '../shared/constants';
import type { Booking, RoomState, Stage } from '../shared/types';
import { hue, initials, inr } from './lib/format';
import { gsap, motionOn } from './lib/motion';
import { useStore } from './store';

/* ---------- icons ---------- */

const PATHS = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  bed: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="1.7"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16.5 5.6a3 3 0 0 1 0 5.8M18 14.4c1.8.7 3 2.5 3 5.6"/>',
  chart: '<path d="M5 20v-6M12 20V5M19 20v-9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 17h.01"/>',
  out: '<path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9M16 8l4 4-4 4M20 12H9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3.8 7.5l8.2 6 8.2-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M7 17L17 7M9 7h8v8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<g style="fill:currentColor;stroke:none"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></g>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><path d="M9.5 4.5v15"/>',
  hotel: '<path d="M4.5 20V9.5L12 4l7.5 5.5V20M9.5 20v-5.5h5V20"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4M5 3v4h4M19 21v-4h-4"/>',
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={size ? { fontSize: size } : undefined}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

/* ---------- colours ---------- */

export const ROOM_COLOR: Record<RoomState, string> = {
  available: 'var(--good)',
  occupied: 'var(--accent)',
  cleaning: 'var(--warn)',
  maintenance: 'var(--bad)',
};
export const STAGE_COLOR: Record<Stage, string> = {
  reserved: 'var(--info)',
  in: 'var(--accent)',
  out: 'var(--good)',
  cancelled: 'var(--faint)',
};
const ROOM_CHIP: Record<RoomState, string> = { available: 'good', occupied: 'acc', cleaning: 'warn', maintenance: 'bad' };

export const cssVars = (v: Record<string, string | number>): CSSProperties => v as CSSProperties;

/* ---------- chips ---------- */

export function Avatar({ name }: { name: string }) {
  return (
    <span className="av" style={{ background: hue(name) }}>
      {initials(name)}
    </span>
  );
}

export function PayChip({ b }: { b: Booking }) {
  if (b.stage === 'cancelled') return <span className="chip">No charge</span>;
  return b.balance <= 0 ? <span className="chip good">Paid</span> : <span className="chip warn">{inr(b.balance)} due</span>;
}

export function StageChip({ stage }: { stage: Stage }) {
  return (
    <span className="chip" style={{ color: STAGE_COLOR[stage] }}>
      <i className="dotc" style={{ background: STAGE_COLOR[stage] }} />
      {STAGE_LABEL[stage]}
    </span>
  );
}

export function RoomChip({ state }: { state: RoomState }) {
  return <span className={`chip ${ROOM_CHIP[state]}`}>{ROOM_STATE_LABEL[state]}</span>;
}

/* ---------- dialogs ---------- */

/** Dark backdrop plus a centred dialog or a right-hand drawer. Handles Esc, focus and Tab. */
export function Layer({ right, onClose, children }: { right?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const box = root.querySelector<HTMLElement>('.modal,.drawer');
    if (box && motionOn()) {
      gsap.from(root, { opacity: 0, duration: 0.2 });
      gsap.from(box, right ? { x: 60, opacity: 0, duration: 0.4, ease: 'power3.out' } : { y: 24, scale: 0.97, opacity: 0, duration: 0.35, ease: 'power3.out' });
    }
    const first = box?.querySelector<HTMLElement>('input,select') ?? box?.querySelector<HTMLElement>('button');
    first?.focus();
    return () => previous?.focus?.();
  }, [right]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>('input,select,button,[href],textarea')).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={ref}
      className={`scrim${right ? ' right' : ''}`}
      onMouseDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current) onClose();
      }}
      onKeyDown={trapTab}
    >
      {children}
    </div>
  );
}

export function Field({ id, label, error, full, children }: { id: string; label: string; error?: string; full?: boolean; children: ReactNode }) {
  return (
    <div className={`${full ? 'full' : ''}${error ? ' bad' : ''}`.trim() || undefined}>
      <label htmlFor={id}>{label}</label>
      {children}
      <div className="err" role={error ? 'alert' : undefined}>{error}</div>
    </div>
  );
}

/* ---------- toasts ---------- */

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastRow key={t.id} id={t.id} msg={t.msg} err={t.err} undo={t.undo} onDone={dismissToast} />
      ))}
    </div>
  );
}

function ToastRow({ id, msg, err, undo, onDone }: { id: number; msg: string; err?: boolean; undo?: () => void; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current && motionOn()) gsap.from(ref.current, { y: 20, opacity: 0, duration: 0.35, ease: 'power3.out' });
  }, []);
  return (
    <div className={`toast${err ? ' err' : ''}`} ref={ref}>
      <Icon name={err ? 'x' : 'check'} />
      <span>{msg}</span>
      {undo && (
        <button
          onClick={() => {
            undo();
            onDone(id);
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

/* ---------- stage menu (the "..." on a booking) ---------- */

export function StageMenu() {
  const { menu, setMenu, data, setStage, openLayer } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const booking = menu ? data.bookings.find((b) => b.id === menu.id) : undefined;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = menu.rect;
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)),
      top: r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6,
    });
    el.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [menu]);

  if (!menu || !booking) return null;
  const canPay = booking.stage !== 'cancelled' && booking.balance > 0;
  return (
    <div className="menu" role="menu" ref={ref} style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}>
      <p>Move to</p>
      {STAGES.map((s) => (
        <button
          key={s}
          role="menuitem"
          disabled={booking.stage === s}
          onClick={() => {
            setMenu(null);
            void setStage(booking.id, s);
          }}
        >
          <i className="dotc" style={{ background: STAGE_COLOR[s] }} />
          {STAGE_LABEL[s]}
          {booking.stage === s && <small style={{ marginLeft: 'auto', color: 'var(--faint)' }}>current</small>}
        </button>
      ))}
      <p>Payment</p>
      <button
        role="menuitem"
        disabled={!canPay}
        onClick={() => {
          setMenu(null);
          openLayer({ kind: 'payment', id: booking.id });
        }}
      >
        <Icon name="check" size={14} />
        Record payment…
        {canPay && <small style={{ marginLeft: 'auto', color: 'var(--faint)' }}>{inr(booking.balance)} due</small>}
      </button>
    </div>
  );
}

/* ---------- numbers ---------- */

/** A number that counts up when it first appears and when it changes. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(motionOn() ? 0 : value);
  const from = useRef(motionOn() ? 0 : value);
  useEffect(() => {
    if (!motionOn()) {
      setShown(value);
      from.current = value;
      return;
    }
    const o = { n: from.current };
    const tween = gsap.to(o, {
      n: value,
      duration: 0.9,
      ease: 'power2.out',
      onUpdate: () => {
        from.current = o.n;
        setShown(Math.round(o.n));
      },
    });
    return () => {
      tween.kill();
    };
  }, [value]);
  return <span>{shown}</span>;
}

/* ---------- charts ---------- */

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
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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
              <stop offset="0" stopColor="#4aa3c8" stopOpacity=".38" />
              <stop offset="1" stopColor="#4aa3c8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((t) => {
            const yy = y((max * t) / 4);
            return (
              <g key={t}>
                <line x1={pl} x2={W - pr} y1={yy} y2={yy} stroke={`rgba(170,215,230,${t === 0 ? 0.2 : 0.07})`} strokeDasharray={t === 0 ? undefined : '3 5'} />
                <text x={pl - 9} y={yy + 4} textAnchor="end">
                  {kfmt((max * t) / 4)}
                </text>
              </g>
            );
          })}
          {xl}
          <path d={area} fill={`url(#${gid})`} />
          <path ref={lineRef} className="ln" d={d} fill="none" stroke="#6bbbdc" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <line className="guide" x1={x(at)} x2={x(at)} y1={pt} y2={h - pb} stroke="rgba(232,241,243,.3)" strokeDasharray="3 4" opacity={hover === null ? 0 : 1} />
          <circle className="gd" r="5" fill="#0c181d" stroke="#e8f1f3" strokeWidth="2" cx={x(at)} cy={y(vals[at])} />
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

export function PageHead({ title, sub, children }: { title: string; sub: ReactNode; children?: ReactNode }) {
  return (
    <div className="ph anim">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div className="ph-act">{children}</div>
    </div>
  );
}
