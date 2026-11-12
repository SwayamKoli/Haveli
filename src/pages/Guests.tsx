import { fmtD, inr, mobileFmt } from '../lib/format';
import { guestSummaries } from '../lib/selectors';
import { useStore } from '../store';
import { Avatar, Icon, PageHead } from '../ui';

const STATUS: Record<string, { label: string; cls: string }> = {
  in: { label: 'In house', cls: 'acc' },
  upcoming: { label: 'Upcoming', cls: 'info' },
  past: { label: 'Past guest', cls: '' },
  none: { label: 'No stays', cls: '' },
};

export function Guests() {
  const { data, ui, setUi, openLayer } = useStore();
  const q = ui.gq.trim().toLowerCase();
  const all = guestSummaries(data);
  const list = all.filter(
    (g) => !q || g.name.toLowerCase().includes(q) || g.mobile.includes(q) || g.city.toLowerCase().includes(q) || g.rooms.some((r) => String(r).includes(q)),
  );

  return (
    <>
      <PageHead title="Guests" sub={`${all.length} guests · most recent stays first`}>
        <button className="btn primary" onClick={() => openLayer({ kind: 'booking' })}>
          <Icon name="plus" />
          New booking
        </button>
      </PageHead>
      <div className="bar-tools anim">
        <div className="field">
          <Icon name="search" size={16} />
          <input id="gq" type="search" placeholder="Search name, mobile, city or room" aria-label="Search guests" value={ui.gq} onChange={(e) => setUi({ gq: e.target.value })} />
        </div>
      </div>
      <div className="anim">
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Guest</th><th>Mobile</th><th>City</th><th>Stays</th><th>Last stay</th><th>Billed</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.length ? (
                list.map((g) => (
                  <tr key={g.key}>
                    <td>
                      <div className="who">
                        <Avatar name={g.name} />
                        <div>
                          <b>{g.name}</b>
                          <small>{g.id || 'Not in Guests tab'}</small>
                        </div>
                      </div>
                    </td>
                    <td className="num">{mobileFmt(g.mobile)}</td>
                    <td>{g.city || '—'}</td>
                    <td className="num">{g.stays}</td>
                    <td className="num">{g.last ? fmtD(g.last) : '—'}</td>
                    <td className="num">
                      {inr(g.billed)}
                      {g.due > 0 && <small style={{ display: 'block', color: 'var(--warn)' }}>{inr(g.due)} due</small>}
                    </td>
                    <td><span className={`chip ${STATUS[g.status].cls}`}>{STATUS[g.status].label}</span></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty">{all.length ? 'No guests match your search.' : 'No guests yet. They appear here when you create a booking.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
