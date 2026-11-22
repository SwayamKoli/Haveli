/**
 * My account: name, role and changing my own password.
 */
import { Avatar } from '../../components/Chips';
import { Icon } from '../../components/Icon';
import { useStore } from '../../state/store';

export function Account() {
  const { staff, openLayer, hotel, backend } = useStore();
  if (!staff) return null;
  return (
    <section className="card anim">
      <div className="card-h">
        <div>
          <h3>My account</h3>
          <p className="sub">{hotel}</p>
        </div>
      </div>
      <div className="who" style={{ marginBottom: 14 }}>
        <Avatar name={staff.name} />
        <div>
          <b>{staff.name}</b>
          <small>{staff.role} · username “{staff.username}”</small>
        </div>
      </div>
      {staff.viaOwner && <p className="note" role="note">You are signed in to this account with the owner password. Bookings you save are marked with this employee’s name.</p>}
      {!staff.owner && !staff.viaOwner && <p className="sub" style={{ color: 'var(--muted)', marginBottom: 12 }}>Forgot your password? Ask the owner to set a new one. There is no self-service reset.</p>}
      <div className="stack">
        {backend.mode === 'live' && (
          <button className="btn soft" onClick={() => openLayer({ kind: 'confirm-logout' })}>
            <Icon name="out" />
            Sign out
          </button>
        )}
      </div>
    </section>
  );
}
