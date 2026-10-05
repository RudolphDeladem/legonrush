# Switching on money in LEGONRUSH

This folder holds the server side of three features:

- **Buy coins**: players pay with Mobile Money (MTN, Telecel, AirtelTigo) or a card through **Paystack**, and get Rush Coins.
- **Weekly prize race**: free to enter. Each week the fastest riders on one race win cash prizes that you (and sponsors) pay for.
- **Wallet**: prize winners cash out their prize money to their Mobile Money.

Until you finish these steps, the game shows **"Coming soon"** on all three screens. Nothing breaks.

> **The rules we chose, to keep the legal risk low.** Prize races are free to enter, and bought coins never help in them
> (everyone rides the same City bike with no upgrades). Bought coins have **no cash value** and can never be withdrawn.
> Only prize money can be cashed out. Before you pay out real prizes, ask a Ghanaian lawyer or accountant to look over
> the terms in the game (Wallet > *Prize and payment terms*) and whether you need to register the promotion or deduct tax.

---

## What lives where

| Piece | What it does |
|---|---|
| `supabase/schema.sql` | The tables (purchases, wallets, prize races, results, cash-outs) and their safety rules. |
| `paystack-init` | Shows the coin bundles, opens a Paystack checkout, checks a payment, hands the coins to the game. |
| `paystack-webhook` | Paystack tells us here when a payment or a cash-out succeeds or fails. |
| `submit-run` | This week's prize race and leaderboard; checks each prize result against the ride recording (anti-cheat). |
| `cashout` | A rider's wallet and cash-outs to Mobile Money (you approve them by hand unless you switch on automatic). |
| `close-week` | Your weekly job: closes last week's race, pays the winners' wallets, starts this week's race. |
| `_shared/` | Code the functions share. `_shared/paystack.ts` has the **coin bundle prices**. `_shared/runcheck.ts` has the anti-cheat limits. |

Prices are set on the server only (`_shared/paystack.ts`):

| Bundle | Coins | Price |
|---|---|---|
| Pocket | 500 | GHS 5 |
| Saddle bag | 1,200 | GHS 10 |
| Backpack | 3,000 | GHS 20 |
| Treasure chest | 8,000 | GHS 50 |

---

## Step 1. Make a Paystack business account

1. Go to **paystack.com**, click **Create a free account**, choose **Ghana**.
2. Fill in your business details. Paystack asks for ID and business documents before you can take **live** payments. You can do everything below in **Test mode** while you wait.
3. In the Paystack dashboard go to **Settings > API Keys & Webhooks**. You will see two pairs of keys:
   - **Test** keys: `pk_test_...` (public) and `sk_test_...` (secret). Use these first: no real money moves.
   - **Live** keys: `pk_live_...` and `sk_live_...`. Only after testing works.

**Never** paste the **secret** key (`sk_...`) into the game's code, a chat or an email. It only goes into Supabase (step 3).

## Step 2. Update the database

1. Open your Supabase project (`lgzkfgpopofabmjlxxli`) > **SQL Editor** > **New query**.
2. Paste the whole of `supabase/schema.sql` and press **Run**. It is safe to run again; it only adds what is missing.

## Step 3. Put the secrets in Supabase

Supabase dashboard > **Edge Functions** > **Secrets** (or **Project Settings > Edge Functions**). Add these:

| Name | Value | Needed? |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | your `sk_test_...` key (later `sk_live_...`) | **Yes** |
| `ADMIN_SECRET` | a long random password only you know, 16+ characters (e.g. from a password manager) | **Yes** |
| `APP_URL` | the game's address, e.g. `https://YOUR-SITE.netlify.app/play/` (where players come back after paying) | Recommended |
| `CASHOUT_MODE` | `manual` (you approve each cash-out, the default) or `auto` (sent straight away) | Optional |
| `CASHOUT_MIN_GHS` | smallest cash-out in cedis, default `10` | Optional |
| `PRIZE_ROUTE` | the race used for the prize race: `engineering-run` (default), `sunset-route`, `night-circuit` or `limann-great-hall` | Optional |
| `PRIZES_GHS` | prizes for 1st, 2nd, 3rd... in cedis, default `200,100,50` | Optional |
| `PRIZE_TITLE` | default `Weekly Prize Race` | Optional |
| `PRIZE_SPONSOR` | a sponsor's name to show, e.g. `Legon Bites` | Optional |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are given to the functions automatically; you don't add them.

## Step 4. Deploy the functions

You need a computer with **Node.js** installed. In a terminal, inside the LEGONRUSH folder:

```bash
npx supabase login
npx supabase link --project-ref lgzkfgpopofabmjlxxli
npx supabase functions deploy paystack-init    --no-verify-jwt
npx supabase functions deploy paystack-webhook --no-verify-jwt
npx supabase functions deploy submit-run       --no-verify-jwt
npx supabase functions deploy cashout          --no-verify-jwt
npx supabase functions deploy close-week       --no-verify-jwt
```

(`--no-verify-jwt` is right: each function checks who is calling itself. Paystack can't sign in to Supabase, and
`close-week` uses your `ADMIN_SECRET` instead.)

You can also set the secrets from the terminal instead of step 3:

```bash
npx supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx ADMIN_SECRET=your-long-secret APP_URL=https://YOUR-SITE/play/
```

## Step 5. Tell Paystack where to send updates (webhook)

Paystack dashboard > **Settings > API Keys & Webhooks** > **Test Webhook URL** (and later **Live Webhook URL**):

```
https://lgzkfgpopofabmjlxxli.supabase.co/functions/v1/paystack-webhook
```

Save. This is how coins arrive even if a player closes the game while paying, and how failed cash-outs go back to the wallet.

## Step 6. Switch the screens on in the game

In `src/cloud-config.ts` set the **public** key (it is safe in the browser):

```ts
export const PAYSTACK_PUBLIC_KEY = 'pk_test_xxxxxxxxxxxx';
```

Rebuild and publish the game as usual (Netlify does this when the change is pushed). While a `pk_test_` key is set, the
Buy coins screen shows "Test mode: no real money is taken".

## Step 7. Start the first prize race (and every week after)

`close-week` closes races that have ended, pays the winners into their wallets and creates this week's race
(Monday 00:00 to Sunday 23:59, Ghana time). Run it once now to create the first race:

```bash
curl -X POST https://lgzkfgpopofabmjlxxli.supabase.co/functions/v1/close-week \
  -H "x-admin-secret: your-long-secret" -H "Content-Type: application/json" -d '{}'
```

Then make it run by itself every Monday: Supabase dashboard > **Integrations > Cron** > **Create job**:

- Schedule: `20 0 * * 1` (Mondays at 00:20 Ghana time)
- Type: **Supabase Edge Function**, function `close-week`, method `POST`
- Add header `x-admin-secret` = your `ADMIN_SECRET`, body `{}`

Winners see their prize in **You > Wallet** straight away.

## Step 8. Test everything in Test mode

1. Sign in to the game, tap the **coin count** at the top (or **Garage > Buy coins**), pick a bundle.
2. Paystack's test checkout opens. Choose **Mobile Money** and use Paystack's test number (shown on the checkout page,
   e.g. `0551234987` with MTN), or a test card such as `4084 0840 8408 4081`, any future date, CVV `408`.
3. You come back to the game: it says **Payment received** and the coins are added.
   In Supabase > **Table Editor > coin_purchases** the row shows `status = paid`.
4. **Prize race**: Events tab > **Weekly prize race** > **Ride the prize race**, finish it. A note says if the time was
   accepted. Check **prize_entries** (`accepted` true/false, and `reason` when false).
5. **Pay a test prize** without waiting a week (SQL Editor):
   ```sql
   select close_prize_event(id) from prize_events where status = 'open';
   ```
   Then run `close-week` again (step 7) to open a new race. The winner sees the money in **You > Wallet**.
6. **Cash out** from the Wallet. In `manual` mode it waits for you (next section).

## Paying out prizes

**You must keep money in your Paystack balance** to pay prizes: Paystack pays transfers from your balance.
Top it up from the Paystack dashboard (**Balance > Top up**), or let coin sales build it up.

### Manual mode (the default, recommended at the start)

Each cash-out waits in **Table Editor > payouts** with `status = pending`. Look at it (is the rider genuine? any reason to
suspect cheating?), then either:

- **Send it through Paystack**:
  ```bash
  curl -X POST https://lgzkfgpopofabmjlxxli.supabase.co/functions/v1/cashout \
    -H "x-admin-secret: your-long-secret" -H "Content-Type: application/json" \
    -d '{"approve": "po-xxxxxxxx"}'
  ```
  (`po-...` is the payout's `reference` column.)
- **Pay it yourself** from your own MoMo, then mark it sent in the SQL Editor:
  `select settle_payout('po-xxxxxxxx', 'sent', null);`
- **Refuse it** (the money goes back to the rider's wallet):
  `select settle_payout('po-xxxxxxxx', 'failed', 'Reason the rider will see');`

### Automatic mode

Set the secret `CASHOUT_MODE=auto`. Cash-outs are then sent at once. For this, in Paystack go to
**Settings > Preferences > Transfers** and turn **off** "Confirm transfers before sending" (the OTP step), otherwise the
transfer waits for an OTP. Only do this once you trust the anti-cheat and your balance is topped up.

## Going live

1. Paystack has approved your business (Compliance in the dashboard) and **Transfers** are enabled for your account.
2. Replace `sk_test_` with `sk_live_` in the `PAYSTACK_SECRET_KEY` secret.
3. Put the live webhook URL (same address as step 5) in the **Live Webhook URL** box.
4. Change `PAYSTACK_PUBLIC_KEY` in `src/cloud-config.ts` to the `pk_live_` key and publish the game.

## Checking that nothing is wrong

- **Supabase > Edge Functions > (function) > Logs** shows every call and error.
- A player says they paid but got no coins: find the reference in **coin_purchases**. `pending` = Paystack hasn't
  confirmed (check the payment in the Paystack dashboard; if it succeeded, check the webhook URL). `paid` with
  `claimed_at` empty = the coins are added next time they open the game while signed in.
- Changed bike speeds or the race routes in the game? Update the limits in `_shared/runcheck.ts`
  (`MAX_SPEED`, `MAX_CRUISE`, `ROUTE_LENGTHS`) and redeploy `submit-run` and `close-week`, or honest rides get refused.
  `prize_events.route_length` for the current race can be fixed in the Table Editor.

## How the safety works (for whoever maintains this)

- Players can only **read** their own rows. No table accepts writes from the app; the functions write with the service
  role after checking. The functions that move money (`mark_purchase_paid`, `request_cashout`, `settle_payout`,
  `close_prize_event`) can't be called by players at all.
- Coins are only given for payments Paystack confirmed (webhook signed with HMAC-SHA512 of your secret key, or a direct
  verify call to Paystack), for at least the bundle's price, and each payment's coins are handed over once.
- Cash-outs take the money out of the wallet in the same database step that records them; one at a time; a failed or
  reversed transfer puts it back once.
- Prize results need a server start ticket, real time between ticket and result at least the race time, and a ride
  recording that passes the checks in `_shared/runcheck.ts` (route length, one sample per 0.1 s matching the time,
  never backwards, never faster than the game allows, not too much boost, stays on the road, really steers). It catches
  edited times and simple scripts; it cannot prove a human rode, so review winners before paying in manual mode.
- To check the code compiles: `npx tsc -p supabase/functions` (type-check only; Supabase runs it on Deno).
