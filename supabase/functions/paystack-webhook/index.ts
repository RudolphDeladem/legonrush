// paystack-webhook: Paystack calls this when money moves. Deploy with --no-verify-jwt (Paystack has no
// Supabase sign-in); every call is checked with the x-paystack-signature header instead.
//   charge.success                   -> the coin purchase is marked paid (the game adds the coins next time it asks)
//   transfer.success                 -> a cash-out reached the rider's Mobile Money
//   transfer.failed / .reversed      -> the cash-out failed: the money goes back to the rider's wallet
// Every step is safe to repeat: Paystack may send the same event more than once.
import { db, json } from '../_shared/http.ts';
import { validSignature } from '../_shared/paystack.ts';

interface Event {
  event: string;
  data: {
    id?: number;
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    channel?: string;
    transfer_code?: string;
    reason?: string;
    gateway_response?: string;
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const raw = await req.text();
  if (raw.length > 200_000 || !(await validSignature(raw, req.headers.get('x-paystack-signature')))) {
    return json({ ok: false, error: 'bad signature' }, 401);
  }
  let ev: Event;
  try {
    ev = JSON.parse(raw);
  } catch {
    return json({ ok: false }, 400);
  }
  const ref = ev.data?.reference ?? '';
  try {
    if (ev.event === 'charge.success' && ref && ev.data.status === 'success') {
      const r = await db.rpc<string>('mark_purchase_paid', {
        p_reference: ref,
        p_amount: ev.data.amount ?? 0,
        p_currency: ev.data.currency ?? '',
        p_paystack_id: ev.data.id ?? null,
        p_channel: ev.data.channel ?? null,
      });
      console.log('charge.success', ref, r);
    } else if (ev.event === 'transfer.success' && ref) {
      console.log('transfer.success', ref, await db.rpc('settle_payout', { p_reference: ref, p_status: 'sent', p_reason: null, p_transfer_code: ev.data.transfer_code ?? null }));
    } else if ((ev.event === 'transfer.failed' || ev.event === 'transfer.reversed') && ref) {
      const why = ev.data.reason || ev.data.gateway_response || ev.event;
      console.log(ev.event, ref, await db.rpc('settle_payout', { p_reference: ref, p_status: 'failed', p_reason: why, p_transfer_code: ev.data.transfer_code ?? null }));
    }
  } catch (e) {
    // a 500 makes Paystack retry later, which is what we want if the database hiccuped
    console.error(e);
    return json({ ok: false }, 500);
  }
  return json({ ok: true });
});
