// submit-run: the weekly prize race, with results checked on the server.
//   GET  (sign-in optional)                    -> this week's event, its leaderboard, and your own results
//   POST (signed in) { action: 'start' }       -> a start ticket for a prize-race ride
//   POST (signed in) { action: 'finish', ticket, route, time, finished, length, trace }
//        -> checks the recorded ride (see _shared/runcheck.ts) and saves it; only accepted rides count
import { body, db, fail, json, preflight, user } from '../_shared/http.ts';
import { checkRun, REASONS, type RunClaim } from '../_shared/runcheck.ts';

interface PrizeEvent {
  id: number;
  week: string;
  title: string;
  route: string;
  route_length: number;
  prizes_pesewas: number[];
  sponsor: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
}

interface Entry {
  user_id: string;
  time: number;
  created_at: string;
}

type Req = Partial<RunClaim> & { action?: string; ticket?: string };

/** results are accepted for a few minutes after the deadline, for rides that started in time */
const GRACE_MS = 10 * 60e3;

async function currentEvent(): Promise<PrizeEvent | null> {
  const now = new Date().toISOString();
  const [ev] = await db.select<PrizeEvent>('prize_events', `status=eq.open&starts_at=lte.${now}&ends_at=gt.${new Date(Date.now() - GRACE_MS).toISOString()}&order=starts_at.desc&limit=1&select=*`);
  return ev ?? null;
}

/** best accepted time per rider, fastest first; earlier wins a tie */
async function board(eventId: number, me: string | null) {
  const rows = await db.select<Entry>('prize_entries', `event_id=eq.${eventId}&accepted=is.true&select=user_id,time,created_at&order=time.asc,created_at.asc&limit=3000`);
  const best = new Map<string, Entry>();
  for (const r of rows) if (!best.has(r.user_id)) best.set(r.user_id, r);
  const top = [...best.values()].slice(0, 50);
  const ids = top.map((r) => r.user_id);
  const people = ids.length ? await db.select<{ id: string; name: string; username: string | null; hall: string }>('profiles', `id=in.(${ids.join(',')})&select=id,name,username,hall`) : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = top.map((r, i) => ({ place: i + 1, name: byId.get(r.user_id)?.name ?? 'Rider', username: byId.get(r.user_id)?.username ?? null, hall: byId.get(r.user_id)?.hall ?? 'none', best: Number(r.time), me: r.user_id === me }));
  const myPlace = me ? [...best.keys()].indexOf(me) + 1 : 0;
  return { rows: out, riders: best.size, myPlace };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const me = await user(req);
    const ev = await currentEvent();

    if (req.method === 'GET') {
      if (!ev) return json({ ok: true, event: null, board: [], riders: 0 });
      const b = await board(ev.id, me?.id ?? null);
      const mine = me
        ? await db.select<{ time: number; accepted: boolean; reason: string | null; created_at: string }>('prize_entries', `event_id=eq.${ev.id}&user_id=eq.${me.id}&select=time,accepted,reason,created_at&order=created_at.desc&limit=5`)
        : [];
      return json({
        ok: true,
        event: { id: ev.id, title: ev.title, route: ev.route, route_length: ev.route_length, prizes: ev.prizes_pesewas, sponsor: ev.sponsor, starts_at: ev.starts_at, ends_at: ev.ends_at },
        board: b.rows,
        riders: b.riders,
        my_place: b.myPlace,
        mine: mine.map((m) => ({ time: Number(m.time), accepted: m.accepted, reason: m.reason ? REASONS[m.reason] ?? m.reason : null, at: m.created_at })),
      });
    }
    if (req.method !== 'POST') return fail('method', 'Use GET or POST.', 405);
    if (!me) return fail('sign_in', 'Sign in to ride for prizes.', 401);
    const b = await body<Req>(req, 900_000);
    if (!b) return fail('bad_request', 'Bad request.');
    if (!ev || (b.action === 'start' && Date.parse(ev.ends_at) < Date.now())) return fail('closed', 'There is no prize race running right now.', 409);

    if (b.action === 'start') {
      const [t] = await db.insert<{ id: string }>('prize_tickets', { event_id: ev.id, user_id: me.id });
      return json({ ok: true, ticket: t.id, event: ev.id, route: ev.route });
    }

    if (b.action !== 'finish') return fail('bad_request', 'Unknown action.');
    const recent = await db.select('prize_entries', `user_id=eq.${me.id}&created_at=gte.${new Date(Date.now() - 3600e3).toISOString()}&select=id`);
    if (recent.length >= 40) return fail('rate', REASONS.rate, 429);
    if (!b.ticket || !/^[0-9a-f-]{36}$/i.test(b.ticket)) return fail('ticket', REASONS.ticket);
    // the ticket: this rider's, this event, unused, and claimed once (the update only matches an unused one)
    const [t] = await db.update<{ issued_at: string; event_id: number; user_id: string }>(
      'prize_tickets',
      `id=eq.${b.ticket}&user_id=eq.${me.id}&event_id=eq.${ev.id}&used_at=is.null&select=issued_at,event_id,user_id`,
      { used_at: new Date().toISOString() },
    );
    if (!t) return fail('ticket', REASONS.ticket);

    const claim: RunClaim = { route: String(b.route ?? ''), time: Number(b.time), finished: b.finished === true, length: Number(b.length), trace: b.trace as RunClaim['trace'] };
    let verdict = claim.route !== ev.route ? { ok: false as const, reason: 'route_length' } : checkRun(claim, ev.route_length);
    // real time between the start ticket and this result must cover the race (plus the countdown)
    const wall = (Date.now() - Date.parse(t.issued_at)) / 1000;
    if (verdict.ok && wall + 2 < claim.time) verdict = { ok: false, reason: 'too_quick' };
    if (verdict.ok && wall > 2 * 3600) verdict = { ok: false, reason: 'ticket' };

    const time = Math.round(Math.min(9999, Math.max(0, claim.time || 0)) * 100) / 100;
    await db.insert('prize_entries', {
      event_id: ev.id, user_id: me.id, time, accepted: verdict.ok, reason: verdict.ok ? null : verdict.reason, ticket_id: b.ticket,
      trace: verdict.ok ? claim.trace : null,
    });
    if (!verdict.ok) return json({ ok: true, accepted: false, reason: verdict.reason, message: REASONS[verdict.reason] ?? 'Not accepted.' });
    const bd = await board(ev.id, me.id);
    return json({ ok: true, accepted: true, time, place: bd.myPlace, riders: bd.riders });
  } catch (e) {
    console.error(e);
    return fail('server', 'Something went wrong. Try again in a minute.', 500);
  }
});
