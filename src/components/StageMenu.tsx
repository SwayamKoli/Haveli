/**
 * The "..." menu on a booking: move to a stage, edit, take a payment.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { STAGE_LABEL, STAGES } from '../../shared/constants';
import { inr } from '../lib/format';
import { useStore } from '../state/store';
import { Icon } from './Icon';
import { STAGE_COLOR } from './colors';

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
  const canPay = booking.balance > 0 || booking.paid > 0;
  return (
    <div className="menu" role="menu" ref={ref} style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}>
      <p>Booking</p>
      <button
        role="menuitem"
        onClick={() => {
          setMenu(null);
          openLayer({ kind: 'booking-view', id: booking.id });
        }}
      >
        <Icon name="eye" size={14} />
        View details
      </button>
      <button
        role="menuitem"
        disabled={booking.stage === 'cancelled'}
        onClick={() => {
          setMenu(null);
          openLayer({ kind: 'booking-edit', id: booking.id });
        }}
      >
        <Icon name="edit" size={14} />
        Edit booking…
      </button>
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
        Payment or refund…
        {booking.balance > 0 && <small style={{ marginLeft: 'auto', color: 'var(--faint)' }}>{inr(booking.balance)} due</small>}
      </button>
    </div>
  );
}
