// paystack-init: the coin shop.
//   GET                      -> { enabled, test, bundles }  (no sign-in needed)
//   POST { bundle, return_to } -> starts a Paystack checkout, returns { authorization_url, reference }
//   POST { verify: ref }     -> asks Paystack about a checkout (for when the rider returns before the webhook)
//   POST { claim: true }     -> hands over coins from confirmed payments not yet added to the game, once each
// Coins are only ever granted for payments Paystack itself confirmed (here or in paystack-webhook).
import { body, db, env, fail, json, newReference, preflight, user } from '../_shared/http.ts';
import { BUNDLES, paystack, paystackReady, paystackTest } from '../_shared/paystack.ts';

interface Req {
  bundle?: string;
  verify?: string;
  claim?: boolean;
  return_to?: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method === 'GET') return json({ ok: true, enabled: paystackReady(), test: paystackTest(), bundles: BUNDLES });
  if (req.method !== 'POST') return fail('method', 'Use GET or POST.', 405);
  if (!paystackReady()) return fail('not_ready', 'Coin bundles are coming soon.', 503);

  const me = await user(req);
  if (!me) return fail('sign_in', 'Sign in to buy coins.', 401);
  const b = await body<Req>(req);
  if (!b) return fail('bad_request', 'Bad request.');

  try {
    if (b.claim) {
      // one UPDATE: only rows still unclaimed change and come back, so coins are never handed out twice
      const claimed = await db.update<{ reference: string; coins: number }>(
        'coin_purchases',
        `user_id=eq.${me.id}&status=eq.paid&claimed_at=is.null&select=reference,coins`,
        { claimed_at: new Date().toISOString() },
      );
      return json({ ok: true, coins: claimed.reduce((s, r) => s + r.coins, 0), references: claimed.map((r) => r.reference) });
    }

    if (b.verify) {
      const ref = String(b.verify).slice(0, 80);
      const [row] = await db.select<{ user_id: string; status: string }>('coin_purchases', `reference=eq.${encodeURIComponent(ref)}&select=user_id,status`);
      if (!row || row.user_id !== me.id) return fail('unknown', 'We could not find that payment.', 404);
      if (row.status === 'paid') return json({ ok: true, status: 'paid' });
      const v = await paystack<{ status: string; amount: number; currency: string; id: number; channel: string }>(`/transaction/verify/${encodeURIComponent(ref)}`);
      if (v.status && v.data?.status === 'success') {
        const r = await db.rpc<string>('mark_purchase_paid', { p_reference: ref, p_amount: v.data.amount, p_currency: v.data.currency, p_paystack_id: v.data.id, p_channel: v.data.channel });
        return json({ ok: true, status: r === 'paid' || r === 'already' ? 'paid' : 'failed' });
      }
      if (v.data?.status === 'failed' || v.data?.status === 'abandoned') {
        await db.update('coin_purchases', `reference=eq.${encodeURIComponent(ref)}&status=eq.pending`, { status: 'failed' });
        return json({ ok: true, status: 'failed' });
      }
      return json({ ok: true, status: 'pending' });
    }

    const bundle = BUNDLES.find((x) => x.id === b.bundle);
    if (!bundle) return fail('bundle', 'That bundle is not on sale.');
    if (!me.email) return fail('email', 'Your account needs an email address to pay.');
    // a little brake on someone hammering the button
    const recent = await db.select('coin_purchases', `user_id=eq.${me.id}&created_at=gte.${new Date(Date.now() - 3600e3).toISOString()}&select=id`);
    if (recent.length >= 15) return fail('rate', 'Too many checkouts in an hour. Try again later.', 429);

    // back to the game after paying: APP_URL if the owner set it, else the page the rider came from
    const from = String(b.return_to ?? '');
    const appUrl = env('APP_URL') || (/^(https:\/\/[^\s]+|http:\/\/localhost(:\d+)?\/[^\s]*)$/.test(from) ? from.slice(0, 200) : '');
    if (!appUrl) return fail('config', 'Payments are not set up yet (APP_URL).', 503);
    const reference = newReference('lr');
    await db.insert('coin_purchases', { user_id: me.id, reference, bundle_id: bundle.id, coins: bundle.coins, amount_pesewas: bundle.price, currency: 'GHS' });
    const init = await paystack<{ authorization_url: string; reference: string }>('/transaction/initialize', {
      email: me.email,
      amount: bundle.price,
      currency: 'GHS',
      reference,
      callback_url: `${appUrl}${appUrl.includes('?') ? '&' : '?'}paid=1`,
      channels: ['mobile_money', 'card'],
      metadata: { user_id: me.id, bundle: bundle.id, coins: bundle.coins, custom_fields: [{ display_name: 'Rush Coins', variable_name: 'coins', value: String(bundle.coins) }] },
    });
    if (!init.status || !init.data?.authorization_url) {
      await db.update('coin_purchases', `reference=eq.${reference}`, { status: 'failed' });
      return fail('paystack', 'Payments are not available right now. Try again later.', 502);
    }
    return json({ ok: true, authorization_url: init.data.authorization_url, reference });
  } catch (e) {
    console.error(e);
    return fail('server', 'Something went wrong. Try again in a minute.', 500);
  }
});
