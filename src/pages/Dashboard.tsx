import type { ReactNode } from 'react';
import { ROOM_STATE_LABEL } from '../../shared/constants';
import type { RoomState } from '../../shared/types';
import { HOTEL_NAME } from '../config';
import { inr, longDate, nowMinutes, plural, weekday } from '../lib/format';
import type { Page } from '../lib/route';
import { arrivalsToday, attentionRooms, counts, departuresToday, occupancyPct, revenueOn, revenueSeries, weekOccupancy } from '../lib/selectors';
import { addDays } from '../../shared/dates';
import { useStore } from '../store';
import { Avatar, CountUp, Icon, LineChart, PageHead, PayChip, ROOM_COLOR, cssVars } from '../ui';

function StatCard({ cls = '', title, go, onGo, foot, children }: { cls?: string; title: string; go: Page; onGo: (p: Page) => void; foot: ReactNode; children: ReactNode }) {
  return (
    <article className={`stat ${cls} anim`}>
      <header>
        <h3>{title}</h3>
        <button className="round" onClick={() => onGo(go)} aria-label={`Open ${go}`}>
          <Icon name="arrow" size={15} />
        </button>
      </header>
      <div className="val num">{children}</div>
      <footer>{foot}</footer>
    </article>
  );
}

export function Dashboard({ go }: { go: (p: Page) => void }) {
  const { data, ui, setUi, openLayer, setStage, setRoom } = useStore();
  const { rooms, bookings, today } = data;
  const c = counts(data);
  const n = rooms.length;
  const occ = n ? Math.round((c.occupied / n) * 100) : 0;
  const yPts = occ - occupancyPct(data, addDays(today, -1));
  const arr = arrivalsToday(data);
  const arrLeft = arr.filter((b) => b.stage === 'reserved').length;
  const dep = departuresToday(data);
  const depLeft = dep.filter((b) => b.stage === 'in').length;
  const rev = revenueOn(data, today);
  const lastWeek = revenueOn(data, addDays(today, -7));
  const dayName = weekday(today, 'short');
  const revDelta = lastWeek > 0 ? Math.round(((rev - lastWeek) / lastWeek) * 100) : null;

  const { dow, days } = weekOccupancy(data);
  const peak = days.reduce((m, d, i) => (d.pct > days[m].pct ? i : m), 0);

  const next = arr.filter((b) => b.stage === 'reserved' && b.ci === today).sort((a, b) => (a.etaMin ?? 840) - (b.etaMin ?? 840))[0];
  const room = next && rooms.find((r) => r.no === next.room);
  const diff = next ? (next.etaMin ?? 840) - nowMinutes() : 0;
  const when = diff > 60 ? `Arrives in ${Math.floor(diff / 60)} h ${diff % 60} min` : diff > 0 ? `Arrives in ${diff} min` : 'Expected any moment';

  const states: RoomState[] = ['occupied', 'available', 'cleaning', 'maintenance'];
  const attention = attentionRooms(data);
  const list = ui.mov === 'arr' ? arr : dep;
  const series = revenueSeries(data, 14);

  return (
    <>
      <PageHead title="Dashboard" sub={`Rooms, guests and money at ${HOTEL_NAME} · ${longDate(today)}`}>
        <button className="btn primary" onClick={() => openLayer({ kind: 'booking' })}>
          <Icon name="plus" />
          New booking
        </button>
        <button className="btn ghost" onClick={() => openLayer({ kind: 'settings' })}>
          <Icon name="refresh" />
          Sheet status
        </button>
      </PageHead>

      <div className="grid g4">
        <StatCard cls="hi" title="Occupancy" go="rooms" onGo={go} foot={<><span className="chip">{c.occupied} of {n} rooms</span> <span>{yPts === 0 ? 'Same as yesterday' : `${Math.abs(yPts)} pts ${yPts > 0 ? 'above' : 'below'} yesterday`}</span></>}>
          <CountUp value={occ} />
          <small>%</small>
        </StatCard>
        <StatCard title="Arrivals today" go="bookings" onGo={go} foot={<span className={`chip ${arrLeft ? 'warn' : 'good'}`}>{arrLeft ? `${arrLeft} still to arrive` : arr.length ? 'All arrived' : 'None expected'}</span>}>
          <CountUp value={arr.length} />
        </StatCard>
        <StatCard title="Departures today" go="bookings" onGo={go} foot={<span className={`chip ${depLeft ? 'warn' : 'good'}`}>{depLeft ? `${depLeft} yet to check out` : dep.length ? 'All checked out' : 'None due'}</span>}>
          <CountUp value={dep.length} />
        </StatCard>
        <StatCard title="Room revenue today" go="analytics" onGo={go} foot={<span className={`chip ${revDelta === null ? '' : revDelta >= 0 ? 'good' : 'warn'}`}>{revDelta === null ? `No sales last ${dayName}` : `${Math.abs(revDelta)}% ${revDelta >= 0 ? 'above' : 'below'} last ${dayName}`}</span>}>
          <span className="num">{inr(rev)}</span>
        </StatCard>
      </div>

      <div className="grid r2">
        <section className="card anim" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-h">
            <div>
              <h3>Occupancy this week</h3>
              <p className="sub">Rooms sold per night · hatched bars are forecast from reservations</p>
            </div>
          </div>
          <div className="wk">
            {days.map((d, i) => {
              const fc = i > dow;
              const isToday = i === dow;
              const tip = `${d.pct}% ${fc ? 'forecast' : isToday ? 'now' : 'actual'}`;
              return (
                <div key={d.date}>
                  <div className="col-h">
                    <button
                      className={`bar${fc ? ' fc' : ''}${isToday ? ' today' : ''}${i === peak && d.pct > 0 ? ' peak' : ''}`}
                      style={cssVars({ '--h': `${d.pct}%`, '--c1': i % 2 ? '#9aa9e0' : '#68b3ac', '--c2': i % 2 ? '#6f84c9' : '#3f8a8a' })}
                      aria-label={`${weekday(d.date)} ${tip}`}
                    >
                      <span className="tip num">{tip}</span>
                    </button>
                  </div>
                  <span className={`dl${isToday ? ' on' : ''}`}>{'MTWTFSS'[i]}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card anim">
          {next ? (
            <div className="next">
              <div className="card-h" style={{ marginBottom: 0 }}>
                <h3>Next arrival</h3>
                <span className="chip info">{next.source}</span>
              </div>
              <h4>
                {next.guest}
                <br />
                <span style={{ color: 'var(--muted)', fontSize: 16 }}>Room {next.room}{room ? ` · ${room.type}` : ''}</span>
              </h4>
              <p>
                {next.eta ? `Expected ${next.eta} · ` : ''}{plural(next.nights, 'night')}
                <br />
                {next.etaMin !== null ? `${when} · ` : ''}{plural(next.people, 'guest')}
              </p>
              <div className="grow" />
              <button className="btn primary" onClick={() => void setStage(next.id, 'in')}>
                <Icon name="check" />
                Start check-in
              </button>
            </div>
          ) : (
            <div className="next">
              <h3>Next arrival</h3>
              <p className="empty">Nobody else is due today. New walk-ins can be added with a new booking.</p>
              <div className="grow" />
              <button className="btn soft" onClick={() => openLayer({ kind: 'booking' })}>
                <Icon name="plus" />
                New booking
              </button>
            </div>
          )}
        </section>

        <section className="card anim">
          <div className="card-h">
            <div>
              <h3>Room status</h3>
              <p className="sub">{n} rooms on {new Set(rooms.map((r) => r.floor)).size} floors</p>
            </div>
          </div>
          <div className="seg">
            {states.map((k) => (
              <i key={k} style={{ flex: c[k], background: ROOM_COLOR[k] }} title={`${ROOM_STATE_LABEL[k]} ${c[k]}`} />
            ))}
          </div>
          <div className="cnt">
            {states.map((k) => (
              <div key={k}>
                <i className="dotc" style={{ background: ROOM_COLOR[k] }} />
                {ROOM_STATE_LABEL[k]}
                <b className="num">{c[k]}</b>
              </div>
            ))}
          </div>
          <div className="list">
            {attention.length ? (
              attention.map((r) => (
                <div className="row" key={r.no}>
                  <i className="dotc" style={{ background: ROOM_COLOR[r.manual] }} />
                  <div className="t">
                    <b>Room {r.no} · {r.type}</b>
                    <small>{r.manual === 'cleaning' ? 'Waiting for housekeeping' : 'Under maintenance'}</small>
                  </div>
                  <button className="btn soft sm" onClick={() => void setRoom(r.no, 'available')}>
                    {r.manual === 'cleaning' ? 'Mark ready' : 'In service'}
                  </button>
                </div>
              ))
            ) : (
              <p className="empty">Every room is ready for guests.</p>
            )}
          </div>
        </section>
      </div>

      <div className="grid r3">
        <section className="card anim">
          <div className="card-h">
            <div>
              <h3>Room revenue</h3>
              <p className="sub">Last 14 days · today is in progress</p>
            </div>
          </div>
          <LineChart vals={series.vals} labels={series.labels} h={268} label="Room revenue, last 14 days" />
        </section>

        <section className="card anim">
          <div className="tabs" role="tablist">
            <button className={`tab${ui.mov === 'arr' ? ' on' : ''}`} role="tab" onClick={() => setUi({ mov: 'arr' })}>
              Arrivals <span className="chip num">{arr.length}</span>
            </button>
            <button className={`tab${ui.mov === 'dep' ? ' on' : ''}`} role="tab" onClick={() => setUi({ mov: 'dep' })}>
              Departures <span className="chip num">{dep.length}</span>
            </button>
          </div>
          <div className="list" style={{ maxHeight: 290 }}>
            {list.length ? (
              list.map((b) => {
                const arrivals = ui.mov === 'arr';
                const done = arrivals ? b.stage === 'in' : b.stage === 'out';
                const r = rooms.find((x) => x.no === b.room);
                const overdue = !arrivals && b.stage === 'in' && b.co < today;
                return (
                  <div className="row" key={b.id}>
                    <Avatar name={b.guest} />
                    <div className="t">
                      <b>{b.guest}</b>
                      <small>
                        Room {b.room}{r ? ` · ${r.type}` : ''} · {arrivals ? (b.eta ? `ETA ${b.eta}` : 'No ETA') : overdue ? 'overdue' : 'by 11:00 AM'}
                      </small>
                    </div>
                    <PayChip b={b} />
                    {done ? (
                      <span className="chip good">
                        <Icon name="check" size={12} />
                        {arrivals ? 'In house' : 'Done'}
                      </span>
                    ) : (
                      <button className="btn primary sm" onClick={() => void setStage(b.id, arrivals ? 'in' : 'out')}>
                        {arrivals ? 'Check in' : 'Check out'}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="empty">Nothing scheduled.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
