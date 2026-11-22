/**
 * The hotel's name as the app's logo. The name comes from HOTEL_NAME in the .env file (see .env.example),
 * so every hotel that buys the app sees its own name on the sidebar, sign-in screen and welcome animation.
 */
import type { CSSProperties } from 'react';
import { Icon } from './Icon';

/** Type size step for a name: the longer it is, the smaller it is set, so it always fits. */
export function nameSize(name: string): 'l' | 'm' | 's' | 'xs' {
  const n = name.trim().length;
  if (n <= 10) return 'l';
  if (n <= 16) return 'm';
  if (n <= 24) return 's';
  return 'xs';
}

/** Icon and hotel name, as shown at the top of the sidebar and on the sign-in card. */
export function Logo({ name }: { name: string }) {
  return (
    <div className="logo" title={name}>
      <i><Icon name="hotel" /></i>
      <span className="lbl" data-size={nameSize(name)}>{name}</span>
    </div>
  );
}

/** Full-screen welcome shown once when the website opens: the hotel's name, letter by letter. Click to skip. */
export function Intro({ name, onDone }: { name: string; onDone: () => void }) {
  return (
    <div className="intro" onClick={onDone} role="presentation" aria-hidden="true">
      <div className="intro-in">
        <i className="intro-mark"><Icon name="hotel" /></i>
        <div className="intro-word" data-size={nameSize(name)}>
          {name.split(/\s+/).filter(Boolean).map((word, w, all) => {
            const before = all.slice(0, w).join('').length;
            return (
              <span className="intro-w" key={w}>
                {word.split('').map((c, i) => (
                  <span key={i} style={{ ['--i' as string]: before + i } as CSSProperties}>{c}</span>
                ))}
              </span>
            );
          })}
        </div>
        <div className="intro-sub">Hotel management</div>
        <div className="intro-line" />
      </div>
    </div>
  );
}
