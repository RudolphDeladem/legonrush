// challenge-submit: results for PAID Race Challenges, checked on the server before they count.
//   POST (signed in) { attempt, route, time, finished, length, trace }
//        -> checks the attempt ticket (challenge_start_attempt), then the whole ride recording with
//           _shared/runcheck.ts (the same anti-cheat as the prize race), then saves it through the
//           database function challenge_record(), which only the service role may call.
// Paid challenges are a level field in the game (City bike, no upgrades or items, clear weather), so
// the prize race's speed limits apply as they are.
import { body, db, fail, json, preflight, user } from '../_shared/http.ts';
import { checkRun, REASONS, type RunClaim } from '../_shared/runcheck.ts';

type Req = Partial<RunClaim> & { attempt?: string };
const WORDS: Record<string, string> = { ...REASONS, closed: 'The challenge had ended.', too_quick: 'The result arrived sooner than the ride could have been ridden.' };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== 'POST') return fail('method', 'Use POST.', 405);
    const me = await user(req);
    if (!me) return fail('sign_in', 'Sign in to ride paid challenges.', 401);
    const b = await body<Req>(req, 900_000);
    if (!b || !b.attempt || !/^[0-9a-f-]{36}$/i.test(b.attempt)) return fail('ticket', REASONS.ticket);

    // the ticket must be this rider's and unused; the challenge tells us the route and its length
    const [a] = await db.select<{ challenge_id: string; issued_at: string }>('challenge_attempts', `id=eq.${b.attempt}&user_id=eq.${me.id}&used_at=is.null&select=challenge_id,issued_at`);
    if (!a) return fail('ticket', 'That ride was already counted, or it was not started from the challenge.');
    const [c] = await db.select<{ route: string; entry_fee: number }>('challenges', `id=eq.${encodeURIComponent(a.challenge_id)}&select=route,entry_fee`);
    if (!c) return fail('ticket', REASONS.ticket);
    const [r] = await db.select<{ length_m: number }>('challenge_routes', `id=eq.${c.route}&select=length_m`);
    if (!r) return fail('route', REASONS.route_length);

    const claim: RunClaim = { route: String(b.route ?? ''), time: Number(b.time), finished: b.finished === true, length: Number(b.length), trace: b.trace as RunClaim['trace'] };
    const verdict = claim.route !== c.route ? { ok: false as const, reason: 'route_length' } : checkRun(claim, r.length_m);
    // the database adds the time checks (ride time vs. time since the ticket, the challenge's end)
    const out = await db.rpc<{ accepted: boolean; reason?: string; place?: number; riders?: number }>('challenge_record', {
      p_attempt: b.attempt, p_user: me.id, p_time: claim.time, p_accepted: verdict.ok, p_reason: verdict.ok ? null : verdict.reason, p_trace: verdict.ok ? claim.trace : null,
    });
    if (!out.accepted) return json({ ok: true, accepted: false, reason: out.reason, message: WORDS[out.reason ?? ''] ?? 'Not accepted.' });
    return json({ ok: true, accepted: true, place: out.place, riders: out.riders });
  } catch (e) {
    console.error(e);
    return fail('server', 'Something went wrong. Your ride is kept on your phone; try again in a minute.', 500);
  }
});
