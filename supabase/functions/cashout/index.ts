// cashout: a rider's prize wallet and cash-outs to Mobile Money.
//   GET  (signed in)                                   -> { balance, min, mode, history, payouts }
//   POST (signed in) { amount, network, number, name, adult } -> takes the amount out of the wallet and
//        either sends it straight away with a Paystack transfer (CASHOUT_MODE=auto) or leaves it
//        waiting for the owner to approve (CASHOUT_MODE=manual, the default).
//   POST (owner, x-admin-secret header) { approve: reference } -> sends a waiting cash-out with Paystack
//   POST (owner, x-admin-secret header) { reject: reference, reason } -> cancels it; money back to the wallet
// Only prize money is in a wallet. Bought coins are never cashed out.
import { body, db, env, fail, isAdmin, json, newReference, preflight, user } from '../_shared/http.ts';
import { NETWORKS, paystack, paystackReady } from '../_shared/paystack.ts';

interface Req {
  amount?: number;
  network?: string;
  number?: string;
  name?: string;
  adult?: boolean;
  approve?: string;
  reject?: string;
  reason?: string;
}

interface Payout {
  id: number;
  user_id: string;
  amount_pesewas: number;
  network: string;
  momo_number: string;
  account_name: string | null;
  status: string;
  reference: string;
}

const minPesewas = () => Math.max(100, Math.round(Number(env('CASHOUT_MIN_GHS', '10')) * 100) || 1000);
const mode = () => (env('CASHOUT_MODE', 'manual') === 'auto' ? 'auto' : 'manual');

/** '024 123 4567', '+233 24 123 4567' and '233241234567' all become '0241234567' */
export function momoNumber(s: string) {
  const digits = String(s ?? '').replace(/[^0-9]/g, '');
  const local = digits.startsWith('233') ? '0' + digits.slice(3) : digits;
  return /^0[25][0-9]{8}$/.test(local) ? local : null;
}

/** Sends a recorded cash-out with Paystack: recipient, then transfer. Settles it as processing, sent or failed. */
async function send(p: Payout) {
  const net = NETWORKS[p.network];
  const rec = await paystack<{ recipient_code: string }>('/transferrecipient', {
    type: 'mobile_money',
    name: p.account_name || 'LEGONRUSH rider',
    account_number: p.momo_number,
    bank_code: net.bankCode,
    currency: 'GHS',
  });
  if (!rec.status || !rec.data?.recipient_code) {
    await db.rpc('settle_payout', { p_reference: p.reference, p_status: 'failed', p_reason: rec.message || 'recipient' });
    return { status: 'failed', message: 'That Mobile Money number was not accepted. Check the number and network.' };
  }
  const tr = await paystack<{ status: string; transfer_code: string }>('/transfer', {
    source: 'balance',
    amount: p.amount_pesewas,
    recipient: rec.data.recipient_code,
    reference: p.reference,
    currency: 'GHS',
    reason: 'LEGONRUSH prize',
  });
  if (!tr.status) {
    await db.rpc('settle_payout', { p_reference: p.reference, p_status: 'failed', p_reason: tr.message || 'transfer' });
    return { status: 'failed', message: 'The cash-out could not be sent right now. Your money is back in your wallet.' };
  }
  const done = tr.data?.status === 'success';
  await db.rpc('settle_payout', { p_reference: p.reference, p_status: done ? 'sent' : 'processing', p_reason: null, p_transfer_code: tr.data?.transfer_code ?? null, p_recipient: rec.data.recipient_code });
  return { status: done ? 'sent' : 'processing', message: done ? 'Sent to your Mobile Money.' : 'On its way to your Mobile Money.' };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    // ----- the owner approving or rejecting a waiting cash-out -----
    if (req.method === 'POST' && req.headers.get('x-admin-secret')) {
      if (!isAdmin(req)) return fail('admin', 'Wrong admin secret.', 403);
      const b = await body<Req>(req);
      const ref = b?.approve ?? b?.reject;
      if (!ref) return fail('bad_request', 'Send { "approve": "<reference>" } or { "reject": "<reference>", "reason": "..." }.');
      const [p] = await db.select<Payout>('payouts', `reference=eq.${encodeURIComponent(ref)}&select=*`);
      if (!p || p.status !== 'pending') return fail('state', 'No waiting cash-out with that reference.', 404);
      if (b?.reject) {
        await db.rpc('settle_payout', { p_reference: p.reference, p_status: 'failed', p_reason: b.reason || 'Rejected by LEGONRUSH' });
        return json({ ok: true, status: 'failed' });
      }
      if (!paystackReady()) return fail('not_ready', 'PAYSTACK_SECRET_KEY is not set. Pay it by hand, then mark it sent in the SQL editor.', 503);
      return json({ ok: true, ...(await send(p)) });
    }

    const me = await user(req);
    if (!me) return fail('sign_in', 'Sign in to see your wallet.', 401);

    if (req.method === 'GET') {
      const [w] = await db.select<{ balance_pesewas: number }>('wallets', `user_id=eq.${me.id}&select=balance_pesewas`);
      const history = await db.select('wallet_ledger', `user_id=eq.${me.id}&select=amount_pesewas,kind,note,created_at&order=created_at.desc&limit=30`);
      const payouts = await db.select('payouts', `user_id=eq.${me.id}&select=amount_pesewas,network,momo_number,status,failure_reason,created_at,reference&order=created_at.desc&limit=10`);
      return json({ ok: true, balance: Number(w?.balance_pesewas ?? 0), min: minPesewas(), mode: mode(), history, payouts });
    }
    if (req.method !== 'POST') return fail('method', 'Use GET or POST.', 405);

    const b = await body<Req>(req);
    if (!b) return fail('bad_request', 'Bad request.');
    const amount = Math.round(Number(b.amount));
    const number = momoNumber(b.number ?? '');
    const name = String(b.name ?? '').trim().slice(0, 60);
    if (!Number.isFinite(amount) || amount <= 0) return fail('amount', 'Enter an amount.');
    if (!b.network || !NETWORKS[b.network]) return fail('network', 'Choose your Mobile Money network.');
    if (!number) return fail('number', 'Enter a Ghana Mobile Money number, like 024 123 4567.');
    if (name.length < 3) return fail('name', 'Enter the name on the Mobile Money account.');
    if (b.adult !== true) return fail('adult', 'Confirm you are 18 or older, or that a parent or guardian agrees.');
    if (mode() === 'auto' && !paystackReady()) return fail('not_ready', 'Cash-outs are coming soon.', 503);

    const reference = newReference('po');
    const [r] = await db.rpc<{ ok: boolean; message: string; payout_id: number }[]>('request_cashout', {
      p_user: me.id, p_amount: amount, p_network: b.network, p_number: number, p_name: name, p_reference: reference, p_min: minPesewas(), p_status: 'pending',
    });
    if (!r?.ok) {
      const why: Record<string, string> = {
        below_min: `The smallest cash-out is GHS ${(minPesewas() / 100).toFixed(2)}.`,
        not_enough: 'You don\'t have that much in your wallet.',
        one_pending: 'You already have a cash-out on its way. Wait for it to finish.',
      };
      return fail(r?.message ?? 'server', why[r?.message ?? ''] ?? 'Something went wrong.', 400);
    }
    if (mode() === 'manual') {
      return json({ ok: true, status: 'pending', reference, message: 'Request received. LEGONRUSH checks prize cash-outs by hand, usually within 2 working days.' });
    }
    const out = await send({ id: r.payout_id, user_id: me.id, amount_pesewas: amount, network: b.network, momo_number: number, account_name: name, status: 'pending', reference });
    return out.status === 'failed' ? fail('transfer', out.message, 502) : json({ ok: true, reference, ...out });
  } catch (e) {
    console.error(e);
    return fail('server', 'Something went wrong. Try again in a minute.', 500);
  }
});
