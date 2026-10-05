// close-week: the owner's weekly job. Needs the x-admin-secret header (ADMIN_SECRET). Deploy with --no-verify-jwt.
//   POST {}                         -> closes every prize race whose week has ended (ranks the accepted
//                                      results, pays 1st/2nd/3rd... into the winners' wallets), then makes
//                                      sure this week's race exists
//   POST { close: <event id> }      -> closes that one event now, even if its week has not ended
//   POST { create: false }          -> close only, don't create this week's race
// Settings (Supabase secrets, all optional): PRIZE_ROUTE (default engineering-run), PRIZES_GHS (default
// "200,100,50"), PRIZE_TITLE (default "Weekly Prize Race"), PRIZE_SPONSOR (default none).
import { body, db, env, fail, isAdmin, json, preflight, weekStartUTC } from '../_shared/http.ts';
import { ROUTE_LENGTHS } from '../_shared/runcheck.ts';

interface Req {
  close?: number;
  create?: boolean;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return fail('method', 'Use POST.', 405);
  if (!isAdmin(req)) return fail('admin', 'Wrong or missing x-admin-secret header.', 403);
  const b = (await body<Req>(req)) ?? {};
  try {
    const closed: { id: number; title: string; paid: number }[] = [];
    const due = b.close
      ? await db.select<{ id: number; title: string }>('prize_events', `id=eq.${Number(b.close)}&status=eq.open&select=id,title`)
      // a few minutes after the deadline, so rides finishing at the whistle still count
      : await db.select<{ id: number; title: string }>('prize_events', `status=eq.open&ends_at=lt.${new Date(Date.now() - 15 * 60e3).toISOString()}&select=id,title`);
    for (const ev of due) {
      const paid = await db.rpc<number>('close_prize_event', { p_event: ev.id });
      closed.push({ id: ev.id, title: ev.title, paid });
    }

    let created: unknown = null;
    if (b.create !== false) {
      const start = weekStartUTC();
      const week = start.toISOString().slice(0, 10);
      const [have] = await db.select('prize_events', `week=eq.${week}&select=id`);
      if (!have) {
        const route = env('PRIZE_ROUTE', 'engineering-run');
        const prizes = env('PRIZES_GHS', '200,100,50').split(',').map((s) => Math.round(Number(s.trim()) * 100)).filter((n) => n > 0);
        const end = new Date(start.getTime() + 7 * 86400e3 - 1000);
        [created] = await db.insert('prize_events', {
          week, route, route_length: ROUTE_LENGTHS[route] ?? Number(env('PRIZE_ROUTE_LENGTH', '0')),
          title: env('PRIZE_TITLE', 'Weekly Prize Race'), sponsor: env('PRIZE_SPONSOR') || null,
          prizes_pesewas: prizes.length ? prizes : [20000, 10000, 5000],
          starts_at: start.toISOString(), ends_at: end.toISOString(),
        });
      }
    }
    return json({ ok: true, closed, created });
  } catch (e) {
    console.error(e);
    return fail('server', String(e), 500);
  }
});
