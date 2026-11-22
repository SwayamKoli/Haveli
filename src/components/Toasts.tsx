/**
 * The small messages that appear at the bottom, with an optional Undo.
 */
import { useLayoutEffect, useRef } from 'react';
import { gsap, motionOn } from '../lib/motion';
import { useStore } from '../state/store';
import { Icon } from './Icon';

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
