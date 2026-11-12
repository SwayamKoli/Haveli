import { useState } from 'react';
import type { DragEvent } from 'react';
import { SOURCES, STAGES, STAGE_LABEL } from '../../shared/constants';
import type { Booking, Stage } from '../../shared/types';
import { fmtD, inr, plural, rel } from '../lib/format';
import { daysFrom } from '../lib/selectors';
import { useStore } from '../store';
import { Avatar, Icon, PageHead, PayChip, STAGE_COLOR, StageChip } from '../ui';

function Card({ b, today, onDragging }: { b: Booking; today: string; onDragging: (id: string | null) => void }) {
  const { data, setMenu } = useStore();
  const room = data.rooms.find((r) => r.no === b.room);
  const when = b.stage === 'in' ? `out ${rel(daysFrom(today, b.co))}` : b.stage === 'out' ? `left ${rel(daysFrom(today, b.co))}` : `arrives ${rel(daysFrom(today, b.ci))}`;
  const [dragging, setDragging] = useState(false);
  return (
    <article
      className={`kcard${b.stage === 'cancelled' ? ' cancelled-card' : ''}${dragging ? ' drag' : ''}`}
      draggable
      data-id={b.id}
      onDragStart={(e: DragEvent) => {
        setDragging(true);
        onDragging(b.id);
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', b.id);
        } catch {
          /* some browsers refuse */
        }
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragging(null);
      }}
    >
      <div className="k-top">
        <span>
          <i className="dotc" style={{ background: STAGE_COLOR[b.stage] }} />
          {room?.type ?? 'Room'} · {b.source}
        </span>
        <button
          className="more"
          aria-label={`Move ${b.guest} to another stage`}
          onClick={(e) => {
            e.stopPropagation();
            setMenu({ id: b.id, rect: e.currentTarget.getBoundingClientRect() });
          }}
        >
          <Icon name="more" size={16} />
        </button>
      </div>
      <h4>{b.guest}</h4>
      <p className="ks">Room {b.room} · {plural(b.nights, 'night')} · {inr(b.total)}</p>
      <div className="k-foot">
        <span className="chip">
          <Icon name="clock" size={12} />
          {when}
        </span>
        <PayChip b={b} />
        <Avatar name={b.guest} />
      </div>
    </article>
  );
}

export function Bookings() {
  const { data, ui, setUi, openLayer, setStage, setMenu } = useStore();
  const { bookings, rooms, today } = data;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);

  const q = ui.bq.trim().toLowerCase();
  const list = bookings.filter(
    (b) =>
      (ui.bsrc === 'All' || b.source === ui.bsrc) &&
      (!q || b.guest.toLowerCase().includes(q) || String(b.room).includes(q) || b.mobile.includes(q) || b.id.toLowerCase().includes(q)),
  );
  const active = bookings.filter((b) => b.stage === 'reserved' || b.stage === 'in').length;
  const sources = Array.from(new Set(['All', ...SOURCES, ...bookings.map((b) => b.source)]));

  return (
    <>
      <PageHead title="Bookings" sub={`${plural(active, 'active booking')} · drag a card to change its stage`}>
        <button className="btn primary" onClick={() => openLayer({ kind: 'booking' })}>
          <Icon name="plus" />
          New booking
        </button>
      </PageHead>

      <div className="tabs anim">
        {(['board', 'list'] as const).map((v) => (
          <button key={v} className={`tab${ui.bview === v ? ' on' : ''}`} onClick={() => setUi({ bview: v })}>
            {v === 'board' ? 'Board' : 'List'}
          </button>
        ))}
      </div>
      <div className="bar-tools anim">
        <div className="field">
          <Icon name="search" size={16} />
          <input id="bq" type="search" placeholder="Search guest, room or booking ID" aria-label="Search bookings" value={ui.bq} onChange={(e) => setUi({ bq: e.target.value })} />
        </div>
        <div className="fchips">
          {sources.map((s) => (
            <button key={s} className={`fchip${ui.bsrc === s ? ' on' : ''}`} onClick={() => setUi({ bsrc: s })}>
              {s === 'All' ? 'All sources' : s}
            </button>
          ))}
        </div>
      </div>

      <div className="anim">
        {ui.bview === 'board' ? (
          <div className="board">
            {STAGES.map((s) => {
              const items = list.filter((b) => b.stage === s);
              const sum = items.reduce((a, b) => a + b.total, 0);
              return (
                <section
                  key={s}
                  className={`kcol${over === s && dragId ? ' over' : ''}`}
                  data-stage={s}
                  aria-label={STAGE_LABEL[s]}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setOver(s);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === s ? null : o));
                  }}
                  onDrop={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    const id = dragId;
                    setOver(null);
                    setDragId(null);
                    void setStage(id, s);
                  }}
                >
                  <div className="kh">
                    <i className="dotc" style={{ background: STAGE_COLOR[s] }} />
                    <h3>{STAGE_LABEL[s]}</h3>
                    <span className="chip num">{items.length}</span>
                    <span className="sp" />
                    <small className="num">{inr(sum)}</small>
                    {s === 'reserved' && (
                      <button className="more" aria-label="New booking" onClick={() => openLayer({ kind: 'booking' })}>
                        <Icon name="plus" size={16} />
                      </button>
                    )}
                  </div>
                  {items.length ? items.map((b) => <Card key={b.id} b={b} today={today} onDragging={setDragId} />) : <p className="empty" style={{ padding: '10px 6px' }}>Drop a booking here.</p>}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Booking</th><th>Guest</th><th>Room</th><th>Stay</th><th>Amount</th><th>Payment</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {list.length ? (
                  [...list].sort((a, b) => b.ci.localeCompare(a.ci)).map((b) => {
                    const room = rooms.find((r) => r.no === b.room);
                    return (
                      <tr key={b.id}>
                        <td className="num">{b.id}</td>
                        <td>
                          <div className="who">
                            <Avatar name={b.guest} />
                            <div>
                              <b>{b.guest}</b>
                              <small>{b.source}</small>
                            </div>
                          </div>
                        </td>
                        <td>{b.room}{room ? ` · ${room.type}` : ''}</td>
                        <td className="num">{fmtD(b.ci)} → {fmtD(b.co)}</td>
                        <td className="num">{inr(b.total)}</td>
                        <td><PayChip b={b} /></td>
                        <td><StageChip stage={b.stage} /></td>
                        <td>
                          <button className="more" aria-label="Change stage" onClick={(e) => setMenu({ id: b.id, rect: e.currentTarget.getBoundingClientRect() })}>
                            <Icon name="more" size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="empty">{bookings.length ? 'No bookings match your search.' : 'No bookings yet. Use “New booking” to add the first one.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
