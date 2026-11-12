/**
 * Animation helpers. Everything is skipped for people who ask their device
 * for reduced motion, and the app works the same without any of it.
 */
import { gsap } from 'gsap';

export { gsap };

export function motionOn(): boolean {
  return !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Entrance animation for a freshly shown page. */
export function animatePage(root: HTMLElement | null): void {
  if (!root || !motionOn()) return;
  const q = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
  const anim = q('.anim');
  if (anim.length) gsap.from(anim, { y: 16, opacity: 0, duration: 0.55, stagger: 0.045, ease: 'power3.out', clearProps: 'transform,opacity' });
  const bars = [...q('.bar:not(.fc)'), ...q('.bar.fc')];
  if (bars.length) gsap.from(bars, { scaleY: 0, duration: 0.8, stagger: 0.06, ease: 'power3.out', clearProps: 'transform' });
  q('.hb .t i').forEach((i) => gsap.from(i, { scaleX: 0, duration: 0.8, ease: 'power3.out', clearProps: 'transform' }));
}
