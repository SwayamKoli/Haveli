/**
 * The pop-up window and side drawer, and one labelled form field.
 */
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { gsap, motionOn } from '../lib/motion';

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
