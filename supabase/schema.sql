-- LEGONRUSH database: accounts, saved progress, race leaderboards and hall standings.
-- Run once in Supabase: SQL Editor > New query > paste this file > Run. Safe to run again.

-- Public rider card: what other players can see.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default 'Rider' check (char_length(name) between 1 and 18),
  username text unique check (username ~ '^[A-Za-z0-9_.]{2,20}$'),
  hall text not null default 'none' check (hall ~ '^[a-z-]{2,20}$'),
  bike text not null default 'city' check (bike ~ '^[a-z-]{2,20}$'),
  xp integer not null default 0 check (xp >= 0),
  km numeric(9, 2) not null default 0 check (km >= 0),
  updated_at timestamptz not null default now()
);

-- Full saved progress (coins, best times, bikes). Only its owner can read it.
create table if not exists public.saves (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Every finished race. The leaderboard keeps each rider's best.
create table if not exists public.runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  route text not null check (route ~ '^[a-z0-9-]{2,40}$'),
  time numeric(8, 2) not null check (time between 20 and 3600),
  created_at timestamptz not null default now()
);
create index if not exists runs_route_time on public.runs (route, time);

-- Every ride's distance, credited to the rider's hall for Hall Week.
create table if not exists public.rides (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  hall text not null check (hall ~ '^[a-z-]{2,20}$'),
  km numeric(6, 3) not null check (km > 0 and km <= 15),
  created_at timestamptz not null default now()
);
create index if not exists rides_created on public.rides (created_at);

-- Added with the richer sign-up: department, Snapchat (null when hidden) and the rider's look.
alter table public.profiles add column if not exists department text check (char_length(department) <= 80);
alter table public.profiles add column if not exists snap text check (snap ~ '^[A-Za-z][A-Za-z0-9._-]{2,14}$');
alter table public.profiles add column if not exists gender text check (gender in ('male', 'female'));
alter table public.profiles add column if not exists look jsonb;
alter table public.rides add column if not exists department text check (char_length(department) <= 80);

alter table public.profiles enable row level security;
alter table public.saves enable row level security;
alter table public.runs enable row level security;
alter table public.rides enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own save" on public.saves;
create policy "own save" on public.saves for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "runs are public" on public.runs;
create policy "runs are public" on public.runs for select using (true);
drop policy if exists "insert own runs" on public.runs;
create policy "insert own runs" on public.runs for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "insert own rides" on public.rides;
create policy "insert own rides" on public.rides for insert to authenticated with check (user_id = auth.uid());

-- Fastest riders on one route, one row each.
drop function if exists public.leaderboard(text, integer);
create or replace function public.leaderboard(p_route text, p_limit integer default 20)
returns table (name text, username text, hall text, department text, snap text, best numeric, me boolean)
language sql stable security definer set search_path = public as $$
  select p.name, p.username, p.hall, p.department, p.snap, min(r.time) as best, p.id = auth.uid() as me
  from public.runs r join public.profiles p on p.id = r.user_id
  where r.route = p_route
  group by p.id
  order by best
  limit least(greatest(p_limit, 1), 100);
$$;

-- Kilometres ridden per hall since a time (the client passes this Monday at midnight).
create or replace function public.hall_standings(p_since timestamptz)
returns table (hall text, km numeric, riders bigint)
language sql stable security definer set search_path = public as $$
  select r.hall, round(sum(r.km), 1) as km, count(distinct r.user_id) as riders
  from public.rides r
  where r.created_at >= p_since and r.hall <> 'none'
  group by r.hall
  order by km desc;
$$;

-- Kilometres ridden per department since a time.
create or replace function public.department_standings(p_since timestamptz)
returns table (department text, km numeric, riders bigint)
language sql stable security definer set search_path = public as $$
  select r.department, round(sum(r.km), 1) as km, count(distinct r.user_id) as riders
  from public.rides r
  where r.created_at >= p_since and r.department is not null and r.department <> 'Other / not a student'
  group by r.department
  order by km desc
  limit 50;
$$;

grant execute on function public.leaderboard(text, integer) to anon, authenticated;
grant execute on function public.department_standings(timestamptz) to anon, authenticated;
grant execute on function public.hall_standings(timestamptz) to anon, authenticated;

-- Vibe Ride invites for riders who aren't online right now. They see them next time they open the game.
create table if not exists public.invites (
  id bigint generated always as identity primary key,
  from_id uuid not null default auth.uid() references public.profiles on delete cascade,
  to_id uuid not null references public.profiles on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{6}$'),
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists invites_to on public.invites (to_id, created_at);
alter table public.invites enable row level security;
drop policy if exists "send invites" on public.invites;
create policy "send invites" on public.invites for insert to authenticated with check (from_id = auth.uid() and to_id <> auth.uid());
drop policy if exists "see own invites" on public.invites;
create policy "see own invites" on public.invites for select to authenticated using (to_id = auth.uid() or from_id = auth.uid());
drop policy if exists "answer own invites" on public.invites;
create policy "answer own invites" on public.invites for update to authenticated using (to_id = auth.uid()) with check (to_id = auth.uid());

-- =====================================================================================
-- MONEY: coin bundles bought with real money, free weekly prize races, cash wallets and
-- Mobile Money cash-outs. Setup steps: supabase/functions/README.md.
--
-- How the rules work:
--  * Players can READ their own rows. Nothing can be written from the app: every write goes
--    through an Edge Function using the service role (which skips these rules), after Paystack
--    or the anti-cheat check says yes. Coins are only handed out for payments Paystack confirmed.
--  * Bought coins live in the game and have no cash value. Only prize money (wallets) can be
--    cashed out. Money is stored in pesewas (100 pesewas = GHS 1) so nothing is rounded.
-- =====================================================================================

-- One row per Paystack checkout. paid_at is set by the server when Paystack confirms the payment;
-- claimed_at when the game has added the coins to the rider's progress.
create table if not exists public.coin_purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  reference text not null unique check (char_length(reference) between 8 and 80),
  bundle_id text not null check (bundle_id ~ '^[a-z0-9-]{2,30}$'),
  coins integer not null check (coins > 0),
  amount_pesewas integer not null check (amount_pesewas > 0),
  currency text not null default 'GHS',
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  paystack_id bigint,
  channel text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  claimed_at timestamptz
);
create index if not exists coin_purchases_user on public.coin_purchases (user_id, created_at desc);

-- Prize money a rider has won and not cashed out yet.
create table if not exists public.wallets (
  user_id uuid primary key references auth.users on delete cascade,
  balance_pesewas bigint not null default 0 check (balance_pesewas >= 0),
  updated_at timestamptz not null default now()
);

-- Every change to a wallet: prizes in (+), cash-outs out (-), failed cash-outs given back (+).
create table if not exists public.wallet_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  amount_pesewas bigint not null,
  kind text not null check (kind in ('prize', 'cashout', 'refund', 'adjust')),
  note text,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists wallet_ledger_user on public.wallet_ledger (user_id, created_at desc);

-- One free prize race per week (Monday 00:00 to Sunday 23:59, Ghana time = UTC).
-- prizes_pesewas lists 1st, 2nd, 3rd...: {20000,10000,5000} = GHS 200, 100, 50.
-- route_length (metres) is how long the anti-cheat check expects the race to be.
create table if not exists public.prize_events (
  id bigint generated always as identity primary key,
  week date not null unique,
  title text not null check (char_length(title) between 3 and 80),
  route text not null check (route ~ '^[a-z0-9-]{2,40}$'),
  route_length integer not null check (route_length between 200 and 20000),
  prizes_pesewas integer[] not null default '{20000,10000,5000}',
  sponsor text check (char_length(sponsor) <= 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- A start ticket, given by the server when a prize-race ride starts. A result needs one, and the
-- real time between the ticket and the result must be at least the race time.
create table if not exists public.prize_tickets (
  id uuid primary key default gen_random_uuid(),
  event_id bigint not null references public.prize_events on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  issued_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists prize_tickets_user on public.prize_tickets (user_id, issued_at desc);

-- Every result sent for a prize race and what the anti-cheat check decided. Only accepted ones count.
create table if not exists public.prize_entries (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.prize_events on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  time numeric(8, 2) not null,
  accepted boolean not null,
  reason text,
  ticket_id uuid references public.prize_tickets on delete set null,
  trace jsonb,
  created_at timestamptz not null default now()
);
create index if not exists prize_entries_board on public.prize_entries (event_id, accepted, time);
create index if not exists prize_entries_user on public.prize_entries (user_id, created_at desc);

-- Final places when a week is closed, and the prize each winner got.
create table if not exists public.prize_results (
  event_id bigint not null references public.prize_events on delete cascade,
  place integer not null check (place >= 1),
  user_id uuid not null references auth.users on delete cascade,
  time numeric(8, 2) not null,
  prize_pesewas integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (event_id, place),
  unique (event_id, user_id)
);

-- Cash-outs to Mobile Money. The amount leaves the wallet when asked for and comes back if it fails.
create table if not exists public.payouts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  amount_pesewas integer not null check (amount_pesewas > 0),
  network text not null check (network in ('mtn', 'telecel', 'airteltigo')),
  momo_number text not null check (momo_number ~ '^0[0-9]{9}$'),
  account_name text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  reference text not null unique,
  recipient_code text,
  transfer_code text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payouts_user on public.payouts (user_id, created_at desc);
-- one cash-out waiting at a time per rider
create unique index if not exists payouts_one_open on public.payouts (user_id) where status in ('pending', 'processing');

alter table public.coin_purchases enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.prize_events enable row level security;
alter table public.prize_tickets enable row level security;
alter table public.prize_entries enable row level security;
alter table public.prize_results enable row level security;
alter table public.payouts enable row level security;

-- read-only rules: there are deliberately no insert/update/delete rules, so only the server writes
drop policy if exists "read own purchases" on public.coin_purchases;
create policy "read own purchases" on public.coin_purchases for select to authenticated using (user_id = auth.uid());
drop policy if exists "read own wallet" on public.wallets;
create policy "read own wallet" on public.wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists "read own ledger" on public.wallet_ledger;
create policy "read own ledger" on public.wallet_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists "prize events are public" on public.prize_events;
create policy "prize events are public" on public.prize_events for select using (true);
drop policy if exists "read own tickets" on public.prize_tickets;
create policy "read own tickets" on public.prize_tickets for select to authenticated using (user_id = auth.uid());
drop policy if exists "read own entries" on public.prize_entries;
create policy "read own entries" on public.prize_entries for select to authenticated using (user_id = auth.uid());
drop policy if exists "prize results are public" on public.prize_results;
create policy "prize results are public" on public.prize_results for select using (true);
drop policy if exists "read own payouts" on public.payouts;
create policy "read own payouts" on public.payouts for select to authenticated using (user_id = auth.uid());

-- The prize race leaderboard: each rider's best ACCEPTED time, fastest first (earlier wins a tie).
create or replace function public.prize_leaderboard(p_event bigint, p_limit integer default 50)
returns table (place bigint, name text, username text, hall text, best numeric, me boolean)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by b.best, b.first_at) as place, p.name, p.username, p.hall, b.best, b.user_id = auth.uid() as me
  from (
    select e.user_id, min(e.time) as best, min(e.created_at) as first_at
    from public.prize_entries e
    where e.event_id = p_event and e.accepted
    group by e.user_id
  ) b join public.profiles p on p.id = b.user_id
  order by b.best, b.first_at
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.prize_leaderboard(bigint, integer) to anon, authenticated;

-- The game calls this after a payment: hands over the coins of confirmed payments not yet added, once each.
create or replace function public.claim_coins()
returns table (reference text, coins integer)
language sql volatile security definer set search_path = public as $$
  update public.coin_purchases c set claimed_at = now()
  where c.user_id = auth.uid() and c.status = 'paid' and c.claimed_at is null
  returning c.reference, c.coins;
$$;
revoke execute on function public.claim_coins() from public, anon;
grant execute on function public.claim_coins() to authenticated;

-- ----- server-only functions: the Edge Functions call these with the service role -----

-- Marks a checkout paid when Paystack says so and the amount matches. Safe to call twice.
create or replace function public.mark_purchase_paid(p_reference text, p_amount integer, p_currency text, p_paystack_id bigint, p_channel text)
returns text
language plpgsql security definer set search_path = public as $$
declare r public.coin_purchases;
begin
  select * into r from public.coin_purchases where reference = p_reference for update;
  if not found then return 'unknown'; end if;
  if r.status = 'paid' then return 'already'; end if;
  if p_amount < r.amount_pesewas or upper(p_currency) <> r.currency then
    update public.coin_purchases set status = 'failed' where id = r.id;
    return 'mismatch';
  end if;
  update public.coin_purchases set status = 'paid', paid_at = now(), paystack_id = p_paystack_id, channel = p_channel where id = r.id;
  return 'paid';
end $$;

-- Takes a cash-out out of the wallet and records it, or says why not.
create or replace function public.request_cashout(p_user uuid, p_amount integer, p_network text, p_number text, p_name text, p_reference text, p_min integer, p_status text)
returns table (ok boolean, message text, payout_id bigint)
language plpgsql security definer set search_path = public as $$
declare bal bigint; pid bigint;
begin
  if p_amount < p_min then return query select false, 'below_min', null::bigint; return; end if;
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance_pesewas into bal from public.wallets where user_id = p_user for update;
  if bal < p_amount then return query select false, 'not_enough', null::bigint; return; end if;
  if exists (select 1 from public.payouts where user_id = p_user and status in ('pending', 'processing')) then
    return query select false, 'one_pending', null::bigint; return;
  end if;
  update public.wallets set balance_pesewas = balance_pesewas - p_amount, updated_at = now() where user_id = p_user;
  insert into public.payouts (user_id, amount_pesewas, network, momo_number, account_name, reference, status)
    values (p_user, p_amount, p_network, p_number, p_name, p_reference, p_status) returning id into pid;
  insert into public.wallet_ledger (user_id, amount_pesewas, kind, note, ref)
    values (p_user, -p_amount, 'cashout', 'Cash out to ' || case p_network when 'mtn' then 'MTN MoMo' when 'telecel' then 'Telecel Cash' else 'AirtelTigo Money' end || ' ' || p_number, p_reference);
  return query select true, 'ok', pid;
end $$;

-- The final word on a cash-out: 'processing', 'sent', or 'failed' (the money goes back to the wallet, once).
create or replace function public.settle_payout(p_reference text, p_status text, p_reason text, p_transfer_code text default null, p_recipient text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare p public.payouts;
begin
  select * into p from public.payouts where reference = p_reference for update;
  if not found then return 'unknown'; end if;
  if p.status in ('sent', 'failed') then return 'already'; end if;
  if p_status in ('sent', 'processing') then
    update public.payouts set status = p_status, transfer_code = coalesce(p_transfer_code, transfer_code),
      recipient_code = coalesce(p_recipient, recipient_code), updated_at = now() where id = p.id;
  else
    update public.payouts set status = 'failed', failure_reason = left(p_reason, 200), updated_at = now() where id = p.id;
    update public.wallets set balance_pesewas = balance_pesewas + p.amount_pesewas, updated_at = now() where user_id = p.user_id;
    insert into public.wallet_ledger (user_id, amount_pesewas, kind, note, ref)
      values (p.user_id, p.amount_pesewas, 'refund', 'Cash out did not go through: money returned', p.reference);
  end if;
  return p_status;
end $$;

-- Closes a week: ranks the accepted results (best time per rider, earlier wins a tie) and pays the prizes
-- into the winners' wallets. Runs once per event; calling it again does nothing.
create or replace function public.close_prize_event(p_event bigint)
returns integer
language plpgsql security definer set search_path = public as $$
declare ev public.prize_events; w record; n integer := 0;
begin
  select * into ev from public.prize_events where id = p_event for update;
  if not found or ev.status <> 'open' then return -1; end if;
  for w in
    select row_number() over (order by b.best, b.first_at) as place, b.user_id, b.best
    from (
      select e.user_id, min(e.time) as best, min(e.created_at) as first_at
      from public.prize_entries e
      where e.event_id = p_event and e.accepted
      group by e.user_id
    ) b
    order by b.best, b.first_at
    limit greatest(coalesce(array_length(ev.prizes_pesewas, 1), 0), 10)
  loop
    insert into public.prize_results (event_id, place, user_id, time, prize_pesewas)
      values (p_event, w.place, w.user_id, w.best, coalesce(ev.prizes_pesewas[w.place], 0));
    if coalesce(ev.prizes_pesewas[w.place], 0) > 0 then
      insert into public.wallets (user_id) values (w.user_id) on conflict (user_id) do nothing;
      update public.wallets set balance_pesewas = balance_pesewas + ev.prizes_pesewas[w.place], updated_at = now() where user_id = w.user_id;
      insert into public.wallet_ledger (user_id, amount_pesewas, kind, note, ref)
        values (w.user_id, ev.prizes_pesewas[w.place], 'prize', ev.title || ': place ' || w.place, 'event-' || p_event);
      n := n + 1;
    end if;
  end loop;
  update public.prize_events set status = 'closed', closed_at = now() where id = p_event;
  return n;
end $$;

revoke execute on function public.mark_purchase_paid(text, integer, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.request_cashout(uuid, integer, text, text, text, text, integer, text) from public, anon, authenticated;
revoke execute on function public.settle_payout(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.close_prize_event(bigint) from public, anon, authenticated;
grant execute on function public.mark_purchase_paid(text, integer, text, bigint, text) to service_role;
grant execute on function public.request_cashout(uuid, integer, text, text, text, text, integer, text) to service_role;
grant execute on function public.settle_payout(text, text, text, text, text) to service_role;
grant execute on function public.close_prize_event(bigint) to service_role;
