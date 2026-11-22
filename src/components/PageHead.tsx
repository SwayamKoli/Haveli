/**
 * The title row at the top of every page.
 */
import type { ReactNode } from 'react';

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
