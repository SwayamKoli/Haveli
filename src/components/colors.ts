/**
 * Colours for room states and booking stages, and a helper for CSS variables.
 */
import type { CSSProperties } from 'react';
import type { RoomState, Stage } from '../../shared/types';

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

export const cssVars = (v: Record<string, string | number>): CSSProperties => v as CSSProperties;
