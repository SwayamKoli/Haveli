/**
 * One booking as a card on the board.
 */
import { useState, type DragEvent } from 'react';
import { roomsLabel } from '../../../shared/rules';
import type { Booking } from '../../../shared/types';
import { Avatar, PayChip } from '../../components/Chips';
import { Icon } from '../../components/Icon';
import { STAGE_COLOR } from '../../components/colors';
import { inr, plural, rel } from '../../lib/format';
import { daysFrom } from '../../lib/selectors';
import { useStore } from '../../state/store';

export function BookingCard({ b, today, onDragging }: { b: Booking; today: string; onDragging: (id: string | null) => void }) {
  const { data, setMenu, openLayer } = useStore();
  const room = data.rooms.find((r) => r.no === b.rooms[0]);
  const when = b.stage === 'in' ? `out ${rel(daysFrom(today, b.co))}` : b.stage === 'out' ? `left ${rel(daysFrom(today, b.co))}` : `arrives ${rel(daysFrom(today, b.ci))}`;
  const [dragging, setDragging] = useState(false);
  return (
    <article
      className={`kcard${b.stage === 'cancelled' ? ' cancelled-card' : ''}${dragging ? ' drag' : ''}`}
      draggable
      data-id={b.id}
      tabIndex={0}
      onClick={() => openLayer({ kind: 'booking-view', id: b.id })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openLayer({ kind: 'booking-view', id: b.id });
      }}
      onDragStart={(e: DragEvent) => {
        setDragging(true);
        onDragging(b.id);
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', b.id);
        } catch {
          /* some browsers refuse */
        }
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragging(null);
      }}
    >
      <div className="k-top">
        <span>
          <i className="dotc" style={{ background: STAGE_COLOR[b.stage] }} />
          {b.rooms.length > 1 ? `${b.rooms.length} rooms` : (room?.type ?? 'Room')} · {b.source}
        </span>
        <button
          className="more"
          aria-label={`Move ${b.guest} to another stage`}
          onClick={(e) => {
            e.stopPropagation();
            setMenu({ id: b.id, rect: e.currentTarget.getBoundingClientRect() });
          }}
        >
          <Icon name="more" size={16} />
        </button>
      </div>
      <h4>{b.guest}</h4>
      <p className="ks">{b.rooms.length > 1 ? 'Rooms' : 'Room'} {roomsLabel(b.rooms)} · {plural(b.nights, 'night')} · {inr(b.total)}{b.discount > 0 ? ` (−${inr(b.discount)})` : ''}</p>
      <div className="k-foot">
        <span className="chip">
          <Icon name="clock" size={12} />
          {when}
        </span>
        <PayChip b={b} />
        <Avatar name={b.guest} />
      </div>
    </article>
  );
}
