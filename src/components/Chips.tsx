/**
 * Small labels: guest avatar, payment status, booking stage, room state.
 */
import { ROOM_STATE_LABEL, STAGE_LABEL } from '../../shared/constants';
import type { Booking, RoomState, Stage } from '../../shared/types';
import { hue, initials, inr } from '../lib/format';
import { STAGE_COLOR } from './colors';

const ROOM_CHIP: Record<RoomState, string> = { available: 'good', occupied: 'acc', cleaning: 'warn', maintenance: 'bad' };

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
