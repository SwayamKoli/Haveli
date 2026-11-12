import { SOURCES, STAGES, STAGE_LABEL } from '../../shared/constants';
import type { ReactNode } from 'react';
import { inr } from '../lib/format';
import { counts, revenueSeries, roomState } from '../lib/selectors';
import { useStore } from '../store';
import { HBars, LineChart, PageHead } from '../ui';

function Stat({ title, hi, foot, children }: { title: string; hi?: boolean; foot: ReactNode; children: ReactNode }) {
  return (
    <article className={`stat anim${hi ? ' hi' : ''}`}>
      <header>
        <h3>{title}</h3>
      </header>
      <div className="val num">{children}</div>
      <footer>{foot}</footer>
    </article>
  );
}

export function Analytics() {
  const { data } = useStore();
  const { rooms, bookings } = data;
  const c = counts(data);
  const occ = rooms.length ? c.occupied / rooms.length : 0;
  const inHouse = bookings.filter((b) => b.stage === 'in');
  const adr = inHouse.length ? inHouse.reduce((s, b) => s + b.price, 0) / inHouse.length : 0;
  const live = bookings.filter((b) => b.stage !== 'cancelled');
  const stay = live.length ? live.reduce((s, b) => s + b.nights, 0) / live.length : 0;
  const series = revenueSeries(data, 30);
  const month = series.vals.reduce((a, b) => a + b, 0);

  const sources = Array.from(new Set([...SOURCES, ...live.map((b) => b.source)]));
  const bySource = sources
    .map((s) => ({ l: s, v: live.filter((b) => b.source === s).reduce((a, b) => a + b.total, 0) }))
    .sort((a, b) => b.v - a.v)
    .map((i) => ({ ...i, t: inr(i.v) }));

  const types = Array.from(new Set(rooms.map((r) => r.type)));
  const byType = types.map((t) => {
    const all = rooms.filter((r) => r.type === t);
    const used = all.filter((r) => roomState(r, bookings) === 'occupied').length;
    return { l: t, v: used / all.length, t: `${used} of ${all.length} rooms · ${Math.round((used / all.length) * 100)}%` };
  });

  const byStage = STAGES.map((st) => {
    const k = bookings.filter((b) => b.stage === st);
    return { l: STAGE_LABEL[st], v: k.length, t: `${k.length} · ${inr(k.reduce((a, b) => a + b.total, 0))}` };
  });

  return (
    <>
      <PageHead title="Analytics" sub="How the property is performing · last 30 days">
        <span className="chip acc" style={{ height: 32, padding: '0 14px', fontSize: 12.5, borderRadius: 16 }}>Last 30 days</span>
      </PageHead>
      <div className="grid g4">
        <Stat title="Revenue (30 days)" hi foot={<span className="chip good">Room revenue</span>}>{inr(month)}</Stat>
        <Stat title="Average daily rate" foot={<span>Per occupied room tonight</span>}>{inr(adr)}</Stat>
        <Stat title="Revenue per room" foot={<span>ADR × occupancy</span>}>{inr(adr * occ)}</Stat>
        <Stat title="Average stay" foot={<span>Across all bookings</span>}>
          {stay.toFixed(1)}
          <small> nights</small>
        </Stat>
      </div>
      <div className="grid r3 wide">
        <section className="card anim">
          <div className="card-h">
            <div>
              <h3>Daily room revenue</h3>
              <p className="sub">Hover to read a day</p>
            </div>
          </div>
          <LineChart vals={series.vals} labels={series.labels} h={300} label="Daily room revenue, last 30 days" />
        </section>
        <section className="card anim">
          <div className="card-h">
            <div>
              <h3>Revenue by source</h3>
              <p className="sub">All current bookings</p>
            </div>
          </div>
          <HBars items={bySource} />
        </section>
      </div>
      <div className="grid r4" style={{ marginTop: 14 }}>
        <section className="card anim">
          <div className="card-h">
            <div>
              <h3>Occupancy by room type</h3>
              <p className="sub">Tonight</p>
            </div>
          </div>
          <HBars items={byType} />
        </section>
        <section className="card anim">
          <div className="card-h">
            <div>
              <h3>Bookings by stage</h3>
              <p className="sub">Where every booking stands</p>
            </div>
          </div>
          <HBars items={byStage} />
        </section>
      </div>
    </>
  );
}
