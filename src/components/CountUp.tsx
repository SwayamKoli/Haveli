/**
 * A number that counts up when it appears.
 */
import { useEffect, useRef, useState } from 'react';
import { gsap, motionOn } from '../lib/motion';

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
