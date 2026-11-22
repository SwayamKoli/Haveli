/**
 * Taking a payment or a refund on a booking.
 */
import { useState, type FormEvent } from 'react';
import { PAY_METHODS } from '../../../shared/constants';
import { planPayment, roomsLabel } from '../../../shared/rules';
import { Icon } from '../../components/Icon';
import { Field, Layer } from '../../components/Layer';
import { inr } from '../../lib/format';
import { useStore } from '../../state/store';

export function PaymentModal({ id }: { id: string }) {
  const { data, closeLayer, recordPayment } = useStore();
  const b = data.bookings.find((x) => x.id === id);
  const [refund, setRefund] = useState(false);
  const [amount, setAmount] = useState(b ? String(Math.max(0, b.balance)) : '');
  const [method, setMethod] = useState(PAY_METHODS[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!b) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !b) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return setError('Enter a whole-rupee amount above zero.');
    const signed = refund ? -n : n;
    const plan = planPayment(b, signed, method, note);
    if (!plan.ok) return setError(plan.error);
    setBusy(true);
    const r = await recordPayment(b.id, signed, method, note.trim());
    setBusy(false);
    if (r.ok) closeLayer();
    else setError(r.error);
  }

  return (
    <Layer onClose={closeLayer}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="mt" noValidate onSubmit={submit}>
        <div className="mh">
          <div>
            <h2 id="mt">{refund ? 'Give money back' : 'Record payment'}</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>{b.guest} · {b.rooms.length > 1 ? 'rooms' : 'room'} {roomsLabel(b.rooms)} · {b.id}</p>
          </div>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="kv" style={{ marginBottom: 16 }}>
          <div><small>Amount to pay{b.discount > 0 ? ' (after discount)' : ''}</small><b className="num">{inr(b.total)}</b></div>
          <div><small>Paid</small><b className="num">{inr(b.paid)}</b></div>
          <div><small>Due</small><b className="num">{inr(b.balance)}</b></div>
        </div>
        <div className="tabs2" role="tablist">
          <button type="button" role="tab" aria-selected={!refund} className={!refund ? 'on' : ''} onClick={() => { setRefund(false); setError(''); setAmount(String(Math.max(0, b.balance))); }}>Money received</button>
          <button type="button" role="tab" aria-selected={refund} className={refund ? 'on' : ''} onClick={() => { setRefund(true); setError(''); setAmount(''); }} disabled={b.paid <= 0}>Refund</button>
        </div>
        <div className="form">
          <Field id="p_amt" label={refund ? 'Amount given back (₹)' : 'Amount received (₹)'} error={error}>
            <input id="p_amt" type="number" min={1} step={1} value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} />
          </Field>
          <Field id="p_meth" label={refund ? 'Returned by' : 'Paid by'}>
            <select id="p_meth" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field id="p_note" label={refund ? 'Reason (required)' : 'Note (optional)'} full>
            <input id="p_note" autoComplete="off" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder={refund ? 'e.g. Left a day early' : ''} />
          </Field>
        </div>
        <div className="mf">
          <button type="button" className="btn soft" onClick={closeLayer}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}><Icon name="check" />{busy ? 'Saving…' : refund ? 'Record refund' : 'Record payment'}</button>
        </div>
      </form>
    </Layer>
  );
}
