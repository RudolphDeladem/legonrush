-- LEGONRUSH: everything in one go. Paste this whole file into Supabase → SQL Editor → Run.
-- Made from supabase/schema.sql and supabase/sql/*.sql (in order). Safe to run again.

-- ===================== supabase/schema.sql =====================
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

-- ===================== supabase/sql/00-core.sql =====================
-- Shared pieces for the tab systems (events, challenges, community, store).
-- Run after supabase/schema.sql. Safe to run again.

-- LEGONRUSH administrators: add a row with the user's id (Authentication → Users) to make someone an admin.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select using (auth.uid() = user_id);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated, anon;

-- Prices admins can change without a new release (coins). Read by everyone.
create table if not exists public.config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.config enable row level security;
drop policy if exists "config read" on public.config;
create policy "config read" on public.config for select using (true);
drop policy if exists "config admin write" on public.config;
create policy "config admin write" on public.config for all using (public.is_admin()) with check (public.is_admin());

-- ===================== supabase/sql/10-events.sql =====================
-- LEGONRUSH Events: admin (official) and community (rider) events, registrations with capacity,
-- entry fees held in escrow, mini-game scores and leaderboards, prize pools and refunds paid out
-- as rewards the game claims once, and reports from event spaces.
-- Run after supabase/schema.sql and supabase/sql/00-core.sql (admins, is_admin(), config). Safe to run again.
--
-- Official LEGONRUSH events that run every day (Sunset Ride, Coin Rush, Freshers Week...) are made
-- by the game itself and are not stored here; their registrations and scores use keys like
-- 'off:sunset:2026-10-05'. Events stored here use 'db:<uuid>'.
--
-- Coins: Rush Coins live in the game (saved progress), not in a server balance. The server records
-- every fee in event_escrow and decides prize pools and refunds; the game then takes or adds the
-- coins. A modified game could skip paying an entry fee; the escrow rows show who paid what.

-- Prices for rider events (admins can change them: update public.config set value = ... where key = 'event_prices')
insert into public.config (key, value) values ('event_prices', '{"small": 5000, "medium": 15000, "large": 30000, "major": 75000}')
on conflict (key) do nothing;

-- ---------- tables ----------
create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 60),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('admin', 'community')),
  type text not null check (type ~ '^[a-z]{3,20}$'),
  name text not null check (char_length(name) between 3 and 40),
  blurb text check (char_length(blurb) <= 120),
  description text check (char_length(description) <= 400),
  cover text check (cover ~ '^[a-z0-9-]{2,30}$'),
  host text check (char_length(host) <= 30),
  owner_id uuid references auth.users on delete set null,
  place text not null check (char_length(place) between 2 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reg_deadline timestamptz,
  capacity integer check (capacity is null or capacity between 2 and 5000),
  fee integer not null default 0 check (fee between 0 and 10000),
  rewards jsonb not null default '{}'::jsonb,
  rules text[] not null default '{}',
  time_limit integer check (time_limit is null or time_limit between 30 and 3600),
  series_id uuid references public.event_series on delete set null,
  series_day integer,
  series_of integer,
  stops text[],
  spot text,
  clues text[],
  size text check (size is null or size in ('small', 'medium', 'large', 'major')),
  creation_cost integer not null default 0,
  prize_topup integer not null default 0,
  status text not null default 'published' check (status in ('published', 'cancelled', 'settled')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists events_time on public.events (ends_at, starts_at);
create index if not exists events_owner on public.events (owner_id);

create table if not exists public.event_registrations (
  event_key text not null check (event_key ~ '^(off:[a-z0-9:-]{3,80}|db:[0-9a-f-]{36})$'),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null default 'Rider' check (char_length(name) between 1 and 24),
  hall text not null default 'none' check (hall ~ '^[a-z-]{2,20}$'),
  paid integer not null default 0,
  joined_at timestamptz not null default now(),
  primary key (event_key, user_id)
);
create index if not exists event_registrations_key on public.event_registrations (event_key);

-- every coin movement for events: entry fees (held until refunded or paid out), creation fees (spent), prize top-ups (held)
create table if not exists public.event_escrow (
  id bigint generated always as identity primary key,
  event_key text not null,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('entry', 'creation', 'pool')),
  amount integer not null check (amount > 0),
  status text not null check (status in ('held', 'spent', 'refunded', 'paid_out')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists event_escrow_key on public.event_escrow (event_key, status);

create table if not exists public.event_results (
  event_key text not null check (event_key ~ '^(off:[a-z0-9:-]{3,80}|db:[0-9a-f-]{36})$'),
  user_id uuid not null references auth.users on delete cascade,
  game text not null check (game in ('quiz', 'target')),
  name text not null,
  hall text not null,
  score integer not null check (score >= 0),
  hall_points integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (event_key, user_id, game)
);
create index if not exists event_results_board on public.event_results (event_key, game, score desc);

-- rewards the server owes a rider (prize pools, refunds); the game adds them once (claim_event_rewards)
create table if not exists public.event_rewards (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  event_key text not null,
  coins integer not null default 0 check (coins >= 0),
  xp integer not null default 0 check (xp >= 0),
  diamonds integer not null default 0 check (diamonds >= 0),
  items text[],
  reason text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists event_rewards_user on public.event_rewards (user_id) where claimed_at is null;

create table if not exists public.event_reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references auth.users on delete cascade,
  event_key text not null,
  reported text not null,
  reported_name text,
  reason text not null check (char_length(reason) <= 60),
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

-- ---------- row level security ----------
alter table public.event_series enable row level security;
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_escrow enable row level security;
alter table public.event_results enable row level security;
alter table public.event_rewards enable row level security;
alter table public.event_reports enable row level security;

drop policy if exists "series read" on public.event_series;
create policy "series read" on public.event_series for select using (true);
drop policy if exists "series admin" on public.event_series;
create policy "series admin" on public.event_series for all using (public.is_admin()) with check (public.is_admin());

-- everyone sees events; only admins write directly (riders create through create_event)
drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select using (true);
drop policy if exists "events admin" on public.events;
create policy "events admin" on public.events for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "registrations own" on public.event_registrations;
create policy "registrations own" on public.event_registrations for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "escrow own" on public.event_escrow;
create policy "escrow own" on public.event_escrow for select using (auth.uid() = user_id or public.is_admin());

-- leaderboards are public (name, hall, score)
drop policy if exists "results read" on public.event_results;
create policy "results read" on public.event_results for select using (true);

drop policy if exists "rewards own" on public.event_rewards;
create policy "rewards own" on public.event_rewards for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "reports admin" on public.event_reports;
create policy "reports admin" on public.event_reports for all using (public.is_admin()) with check (public.is_admin());

-- what the game reads: events with their series name
create or replace view public.events_public with (security_invoker = true) as
  select e.id, e.source, e.type, e.name, e.blurb, e.description, e.cover, e.host, e.owner_id, e.place,
         e.starts_at, e.ends_at, e.reg_deadline, e.capacity, e.fee, e.rewards, e.rules, e.time_limit,
         e.series_id, s.name as series_name, e.series_day, e.series_of, e.stops, e.spot, e.clues, e.status, e.created_at
  from public.events e left join public.event_series s on s.id = e.series_id;
grant select on public.events_public to anon, authenticated;

-- ---------- functions ----------
-- real numbers of riders registered, for the cards
create or replace function public.event_counts(p_keys text[])
returns table (event_key text, joined integer)
language sql stable security definer set search_path = public as $$
  select r.event_key, count(*)::integer from public.event_registrations r
  where r.event_key = any (p_keys[1:200]) group by r.event_key;
$$;
grant execute on function public.event_counts(text[]) to anon, authenticated;

-- join an event: capacity and deadline are checked with the event row locked, so it never overfills
create or replace function public.register_event(p_key text, p_name text, p_hall text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev public.events;
  n integer;
  nm text := left(coalesce(nullif(trim(p_name), ''), 'Rider'), 24);
  hl text := case when p_hall ~ '^[a-z-]{2,20}$' then p_hall else 'none' end;
begin
  if uid is null then raise exception 'signin'; end if;
  if p_key ~ '^off:[a-z0-9:-]{3,80}$' then
    insert into public.event_registrations (event_key, user_id, name, hall) values (p_key, uid, nm, hl) on conflict do nothing;
    select count(*) into n from public.event_registrations where event_key = p_key;
    return jsonb_build_object('ok', true, 'paid', 0, 'joined', n);
  end if;
  if p_key !~ '^db:[0-9a-f-]{36}$' then raise exception 'bad event'; end if;
  select * into ev from public.events where id = substr(p_key, 4)::uuid for update;
  if not found or ev.status <> 'published' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if now() > coalesce(ev.reg_deadline, ev.ends_at) or now() > ev.ends_at then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if exists (select 1 from public.event_registrations where event_key = p_key and user_id = uid) then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;
  select count(*) into n from public.event_registrations where event_key = p_key;
  if ev.capacity is not null and n >= ev.capacity then return jsonb_build_object('ok', false, 'error', 'full'); end if;
  insert into public.event_registrations (event_key, user_id, name, hall, paid) values (p_key, uid, nm, hl, ev.fee);
  if ev.fee > 0 then
    insert into public.event_escrow (event_key, user_id, kind, amount, status) values (p_key, uid, 'entry', ev.fee, 'held');
  end if;
  return jsonb_build_object('ok', true, 'paid', ev.fee, 'joined', n + 1);
end $$;
revoke execute on function public.register_event(text, text, text) from public, anon;
grant execute on function public.register_event(text, text, text) to authenticated;

-- leave before the start: the entry fee comes back as a reward to claim
create or replace function public.leave_event(p_key text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev public.events;
  refund integer;
begin
  if uid is null then raise exception 'signin'; end if;
  if p_key ~ '^db:[0-9a-f-]{36}$' then
    select * into ev from public.events where id = substr(p_key, 4)::uuid;
    if found and now() >= ev.starts_at then raise exception 'started'; end if;
  end if;
  delete from public.event_registrations where event_key = p_key and user_id = uid;
  with r as (
    update public.event_escrow set status = 'refunded', settled_at = now()
    where event_key = p_key and user_id = uid and kind = 'entry' and status = 'held' returning amount
  ) select coalesce(sum(amount), 0) into refund from r;
  if refund > 0 then
    insert into public.event_rewards (user_id, event_key, coins, reason) values (uid, p_key, refund, 'Refund: ' || coalesce(ev.name, 'event'));
  end if;
end $$;
revoke execute on function public.leave_event(text) from public, anon;
grant execute on function public.leave_event(text) to authenticated;

-- create an event. Admins can publish official events for free; riders pay by size (config "event_prices").
create or replace function public.create_event(p jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  admin boolean := public.is_admin();
  official boolean := coalesce((p->>'official')::boolean, false) and public.is_admin();
  s timestamptz := (p->>'starts_at')::timestamptz;
  e timestamptz := (p->>'ends_at')::timestamptz;
  dl timestamptz := coalesce((p->>'reg_deadline')::timestamptz, (p->>'starts_at')::timestamptz);
  cap integer := nullif(p->>'capacity', '')::integer;
  sz text;
  prices jsonb;
  price integer := 0;
  topup integer := 0;
  fee integer := greatest(0, least(10000, coalesce((p->>'fee')::integer, 0)));
  rw jsonb;
  new_id uuid;
begin
  if uid is null then raise exception 'signin'; end if;
  if s is null or e is null or e <= s then raise exception 'Pick a start and an end time.'; end if;
  if s < now() + (case when official then interval '5 minutes' else interval '1 hour' end) then raise exception 'Start at least an hour from now.'; end if;
  if s > now() + interval '60 days' then raise exception 'Events can be planned up to two months ahead.'; end if;
  if e - s < interval '30 minutes' or e - s > (case when official then interval '7 days' else interval '12 hours' end) then raise exception 'That is too short or too long.'; end if;
  if cap is not null and (cap < 2 or cap > 5000) then raise exception 'Capacity must be between 2 and 5000.'; end if;
  sz := case when cap is null then 'major' when cap <= 25 then 'small' when cap <= 100 then 'medium' when cap <= 250 then 'large' else 'major' end;
  if official then
    rw := coalesce(p->'rewards', '{}'::jsonb);
  else
    -- rider events: at most three upcoming at a time, and no free diamonds or items (prizes come from the pool)
    if (select count(*) from public.events where owner_id = uid and status = 'published' and ends_at > now()) >= 3 then
      raise exception 'You already have three upcoming events. Wait for one to finish.';
    end if;
    select value into prices from public.config where key = 'event_prices';
    price := coalesce((prices->>sz)::integer, case sz when 'small' then 5000 when 'medium' then 15000 when 'large' then 30000 else 75000 end);
    topup := greatest(0, least(50000, coalesce((p->>'prize_topup')::integer, 0)));
    rw := jsonb_build_object('join', jsonb_build_object('xp', least(100, greatest(0, coalesce((p->'rewards'->'join'->>'xp')::integer, 0)))));
    if fee > 0 or topup > 0 then rw := rw || jsonb_build_object('winner', jsonb_build_object('coins', 0)); end if;
  end if;
  insert into public.events (source, type, name, blurb, description, cover, host, owner_id, place, starts_at, ends_at, reg_deadline,
    capacity, fee, rewards, rules, time_limit, series_id, series_day, series_of, stops, spot, clues, size, creation_cost, prize_topup)
  values (
    case when official then 'admin' else 'community' end,
    p->>'type', trim(p->>'name'), left(p->>'description', 120), p->>'description', p->>'cover',
    case when official then 'LEGONRUSH' else left(coalesce(nullif(trim(p->>'host'), ''), 'A rider'), 30) end,
    uid, p->>'place', s, e, least(dl, e), cap, fee, rw,
    coalesce(array(select jsonb_array_elements_text(p->'rules')), '{}'),
    nullif(p->>'time_limit', '')::integer,
    case when official then nullif(p->>'series_id', '')::uuid end,
    case when official then nullif(p->>'series_day', '')::integer end,
    case when official then nullif(p->>'series_of', '')::integer end,
    case when p ? 'stops' then array(select jsonb_array_elements_text(p->'stops')) end,
    p->>'spot',
    case when p ? 'clues' then array(select left(c, 120) from jsonb_array_elements_text(p->'clues') c limit 3) end,
    sz, price + topup, topup)
  returning id into new_id;
  if price > 0 then
    insert into public.event_escrow (event_key, user_id, kind, amount, status) values ('db:' || new_id, uid, 'creation', price, 'spent');
  end if;
  if topup > 0 then
    insert into public.event_escrow (event_key, user_id, kind, amount, status) values ('db:' || new_id, uid, 'pool', topup, 'held');
  end if;
  return jsonb_build_object('id', new_id, 'cost', price + topup);
end $$;
revoke execute on function public.create_event(jsonb) from public, anon;
grant execute on function public.create_event(jsonb) to authenticated;

-- cancel: admins any time, the creator before it starts. Everyone who paid gets their fee back;
-- the creator gets the prize top-up back (the creation fee is only returned when an admin cancels).
create or replace function public.cancel_event(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  ev public.events;
  k text := 'db:' || p_id;
  admin boolean := public.is_admin();
begin
  select * into ev from public.events where id = p_id for update;
  if not found or ev.status <> 'published' then raise exception 'not found'; end if;
  if not admin and (ev.owner_id is distinct from auth.uid() or now() >= ev.starts_at) then raise exception 'not allowed'; end if;
  update public.events set status = 'cancelled' where id = p_id;
  insert into public.event_rewards (user_id, event_key, coins, reason)
    select user_id, k, sum(amount), 'Refund: ' || ev.name || ' was cancelled'
    from public.event_escrow where event_key = k and status = 'held' group by user_id;
  update public.event_escrow set status = 'refunded', settled_at = now() where event_key = k and status = 'held';
  if admin then
    insert into public.event_rewards (user_id, event_key, coins, reason)
      select user_id, k, amount, 'Creation fee returned: ' || ev.name from public.event_escrow where event_key = k and kind = 'creation' and status = 'spent';
    update public.event_escrow set status = 'refunded', settled_at = now() where event_key = k and kind = 'creation' and status = 'spent';
  end if;
end $$;
revoke execute on function public.cancel_event(uuid) from public, anon;
grant execute on function public.cancel_event(uuid) to authenticated;

-- a mini-game score in an event space; keeps each rider's best per game
create or replace function public.submit_event_score(p_key text, p_game text, p_score integer)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev public.events;
  pr public.profiles;
  pts integer := 0;
  top integer := case p_game when 'quiz' then 960 when 'target' then 2000 else 0 end;
begin
  if uid is null then raise exception 'signin'; end if;
  if p_score < 0 or p_score > top then raise exception 'bad score'; end if;
  if p_key ~ '^db:[0-9a-f-]{36}$' then
    select * into ev from public.events where id = substr(p_key, 4)::uuid;
    if not found or ev.status <> 'published' or now() < ev.starts_at - interval '15 minutes' or now() > ev.ends_at + interval '10 minutes' then raise exception 'not live'; end if;
    if not exists (select 1 from public.event_registrations where event_key = p_key and user_id = uid) then
      insert into public.event_registrations (event_key, user_id) values (p_key, uid) on conflict do nothing;
      if ev.fee > 0 then raise exception 'join first'; end if;
    end if;
    pts := least(500, greatest(0, coalesce((ev.rewards->>'hall')::integer, 0)));
  elsif p_key ~ '^off:[a-z0-9:-]{3,80}$' then
    pts := case when p_key like 'off:hallwars-%' then 50 else 0 end;
  else
    raise exception 'bad event';
  end if;
  select * into pr from public.profiles where id = uid;
  insert into public.event_results (event_key, user_id, game, name, hall, score, hall_points)
  values (p_key, uid, p_game, coalesce(pr.name, 'Rider'), coalesce(pr.hall, 'none'), p_score, pts)
  on conflict (event_key, user_id, game) do update set score = greatest(public.event_results.score, excluded.score), updated_at = now();
end $$;
revoke execute on function public.submit_event_score(text, text, integer) from public, anon;
grant execute on function public.submit_event_score(text, text, integer) to authenticated;

-- hall points from events since a date (Hall Wars / Hall Championship)
create or replace function public.event_hall_points(p_since timestamptz)
returns table (hall text, points integer)
language sql stable security definer set search_path = public as $$
  select hall, sum(pts)::integer from (
    select distinct on (event_key, user_id) hall, hall_points as pts
    from public.event_results where updated_at >= p_since and hall_points > 0
    order by event_key, user_id, hall_points desc
  ) x group by hall order by 2 desc;
$$;
grant execute on function public.event_hall_points(timestamptz) to anon, authenticated;

-- after a rider event ends: the prize pool (entry fees + top-up) goes 60/25/15 to the top three by
-- total score; with no scores, everyone is refunded. Admins run it, or schedule it with pg_cron:
--   select cron.schedule('settle-events', '*/15 * * * *', $$select public.settle_ended_events()$$);
create or replace function public.settle_event(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  ev public.events;
  k text := 'db:' || p_id;
  pool integer;
  shares numeric[] := array[0.6, 0.25, 0.15];
  w record;
  i integer := 0;
  paid integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'not allowed'; end if;
  select * into ev from public.events where id = p_id for update;
  if not found or ev.status <> 'published' or now() < ev.ends_at then return; end if;
  select coalesce(sum(amount), 0) into pool from public.event_escrow where event_key = k and status = 'held';
  if pool > 0 then
    if exists (select 1 from public.event_results where event_key = k) then
      for w in select user_id, sum(score) as total from public.event_results where event_key = k group by user_id order by 2 desc, min(updated_at) limit 3 loop
        i := i + 1;
        insert into public.event_rewards (user_id, event_key, coins, reason)
          values (w.user_id, k, floor(pool * shares[i])::integer, case i when 1 then 'Winner' when 2 then 'Second place' else 'Third place' end || ': ' || ev.name);
        paid := paid + floor(pool * shares[i])::integer;
      end loop;
      update public.event_escrow set status = 'paid_out', settled_at = now() where event_key = k and status = 'held';
    else
      insert into public.event_rewards (user_id, event_key, coins, reason)
        select user_id, k, sum(amount), 'Refund: nobody played at ' || ev.name from public.event_escrow where event_key = k and status = 'held' group by user_id;
      update public.event_escrow set status = 'refunded', settled_at = now() where event_key = k and status = 'held';
    end if;
  end if;
  update public.events set status = 'settled' where id = p_id;
end $$;
revoke execute on function public.settle_event(uuid) from public, anon;
grant execute on function public.settle_event(uuid) to authenticated;

create or replace function public.settle_ended_events()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'not allowed'; end if;
  for r in select id from public.events where status = 'published' and ends_at < now() limit 50 loop
    perform public.settle_event(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.settle_ended_events() from public, anon;
grant execute on function public.settle_ended_events() to authenticated;

-- the game adds what the server owes (prizes, refunds), once each
create or replace function public.claim_event_rewards()
returns table (coins integer, xp integer, diamonds integer, items text[], reason text, event_key text)
language sql volatile security definer set search_path = public as $$
  update public.event_rewards r set claimed_at = now()
  where r.user_id = auth.uid() and r.claimed_at is null
  returning r.coins, r.xp, r.diamonds, r.items, r.reason, r.event_key;
$$;
revoke execute on function public.claim_event_rewards() from public, anon;
grant execute on function public.claim_event_rewards() to authenticated;

-- a report from an event space (chat lines are kept for review)
create or replace function public.report_event_rider(p_key text, p_who text, p_name text, p_reason text, p_lines jsonb)
returns void
language sql volatile security definer set search_path = public as $$
  insert into public.event_reports (reporter, event_key, reported, reported_name, reason, lines)
  select auth.uid(), left(p_key, 100), left(p_who, 80), left(p_name, 24), left(p_reason, 60),
         coalesce((select jsonb_agg(left(x, 200)) from jsonb_array_elements_text(p_lines) x), '[]'::jsonb)
  where auth.uid() is not null;
$$;
revoke execute on function public.report_event_rider(text, text, text, text, jsonb) from public, anon;
grant execute on function public.report_event_rider(text, text, text, text, jsonb) to authenticated;

-- ===================== supabase/sql/20-challenges.sql =====================
-- LEGONRUSH Race Challenges: player-made and official challenges, entries with coin escrow,
-- invitations, attempts and results, prize payouts, reports and bans.
-- Run after supabase/schema.sql and supabase/sql/00-core.sql. Safe to run again.
-- Then deploy the result checker for paid challenges:  supabase functions deploy challenge-submit
-- (it uses the same secrets as the other functions; see supabase/functions/README.md).
--
-- How it fits together
--  * Riders READ through row level security; every WRITE goes through a security-definer function
--    below, which checks the rules (who, when, how many, how much). Nothing is written straight
--    from the app.
--  * Coins still live in the game on the phone. The server keeps the money side of a challenge
--    honest where it can: entry fees are recorded per entry (challenge_entries.paid, the escrow),
--    prizes are paid only out of that escrow (never more than riders actually put in), and the
--    game collects payouts once with challenge_claim().
--  * Free challenges post results with challenge_submit() (time checks). Paid challenges post
--    through the Edge Function supabase/functions/challenge-submit, which checks the whole ride
--    recording with _shared/runcheck.ts (the prize-race anti-cheat) before challenge_record().
--  * Lobby readiness is live presence on a Realtime channel named chal:<id> (src/live.ts), so it
--    needs no table. challenge_entries is added to the realtime publication so a lobby can also
--    watch registrations.
--  * Official LEGONRUSH challenges are made by code in the game (same schedule on every phone).
--    The first rider to join or ride one creates its row with challenge_official(); they are
--    always free, so a made-up official row can't move any coins.
--
-- Error messages: functions raise 'code: Words for the rider.' and the game shows the words.

-- ---------- settings ----------

insert into public.config (key, value) values ('challenges', jsonb_build_object(
  'creationFee', 500, 'entryMin', 50, 'entryMax', 1000, 'maxPool', 10000, 'maxRiders', 10,
  'perDay', 5, 'officialBonus', 100, 'disabledRoutes', '[]'::jsonb, 'disabledFormats', '["tournament"]'::jsonb
)) on conflict (key) do nothing;

create or replace function public.challenge_cfg(p_key text, p_default integer)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> p_key)::integer from config where key = 'challenges'), p_default);
$$;
create or replace function public.challenge_cfg_list(p_key text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select array(select jsonb_array_elements_text(value -> p_key)) from config where key = 'challenges'), '{}');
$$;

-- ---------- tables ----------

-- route lengths as the game builds them (src/features/challenges/model.ts ROUTE_LENGTH)
create table if not exists public.challenge_routes (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  length_m integer not null check (length_m between 300 and 20000)
);
insert into public.challenge_routes (id, name, length_m) values
  ('limann-great-hall', 'Limann to Great Hall', 2576),
  ('engineering-run', 'Engineering Run', 2422),
  ('balme-sprint', 'Balme Sprint', 1491),
  ('hall-loop', 'Hall Loop', 1773),
  ('legon-hill', 'Legon Hill', 1950),
  ('sunset-route', 'Sunset Route', 2643),
  ('night-circuit', 'Night Circuit', 2945)
on conflict (id) do update set name = excluded.name, length_m = excluded.length_m;

create table if not exists public.challenges (
  id text primary key default gen_random_uuid()::text,
  code text unique check (code ~ '^LR-[A-Z0-9]{5}$'),
  official boolean not null default false,
  name text check (official or char_length(btrim(name)) between 3 and 40),
  description text not null default '' check (char_length(description) <= 160),
  creator_id uuid references public.profiles on delete set null,
  route text not null references public.challenge_routes,
  format text not null check (format in ('time_trial', 'live_race', 'ghost', 'best_of', 'tournament')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  access text not null default 'open' check (access in ('open', 'friends', 'code', 'link', 'hall')),
  hall text check (hall is null or hall ~ '^[a-z-]{2,20}$'),
  max_riders integer not null default 10 check (max_riders between 2 and 10000),
  entry_fee integer not null default 0 check (entry_fee >= 0),
  prize text not null default 'top3' check (prize in ('top3', 'top2', 'winner')),
  starts_at timestamptz not null,
  reg_closes_at timestamptz not null,
  ends_at timestamptz not null,
  start_now boolean not null default false,
  status text not null default 'open' check (status in ('open', 'live', 'ended', 'cancelled', 'removed')),
  -- ghost challenges: the run everyone races ({name, time, run: {step, d, x}})
  ghost jsonb check (ghost is null or pg_column_size(ghost) < 200000),
  creation_fee integer not null default 0,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '8 days')
);
create index if not exists challenges_live on public.challenges (status, ends_at);
create index if not exists challenges_creator on public.challenges (creator_id, created_at);

-- who is in: paid is the entry fee held for the prize pool (the escrow)
create table if not exists public.challenge_entries (
  challenge_id text not null references public.challenges on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  paid integer not null default 0 check (paid >= 0),
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index if not exists challenge_entries_user on public.challenge_entries (user_id);

create table if not exists public.challenge_invites (
  challenge_id text not null references public.challenges on delete cascade,
  to_id uuid not null references public.profiles on delete cascade,
  from_id uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (challenge_id, to_id)
);
create index if not exists challenge_invites_to on public.challenge_invites (to_id, status);

-- a ticket per ride: the server notes when it started and counts attempts
create table if not exists public.challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  challenge_id text not null references public.challenges on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  issued_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists challenge_attempts_user on public.challenge_attempts (challenge_id, user_id);

create table if not exists public.challenge_results (
  id bigint generated always as identity primary key,
  challenge_id text not null references public.challenges on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  attempt_id uuid unique references public.challenge_attempts on delete set null,
  time numeric(8, 2) not null,
  accepted boolean not null,
  reason text,
  -- paid challenges keep the recording of accepted rides, for disputes
  trace jsonb,
  created_at timestamptz not null default now()
);
create index if not exists challenge_results_board on public.challenge_results (challenge_id, accepted, time);

-- prizes and refunds, collected once by the game (challenge_claim)
create table if not exists public.challenge_payouts (
  id bigint generated always as identity primary key,
  challenge_id text not null references public.challenges on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  coins integer not null check (coins > 0),
  kind text not null check (kind in ('prize', 'refund')),
  place smallint,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists challenge_payouts_user on public.challenge_payouts (user_id, claimed_at);

create table if not exists public.challenge_reports (
  id bigint generated always as identity primary key,
  challenge_id text not null references public.challenges on delete cascade,
  by_id uuid not null references public.profiles on delete cascade,
  reason text not null check (char_length(reason) <= 120),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.challenge_bans (
  user_id uuid primary key references public.profiles on delete cascade,
  reason text,
  until timestamptz not null,
  by_id uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- who can see what ----------

create or replace function public.challenge_can_see(p_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from challenges c where c.id = p_id and (
      public.is_admin() or (c.status <> 'removed' and (
        c.access in ('open', 'hall') or c.official or c.creator_id = auth.uid()
        or exists (select 1 from challenge_entries e where e.challenge_id = c.id and e.user_id = auth.uid())
        or exists (select 1 from challenge_invites i where i.challenge_id = c.id and i.to_id = auth.uid())
      ))
    )
  );
$$;

alter table public.challenge_routes enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_entries enable row level security;
alter table public.challenge_invites enable row level security;
alter table public.challenge_attempts enable row level security;
alter table public.challenge_results enable row level security;
alter table public.challenge_payouts enable row level security;
alter table public.challenge_reports enable row level security;
alter table public.challenge_bans enable row level security;

drop policy if exists "routes read" on public.challenge_routes;
create policy "routes read" on public.challenge_routes for select using (true);
drop policy if exists "challenges read" on public.challenges;
create policy "challenges read" on public.challenges for select using (public.challenge_can_see(id));
drop policy if exists "entries read" on public.challenge_entries;
create policy "entries read" on public.challenge_entries for select using (public.challenge_can_see(challenge_id));
drop policy if exists "invites read" on public.challenge_invites;
create policy "invites read" on public.challenge_invites for select using (to_id = auth.uid() or from_id = auth.uid());
drop policy if exists "attempts read own" on public.challenge_attempts;
create policy "attempts read own" on public.challenge_attempts for select using (user_id = auth.uid());
drop policy if exists "results read own" on public.challenge_results;
create policy "results read own" on public.challenge_results for select using (user_id = auth.uid());
drop policy if exists "payouts read own" on public.challenge_payouts;
create policy "payouts read own" on public.challenge_payouts for select using (user_id = auth.uid());
drop policy if exists "reports admin" on public.challenge_reports;
create policy "reports admin" on public.challenge_reports for select using (public.is_admin());
drop policy if exists "bans read" on public.challenge_bans;
create policy "bans read" on public.challenge_bans for select using (user_id = auth.uid() or public.is_admin());
-- (no insert/update/delete policies: writes only through the functions below)

-- lobbies can watch registrations as they happen
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'challenge_entries') then
    alter publication supabase_realtime add table public.challenge_entries;
  end if;
end $$;

-- ---------- the shape the game reads ----------

create or replace function public.challenge_json(c public.challenges)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(c) - 'creation_fee' - 'settled_at'
    || jsonb_build_object(
      'riders', (select count(*) from challenge_entries e where e.challenge_id = c.id),
      'joined', exists (select 1 from challenge_entries e where e.challenge_id = c.id and e.user_id = auth.uid()),
      'creator_name', p.name, 'creator_username', p.username, 'creator_hall', p.hall,
      'invite_status', i.status, 'invite_from', f.name,
      -- the code only for people who may pass it on: anyone for open/code/link, the creator otherwise
      'code', case when c.access in ('open', 'hall', 'code', 'link') or c.creator_id = auth.uid() then c.code end
    )
  from (select 1) one
  left join profiles p on p.id = c.creator_id
  left join challenge_invites i on i.challenge_id = c.id and i.to_id = auth.uid()
  left join profiles f on f.id = i.from_id;
$$;

-- what the Challenges tab lists: public ones and anything I'm part of, from the last week on
create or replace function public.challenge_feed()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.challenge_json(c) from challenges c
  where c.ends_at > now() - interval '7 days' and c.status <> 'removed'
    and (c.access in ('open', 'hall')
      or c.creator_id = auth.uid()
      or exists (select 1 from challenge_entries e where e.challenge_id = c.id and e.user_id = auth.uid())
      or exists (select 1 from challenge_invites i where i.challenge_id = c.id and i.to_id = auth.uid()))
    and (not c.official or exists (select 1 from challenge_entries e where e.challenge_id = c.id))
  order by c.starts_at
  limit 400;
$$;

create or replace function public.challenge_by_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.challenge_json(c) from challenges c where c.code = upper(p_code) and c.status <> 'removed';
$$;

create or replace function public.challenge_get(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  -- code and link challenges open for anyone holding the id (from a link)
  select public.challenge_json(c) from challenges c
  where c.id = p_id and c.status <> 'removed' and (c.access in ('code', 'link') or public.challenge_can_see(c.id));
$$;

-- ---------- making challenges ----------

create or replace function public.challenge_check(p jsonb)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_starts timestamptz := (p ->> 'starts_at')::timestamptz;
  v_ends timestamptz := (p ->> 'ends_at')::timestamptz;
  v_close timestamptz := (p ->> 'reg_closes_at')::timestamptz;
  v_fee integer := coalesce((p ->> 'entry_fee')::integer, 0);
  v_max integer := (p ->> 'max_riders')::integer;
  v_hours numeric := extract(epoch from (v_ends - v_starts)) / 3600;
begin
  if not exists (select 1 from challenge_routes where id = p ->> 'route') or (p ->> 'route') = any (public.challenge_cfg_list('disabledRoutes')) then
    raise exception 'route: That route is closed for challenges right now.';
  end if;
  if (p ->> 'format') = 'tournament' or (p ->> 'format') = any (public.challenge_cfg_list('disabledFormats')) then
    raise exception 'format: That format isn''t available right now.';
  end if;
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 3 and 40 then raise exception 'name: Names are 3 to 40 letters.'; end if;
  if v_max is null or v_max < 2 or v_max > least(10, public.challenge_cfg('maxRiders', 10)) then raise exception 'riders: Pick 2 to % riders.', public.challenge_cfg('maxRiders', 10); end if;
  if v_fee <> 0 and (v_fee < public.challenge_cfg('entryMin', 50) or v_fee > public.challenge_cfg('entryMax', 1000)) then
    raise exception 'fee: Entry fees go from % to % coins.', public.challenge_cfg('entryMin', 50), public.challenge_cfg('entryMax', 1000);
  end if;
  if v_fee * v_max > public.challenge_cfg('maxPool', 10000) then raise exception 'pool: That prize pool is bigger than allowed.'; end if;
  if v_starts < now() - interval '2 minutes' or v_starts > now() + interval '30 days' then raise exception 'time: Pick a start between now and 30 days ahead.'; end if;
  if round(v_hours) not in (1, 6, 24, 72, 168) then raise exception 'time: Pick how long it runs: 1 hour, 6 hours, 1, 3 or 7 days.'; end if;
  if v_close > v_ends or v_close < now() - interval '2 minutes' then raise exception 'time: Registration must close between now and the end.'; end if;
  if (p ->> 'format') = 'best_of' and coalesce((p ->> 'attempts')::integer, 0) not between 2 and 5 then raise exception 'attempts: Best of 2 to 5 attempts.'; end if;
  if (p ->> 'format') = 'ghost' and (p -> 'ghost' -> 'run' -> 'd') is null then raise exception 'ghost: Ghost challenges need a recorded run.'; end if;
  if (p ->> 'access') = 'hall' and (p ->> 'hall') is distinct from (select hall from profiles where id = auth.uid()) then raise exception 'hall: Hall challenges are for your own hall.'; end if;
end $$;

create or replace function public.challenge_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_code text;
  v_row challenges;
  v_fee integer := coalesce((p ->> 'entry_fee')::integer, 0);
begin
  if v_me is null then raise exception 'sign_in: Sign in to create challenges.'; end if;
  if exists (select 1 from challenge_bans where user_id = v_me and until > now()) then raise exception 'banned: You can''t create challenges right now.'; end if;
  if (select count(*) from challenges where creator_id = v_me and created_at > now() - interval '1 day') >= public.challenge_cfg('perDay', 5) then
    raise exception 'limit: You can create % challenges a day.', public.challenge_cfg('perDay', 5);
  end if;
  perform public.challenge_check(p);
  loop
    v_code := 'LR-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '') from generate_series(1, 5));
    exit when not exists (select 1 from challenges where code = v_code);
  end loop;
  insert into challenges (code, name, description, creator_id, route, format, attempts, access, hall, max_riders, entry_fee, prize,
    starts_at, reg_closes_at, ends_at, start_now, ghost, creation_fee)
  values (v_code, btrim(p ->> 'name'), left(coalesce(p ->> 'description', ''), 160), v_me, p ->> 'route', p ->> 'format',
    case p ->> 'format' when 'best_of' then (p ->> 'attempts')::smallint when 'live_race' then 1 else 0 end,
    p ->> 'access', case when p ->> 'access' = 'hall' then p ->> 'hall' end, (p ->> 'max_riders')::integer, v_fee,
    coalesce(p ->> 'prize', 'top3'), (p ->> 'starts_at')::timestamptz, (p ->> 'reg_closes_at')::timestamptz, (p ->> 'ends_at')::timestamptz,
    coalesce((p ->> 'start_now')::boolean, false), case when p ->> 'format' = 'ghost' then p -> 'ghost' end,
    public.challenge_cfg('creationFee', 500))
  returning * into v_row;
  -- the creator is in from the start of a free challenge; paid ones they join (and pay) like everyone
  if v_fee = 0 then insert into challenge_entries (challenge_id, user_id) values (v_row.id, v_me); end if;
  return public.challenge_json(v_row);
end $$;

create or replace function public.challenge_update(p_id text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row challenges;
begin
  select * into v_row from challenges where id = p_id for update;
  if v_row.id is null or v_row.creator_id is distinct from auth.uid() then raise exception 'denied: Only the creator can edit this challenge.'; end if;
  if v_row.status <> 'open' or exists (select 1 from challenge_entries where challenge_id = p_id and user_id <> auth.uid()) then
    raise exception 'locked: Riders have joined, so the settings are locked.';
  end if;
  perform public.challenge_check(p);
  update challenges set name = btrim(p ->> 'name'), description = left(coalesce(p ->> 'description', ''), 160), route = p ->> 'route',
    format = p ->> 'format', attempts = case p ->> 'format' when 'best_of' then (p ->> 'attempts')::smallint when 'live_race' then 1 else 0 end,
    access = p ->> 'access', hall = case when p ->> 'access' = 'hall' then p ->> 'hall' end, max_riders = (p ->> 'max_riders')::integer,
    entry_fee = coalesce((p ->> 'entry_fee')::integer, 0), prize = coalesce(p ->> 'prize', 'top3'), starts_at = (p ->> 'starts_at')::timestamptz,
    reg_closes_at = (p ->> 'reg_closes_at')::timestamptz, ends_at = (p ->> 'ends_at')::timestamptz, start_now = coalesce((p ->> 'start_now')::boolean, false),
    ghost = case when p ->> 'format' = 'ghost' then p -> 'ghost' end
  where id = p_id returning * into v_row;
  -- a free challenge became paid: the creator's free place goes (they join and pay like everyone)
  if v_row.entry_fee > 0 then delete from challenge_entries where challenge_id = p_id and user_id = auth.uid() and paid = 0; end if;
  if v_row.entry_fee = 0 then insert into challenge_entries (challenge_id, user_id) values (p_id, auth.uid()) on conflict do nothing; end if;
  return public.challenge_json(v_row);
end $$;

-- official challenges: made by the game's schedule, always free; the first rider creates the row
create or replace function public.challenge_official(p_id text, p_route text, p_format text, p_attempts integer, p_starts timestamptz, p_ends timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_day date;
begin
  if auth.uid() is null then raise exception 'sign_in: Sign in to post times.'; end if;
  if p_id !~ '^off-[a-z-]+-[a-z0-9-]+-[0-9]{8}$' then raise exception 'bad: Not an official challenge.'; end if;
  v_day := to_date(right(p_id, 8), 'YYYYMMDD');
  if abs(v_day - (now() at time zone 'Africa/Accra')::date) > 15 or abs(p_starts::date - v_day) > 1 then raise exception 'bad: That official challenge is not on now.'; end if;
  if p_ends <= p_starts or p_ends - p_starts > interval '24 hours' then raise exception 'bad: Not an official challenge.'; end if;
  if p_format not in ('time_trial', 'live_race', 'ghost', 'best_of') or p_attempts not between 0 and 5 then raise exception 'bad: Not an official challenge.'; end if;
  insert into challenges (id, official, route, format, attempts, access, max_riders, entry_fee, starts_at, reg_closes_at, ends_at)
  values (p_id, true, p_route, p_format, p_attempts, 'open', case when p_format = 'live_race' then 10 else 10000 end, 0, p_starts,
    case when p_format = 'live_race' then p_starts else p_ends end, p_ends)
  on conflict (id) do nothing;
end $$;

-- ---------- joining ----------

create or replace function public.challenge_join(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_row challenges;
begin
  if v_me is null then raise exception 'sign_in: Sign in to join challenges.'; end if;
  select * into v_row from challenges where id = p_id for update;
  if v_row.id is null or v_row.status in ('removed') then raise exception 'missing: That challenge doesn''t exist any more.'; end if;
  if exists (select 1 from challenge_entries where challenge_id = p_id and user_id = v_me) then return jsonb_build_object('fee', 0); end if;
  if v_row.status in ('ended', 'cancelled') or v_row.ends_at <= now() then raise exception 'closed: This challenge has ended.'; end if;
  if v_row.reg_closes_at <= now() or (v_row.format = 'live_race' and v_row.status = 'live') then raise exception 'closed: Registration is closed.'; end if;
  if (select count(*) from challenge_entries where challenge_id = p_id) >= v_row.max_riders then raise exception 'full: This challenge is full.'; end if;
  if v_row.access = 'hall' and v_row.hall is distinct from (select hall from profiles where id = v_me) then raise exception 'hall: This challenge is for another hall.'; end if;
  if v_row.access = 'friends' and v_row.creator_id <> v_me and not exists (select 1 from challenge_invites where challenge_id = p_id and to_id = v_me) then
    raise exception 'invite: This challenge is for invited riders only.';
  end if;
  insert into challenge_entries (challenge_id, user_id, paid) values (p_id, v_me, v_row.entry_fee);
  update challenge_invites set status = 'accepted' where challenge_id = p_id and to_id = v_me;
  return jsonb_build_object('fee', v_row.entry_fee);
end $$;

create or replace function public.challenge_leave(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row challenges; v_paid integer;
begin
  select * into v_row from challenges where id = p_id for update;
  if v_row.id is null then return jsonb_build_object('refund', 0); end if;
  if v_row.creator_id = auth.uid() and v_row.entry_fee = 0 then raise exception 'creator: You made this challenge. Cancel it instead.'; end if;
  if v_row.starts_at <= now() and not (v_row.start_now and v_row.status = 'open') then raise exception 'started: The challenge has started, so you can''t leave it now.'; end if;
  if exists (select 1 from challenge_attempts where challenge_id = p_id and user_id = auth.uid()) then raise exception 'started: You have ridden it already.'; end if;
  delete from challenge_entries where challenge_id = p_id and user_id = auth.uid() returning paid into v_paid;
  return jsonb_build_object('refund', coalesce(v_paid, 0));
end $$;

create or replace function public.challenge_invite(p_id text, p_usernames text[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_row challenges; v_n integer;
begin
  select * into v_row from challenges where id = p_id;
  if v_row.creator_id is distinct from auth.uid() then raise exception 'denied: Only the creator can invite riders.'; end if;
  if v_row.status not in ('open', 'live') or v_row.ends_at <= now() then raise exception 'closed: This challenge has ended.'; end if;
  if (select count(*) from challenge_invites where challenge_id = p_id) + coalesce(array_length(p_usernames, 1), 0) > 50 then raise exception 'limit: Up to 50 invitations per challenge.'; end if;
  insert into challenge_invites (challenge_id, to_id, from_id)
    select p_id, p.id, auth.uid() from profiles p where lower(p.username) = any (select lower(u) from unnest(p_usernames[1:20]) u) and p.id <> auth.uid()
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.challenge_answer_invite(p_id text, p_accept boolean)
returns void language sql security definer set search_path = public as $$
  update challenge_invites set status = case when p_accept then 'accepted' else 'declined' end where challenge_id = p_id and to_id = auth.uid();
$$;

-- ---------- creator controls ----------

create or replace function public.challenge_close_registration(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update challenges set reg_closes_at = least(reg_closes_at, now()) where id = p_id and creator_id = auth.uid() and status in ('open', 'live');
  if not found then raise exception 'denied: Only the creator can do that.'; end if;
end $$;

-- "Start now" live races: the creator starts the race from the lobby
create or replace function public.challenge_start_now(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update challenges set status = 'live', starts_at = now(), reg_closes_at = now()
  where id = p_id and creator_id = auth.uid() and status = 'open' and format = 'live_race' and ends_at > now()
    and (select count(*) from challenge_entries where challenge_id = p_id) >= 2;
  if not found then raise exception 'denied: The race can''t be started now.'; end if;
end $$;

-- refunds every entry fee still held (cancel, remove)
create or replace function public.challenge_refund_all(p_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into challenge_payouts (challenge_id, user_id, coins, kind) select challenge_id, user_id, paid, 'refund' from challenge_entries where challenge_id = p_id and paid > 0;
  get diagnostics v_n = row_count;
  update challenge_entries set paid = 0 where challenge_id = p_id;
  update challenges set settled_at = now() where id = p_id;
  return v_n;
end $$;
revoke execute on function public.challenge_refund_all(text) from public, anon, authenticated;

create or replace function public.challenge_cancel(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row challenges;
begin
  select * into v_row from challenges where id = p_id for update;
  if v_row.creator_id is distinct from auth.uid() then raise exception 'denied: Only the creator can cancel this challenge.'; end if;
  if v_row.status in ('ended', 'cancelled', 'removed') or v_row.settled_at is not null then raise exception 'closed: This challenge is already over.'; end if;
  if v_row.format = 'live_race' and (v_row.status = 'live' or v_row.starts_at <= now()) and not v_row.start_now then raise exception 'started: The race has started.'; end if;
  if exists (select 1 from challenge_results where challenge_id = p_id and user_id <> auth.uid()) then raise exception 'started: Riders have posted times, so it can''t be cancelled.'; end if;
  update challenges set status = 'cancelled' where id = p_id;
  return jsonb_build_object('refunded', public.challenge_refund_all(p_id));
end $$;

-- ---------- rides and results ----------

create or replace function public.challenge_start_attempt(p_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_row challenges;
  v_id uuid;
begin
  if v_me is null then raise exception 'sign_in: Sign in to post times.'; end if;
  select * into v_row from challenges where id = p_id for update;
  if v_row.id is null then raise exception 'missing: Challenge not found.'; end if;
  if v_row.status in ('ended', 'cancelled', 'removed') or v_row.ends_at <= now() then raise exception 'closed: This challenge has ended.'; end if;
  if v_row.starts_at > now() + interval '1 minute' or (v_row.format = 'live_race' and v_row.start_now and v_row.status <> 'live' and v_row.starts_at > now()) then
    raise exception 'closed: This challenge hasn''t started yet.';
  end if;
  if not exists (select 1 from challenge_entries where challenge_id = p_id and user_id = v_me) then
    -- free public challenges: riding is joining
    if v_row.entry_fee > 0 or v_row.access not in ('open', 'hall') or v_row.reg_closes_at <= now()
       or (select count(*) from challenge_entries where challenge_id = p_id) >= v_row.max_riders then
      raise exception 'join: Join the challenge first.';
    end if;
    if v_row.access = 'hall' and v_row.hall is distinct from (select hall from profiles where id = v_me) then raise exception 'hall: This challenge is for another hall.'; end if;
    insert into challenge_entries (challenge_id, user_id) values (p_id, v_me);
  end if;
  if v_row.attempts > 0 and (select count(*) from challenge_attempts where challenge_id = p_id and user_id = v_me) >= v_row.attempts then
    raise exception 'attempts: You have used all your attempts.';
  end if;
  if (select count(*) from challenge_attempts where user_id = v_me and issued_at > now() - interval '1 hour') >= 40 then raise exception 'rate: Too many rides in a short time. Try again later.'; end if;
  insert into challenge_attempts (challenge_id, user_id) values (p_id, v_me) returning id into v_id;
  return v_id;
end $$;

-- best accepted time per rider; earlier wins a tie
create or replace function public.challenge_best(p_id text)
returns table (user_id uuid, best numeric, at timestamptz) language sql stable security definer set search_path = public as $$
  select distinct on (r.user_id) r.user_id, r.time, r.created_at from challenge_results r
  where r.challenge_id = p_id and r.accepted order by r.user_id, r.time, r.created_at;
$$;
revoke execute on function public.challenge_best(text) from public, anon;

-- free challenges: the game posts its time; the server checks it is possible
create or replace function public.challenge_submit(p_attempt uuid, p_time numeric, p_finished boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_a challenge_attempts;
  v_row challenges;
  v_len integer;
  v_reason text;
  v_place integer;
  v_riders integer;
begin
  update challenge_attempts set used_at = now() where id = p_attempt and user_id = auth.uid() and used_at is null returning * into v_a;
  if v_a.id is null then raise exception 'ticket: That ride was already counted.'; end if;
  select * into v_row from challenges where id = v_a.challenge_id;
  if v_row.entry_fee > 0 then raise exception 'ticket: Paid challenges are checked by the challenge-submit service.'; end if;
  select length_m into v_len from challenge_routes where id = v_row.route;
  v_reason := case
    when not p_finished then 'Only finished rides count.'
    when p_time is null or p_time < 20 or p_time > 3600 then 'That time is outside what the challenge allows.'
    when p_time < v_len / 40.0 then 'Faster than the game allows.'
    when extract(epoch from (now() - v_a.issued_at)) + 2 < p_time then 'The result arrived sooner than the ride could have been ridden.'
    when v_a.issued_at > v_row.ends_at or now() > v_row.ends_at + interval '15 minutes' then 'The challenge had ended.'
  end;
  insert into challenge_results (challenge_id, user_id, attempt_id, time, accepted, reason)
  values (v_row.id, auth.uid(), v_a.id, round(least(9999, greatest(0, coalesce(p_time, 0))), 2), v_reason is null, v_reason);
  if v_reason is not null then return jsonb_build_object('accepted', false, 'reason', v_reason); end if;
  select count(*) into v_riders from public.challenge_best(v_row.id);
  select count(*) + 1 into v_place from public.challenge_best(v_row.id) b
    where b.best < (select best from public.challenge_best(v_row.id) where user_id = auth.uid());
  return jsonb_build_object('accepted', true, 'place', v_place, 'riders', v_riders);
end $$;

-- paid challenges: called only by the challenge-submit Edge Function (service role) after it has
-- checked the ride recording with _shared/runcheck.ts
create or replace function public.challenge_record(p_attempt uuid, p_user uuid, p_time numeric, p_accepted boolean, p_reason text, p_trace jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_a challenge_attempts; v_row challenges; v_ok boolean := p_accepted; v_reason text := p_reason; v_place integer; v_riders integer;
begin
  update challenge_attempts set used_at = now() where id = p_attempt and user_id = p_user and used_at is null returning * into v_a;
  if v_a.id is null then raise exception 'ticket: That ride was already counted.'; end if;
  select * into v_row from challenges where id = v_a.challenge_id;
  if v_ok and (v_a.issued_at > v_row.ends_at or now() > v_row.ends_at + interval '15 minutes') then v_ok := false; v_reason := 'closed'; end if;
  if v_ok and extract(epoch from (now() - v_a.issued_at)) + 2 < p_time then v_ok := false; v_reason := 'too_quick'; end if;
  insert into challenge_results (challenge_id, user_id, attempt_id, time, accepted, reason, trace)
  values (v_row.id, p_user, v_a.id, round(least(9999, greatest(0, coalesce(p_time, 0))), 2), v_ok, v_reason, case when v_ok then p_trace end);
  if not v_ok then return jsonb_build_object('accepted', false, 'reason', v_reason); end if;
  select count(*) into v_riders from public.challenge_best(v_row.id);
  select count(*) + 1 into v_place from public.challenge_best(v_row.id) b where b.best < (select best from public.challenge_best(v_row.id) where user_id = p_user);
  return jsonb_build_object('accepted', true, 'place', v_place, 'riders', v_riders);
end $$;
revoke execute on function public.challenge_record(uuid, uuid, numeric, boolean, text, jsonb) from public, anon, authenticated;

create or replace function public.challenge_board(p_id text)
returns table (rank bigint, user_id uuid, name text, username text, hall text, best numeric, attempts bigint, me boolean)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by b.best, b.at), b.user_id, p.name, p.username, p.hall, b.best,
    (select count(*) from challenge_results r where r.challenge_id = p_id and r.user_id = b.user_id), b.user_id = auth.uid()
  from public.challenge_best(p_id) b join profiles p on p.id = b.user_id
  where public.challenge_can_see(p_id) or exists (select 1 from challenges c where c.id = p_id and c.access in ('code', 'link'))
  order by b.best, b.at
  limit 100;
$$;

create or replace function public.challenge_stats(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from challenges c where c.id = p_id and (c.creator_id = auth.uid() or public.is_admin())) then
    jsonb_build_object(
      'participants', (select count(*) from challenge_entries where challenge_id = p_id),
      'finishers', (select count(*) from public.challenge_best(p_id)),
      'average', (select round(avg(best), 2) from public.challenge_best(p_id)),
      'fastest', (select min(best) from public.challenge_best(p_id)))
  end;
$$;

create or replace function public.challenge_entries(p_id text)
returns table (user_id uuid, name text, username text, hall text, bike text, xp integer, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.user_id, p.name, p.username, p.hall, p.bike, p.xp, e.joined_at from challenge_entries e join profiles p on p.id = e.user_id
  where e.challenge_id = p_id and (public.challenge_can_see(p_id) or exists (select 1 from challenges c where c.id = p_id and c.access in ('code', 'link')))
  order by e.joined_at limit 200;
$$;

-- ---------- the end: prizes out of the escrow ----------

-- Anyone may call this once a challenge is over; it pays out once. Prize shares follow the template
-- (top3 60/30/10, top2 70/30, winner 100). Shares for places nobody reached go to the winner. With
-- fewer than 2 finishers there is no race to win: everyone gets their entry back.
create or replace function public.challenge_settle(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row challenges;
  v_pool integer;
  v_split integer[];
  v_parts integer[];
  v_winners uuid[];
  v_i integer;
begin
  select * into v_row from challenges where id = p_id for update;
  if v_row.id is null or v_row.settled_at is not null or v_row.status in ('cancelled', 'removed') then return jsonb_build_object('settled', false); end if;
  if not (now() >= v_row.ends_at or (v_row.format = 'live_race' and v_row.status = 'live' and now() > v_row.starts_at + interval '30 minutes')) then
    return jsonb_build_object('settled', false);
  end if;
  select coalesce(sum(paid), 0) into v_pool from challenge_entries where challenge_id = p_id;
  select array_agg(b.user_id order by b.best, b.at) into v_winners from public.challenge_best(p_id) b;
  if v_pool > 0 then
    if coalesce(array_length(v_winners, 1), 0) < 2 then
      perform public.challenge_refund_all(p_id);
    else
      v_split := case v_row.prize when 'top2' then array[70, 30] when 'winner' then array[100] else array[60, 30, 10] end;
      v_parts := array(select floor(v_pool * s / 100.0)::integer from unnest(v_split) s);
      v_parts[1] := v_parts[1] + v_pool - (select sum(x) from unnest(v_parts) x);
      for v_i in 1 .. array_length(v_parts, 1) loop
        if v_parts[v_i] > 0 then
          insert into challenge_payouts (challenge_id, user_id, coins, kind, place)
          values (p_id, coalesce(v_winners[v_i], v_winners[1]), v_parts[v_i], 'prize', case when v_winners[v_i] is null then 1 else v_i end);
        end if;
      end loop;
      update challenge_entries set paid = 0 where challenge_id = p_id;
    end if;
  end if;
  update challenges set status = 'ended', settled_at = now() where id = p_id;
  return jsonb_build_object('settled', true);
end $$;

-- prizes and refunds not yet in the game: handed over once
create or replace function public.challenge_claim()
returns table (challenge_id text, name text, coins integer, kind text, place smallint)
language sql security definer set search_path = public as $$
  with mine as (
    update challenge_payouts set claimed_at = now() where user_id = auth.uid() and claimed_at is null
    returning challenge_payouts.challenge_id, challenge_payouts.coins, challenge_payouts.kind, challenge_payouts.place
  )
  select m.challenge_id, coalesce(c.name, 'an official challenge'), m.coins, m.kind, m.place from mine m join challenges c on c.id = m.challenge_id;
$$;

-- ---------- reports and admin ----------

create or replace function public.challenge_report(p_id text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in: Sign in to report.'; end if;
  if (select count(*) from challenge_reports where by_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then raise exception 'rate: Thanks, we have your reports.'; end if;
  insert into challenge_reports (challenge_id, by_id, reason) values (p_id, auth.uid(), left(p_reason, 120));
end $$;

create or replace function public.challenge_admin_reports()
returns table (id bigint, challenge_id text, name text, reason text, by_name text, created_at timestamptz, creator_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'denied: Admins only.'; end if;
  return query select r.id, r.challenge_id, c.name, r.reason, p.name, r.created_at, c.creator_id
    from challenge_reports r join challenges c on c.id = r.challenge_id left join profiles p on p.id = r.by_id
    where r.resolved_at is null order by r.created_at desc limit 100;
end $$;

create or replace function public.challenge_admin_recent()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'denied: Admins only.'; end if;
  return query select public.challenge_json(c) from challenges c where not c.official order by c.created_at desc limit 50;
end $$;

create or replace function public.challenge_admin_remove(p_id text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'denied: Admins only.'; end if;
  update challenges set status = 'removed' where id = p_id and status <> 'removed';
  if (select settled_at from challenges where id = p_id) is null then perform public.challenge_refund_all(p_id); end if;
  update challenge_reports set resolved_at = now() where challenge_id = p_id and resolved_at is null;
end $$;

create or replace function public.challenge_admin_ban(p_user uuid, p_reason text, p_days integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'denied: Admins only.'; end if;
  insert into challenge_bans (user_id, reason, until, by_id) values (p_user, left(p_reason, 200), now() + make_interval(days => greatest(1, least(3650, p_days))), auth.uid())
  on conflict (user_id) do update set reason = excluded.reason, until = excluded.until, by_id = excluded.by_id;
end $$;

create or replace function public.challenge_admin_dismiss(p_report bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'denied: Admins only.'; end if;
  update challenge_reports set resolved_at = now() where id = p_report;
end $$;

-- ---------- who may call what ----------

do $$
declare f text;
begin
  foreach f in array array[
    'challenge_feed()', 'challenge_by_code(text)', 'challenge_get(text)', 'challenge_create(jsonb)', 'challenge_update(text, jsonb)',
    'challenge_official(text, text, text, integer, timestamptz, timestamptz)', 'challenge_join(text)', 'challenge_leave(text)',
    'challenge_invite(text, text[])', 'challenge_answer_invite(text, boolean)', 'challenge_close_registration(text)', 'challenge_start_now(text)',
    'challenge_cancel(text)', 'challenge_start_attempt(text)', 'challenge_submit(uuid, numeric, boolean)', 'challenge_board(text)',
    'challenge_stats(text)', 'challenge_entries(text)', 'challenge_settle(text)', 'challenge_claim()', 'challenge_report(text, text)',
    'challenge_admin_reports()', 'challenge_admin_recent()', 'challenge_admin_remove(text, text)', 'challenge_admin_ban(uuid, text, integer)',
    'challenge_admin_dismiss(bigint)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- the leaderboard of public challenges can be read signed out too
grant execute on function public.challenge_board(text) to anon;
grant execute on function public.challenge_best(text) to authenticated;

-- ===================== supabase/sql/30-community.sql =====================
-- =====================================================================================
-- COMMUNITY: social status and privacy, friends, follows, blocks/mutes/hides, reports,
-- the community feed and reactions, crews, private and crew messages, dating (18+, opt-in),
-- notifications and community leaderboards.
-- Run after supabase/schema.sql and supabase/sql/00-core.sql. Safe to run again.
--
-- How privacy is enforced:
--  * Every table has row level security. Nothing about another rider is read straight from a
--    table: the app calls the security-definer functions below, which only return what that
--    rider's privacy settings allow the caller to see (cm_can_find, cm_card), and never return
--    anyone who blocked the caller or whom the caller blocked.
--  * A rider's real hall, programme, level and date of birth live in social_settings, readable
--    only by the rider. The public profiles table gets hall/department masked when they are
--    hidden, so race leaderboards respect the same switches.
--  * Dating only works for riders aged 18+ (from their date of birth), who switched it on, and a
--    like only becomes a connection when it is mutual.
-- =====================================================================================

-- ---------- settings: social status and privacy (one row per rider) ----------
create table if not exists public.social_settings (
  user_id uuid primary key references auth.users on delete cascade,
  campus text not null default 'ug' check (campus ~ '^[a-z0-9-]{2,20}$'),
  -- the rider's real hall / programme / academic level / birthday: never shown unless allowed
  hall text not null default 'none' check (hall ~ '^[a-z-]{2,20}$'),
  course text check (char_length(course) <= 80),
  level text check (level ~ '^[1-9]00$'),
  dob date,
  gender text check (gender in ('male', 'female')),
  statuses text[] not null default '{}' check (statuses <@ array['friends', 'dating', 'buddies', 'social', 'compete', 'none']::text[]),
  show_status boolean not null default true,
  find_me text not null default 'hall' check (find_me in ('everyone', 'fof', 'hall', 'course', 'nobody')),
  message_me text not null default 'friends' check (message_me in ('everyone', 'friends', 'connections', 'nobody')),
  requests_from text not null default 'shared' check (requests_from in ('everyone', 'shared', 'nobody')),
  vibe_from text not null default 'friends' check (vibe_from in ('everyone', 'friends', 'dating', 'nobody')),
  show_online boolean not null default true,
  show_hall boolean not null default true,
  show_course boolean not null default false,
  show_level boolean not null default false,
  show_map boolean not null default false,
  activity text not null default 'friends' check (activity in ('everyone', 'friends', 'off')),
  dating_on boolean not null default false,
  dating_min integer not null default 18 check (dating_min between 18 and 99),
  dating_max integer not null default 30 check (dating_max between 18 and 99),
  dating_genders text[] not null default '{}' check (dating_genders <@ array['male', 'female']::text[]),
  interests text[] not null default '{}' check (cardinality(interests) <= 8),
  notify jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  check (dating_min <= dating_max)
);
alter table public.social_settings enable row level security;
drop policy if exists "own settings" on public.social_settings;
create policy "own settings" on public.social_settings for select to authenticated using (user_id = auth.uid());

-- ---------- relationships ----------
-- one row per pair (a < b); requester sent it; accepted when status = 'accepted'
create table if not exists public.friendships (
  a uuid not null references auth.users on delete cascade,
  b uuid not null references auth.users on delete cascade,
  requester uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (a, b),
  check (a < b),
  check (requester in (a, b))
);
create index if not exists friendships_b on public.friendships (b);

create table if not exists public.follows (
  follower uuid not null references auth.users on delete cascade,
  followee uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee on public.follows (followee);

create table if not exists public.blocks (
  blocker uuid not null references auth.users on delete cascade,
  blocked uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists blocks_blocked on public.blocks (blocked);

create table if not exists public.mutes (
  user_id uuid not null references auth.users on delete cascade,
  muted uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted)
);

-- "hide from recommendations"
create table if not exists public.hides (
  user_id uuid not null references auth.users on delete cascade,
  hidden uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, hidden)
);

-- riders who shared a Vibe Ride (for "You rode together")
create table if not exists public.rode_together (
  user_id uuid not null references auth.users on delete cascade,
  other uuid not null references auth.users on delete cascade,
  at timestamptz not null default now(),
  primary key (user_id, other),
  check (user_id <> other)
);

-- reports for admins to review
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references auth.users on delete cascade,
  target_user uuid references auth.users on delete set null,
  kind text not null check (kind in ('user', 'post', 'message', 'crew')),
  target_id text check (char_length(target_id) <= 60),
  reason text not null check (char_length(reason) between 2 and 80),
  details text check (char_length(details) <= 500),
  context jsonb,
  status text not null default 'open' check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reports_open on public.reports (status, created_at desc);

alter table public.friendships enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.mutes enable row level security;
alter table public.hides enable row level security;
alter table public.rode_together enable row level security;
alter table public.reports enable row level security;
-- riders can see their own rows; every change goes through the functions below
drop policy if exists "own friendships" on public.friendships;
create policy "own friendships" on public.friendships for select to authenticated using (auth.uid() in (a, b));
drop policy if exists "own follows" on public.follows;
create policy "own follows" on public.follows for select to authenticated using (auth.uid() in (follower, followee));
drop policy if exists "own blocks" on public.blocks;
create policy "own blocks" on public.blocks for select to authenticated using (blocker = auth.uid());
drop policy if exists "own mutes" on public.mutes;
create policy "own mutes" on public.mutes for select to authenticated using (user_id = auth.uid());
drop policy if exists "own hides" on public.hides;
create policy "own hides" on public.hides for select to authenticated using (user_id = auth.uid());
drop policy if exists "own rides together" on public.rode_together;
create policy "own rides together" on public.rode_together for select to authenticated using (user_id = auth.uid());
drop policy if exists "own reports" on public.reports;
create policy "own reports" on public.reports for select to authenticated using (reporter = auth.uid() or public.is_admin());
drop policy if exists "admins review reports" on public.reports;
create policy "admins review reports" on public.reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- feed ----------
create table if not exists public.posts (
  id bigint generated always as identity primary key,
  author uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('text', 'activity', 'ride', 'event', 'challenge', 'achievement')),
  -- for game activity: what happened (race_win, pb, treasure, event_join, ...)
  akind text check (akind ~ '^[a-z_]{2,20}$'),
  text text not null check (char_length(text) between 1 and 280),
  ref text check (char_length(ref) <= 80),
  audience text not null default 'friends' check (audience in ('public', 'friends', 'hall', 'crew')),
  hall text,
  crew_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists posts_recent on public.posts (created_at desc);
create index if not exists posts_author on public.posts (author, created_at desc);
create index if not exists posts_crew on public.posts (crew_id, created_at desc) where crew_id is not null;

create table if not exists public.post_reactions (
  post_id bigint not null references public.posts on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('like', 'fire', 'laugh', 'clap', 'ride')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
drop policy if exists "own posts" on public.posts;
create policy "own posts" on public.posts for select to authenticated using (author = auth.uid());
drop policy if exists "own reactions" on public.post_reactions;
create policy "own reactions" on public.post_reactions for select to authenticated using (user_id = auth.uid());

-- ---------- crews ----------
create table if not exists public.crews (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 3 and 28 and name ~ '^[A-Za-z0-9 ''&.-]+$'),
  logo text not null default 'bike' check (logo ~ '^[a-z]{2,12}$'),
  color text not null default '#ffd21f' check (color ~ '^#[0-9a-f]{6}$'),
  description text not null default '' check (char_length(description) <= 200),
  leader uuid references auth.users on delete set null,
  is_public boolean not null default true,
  min_level integer not null default 0 check (min_level between 0 and 50),
  campus text not null default 'ug',
  members integer not null default 1,
  created_at timestamptz not null default now()
);
create unique index if not exists crews_name on public.crews (lower(name));

create table if not exists public.crew_members (
  crew_id bigint not null references public.crews on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('leader', 'member')),
  status text not null default 'member' check (status in ('member', 'pending')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
-- a rider belongs to one crew at a time
create unique index if not exists crew_members_one on public.crew_members (user_id) where status = 'member';

-- coins paid to create a crew (also taken off the rider's saved coins)
create table if not exists public.crew_fees (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  crew_id bigint references public.crews on delete set null,
  coins integer not null check (coins >= 0),
  created_at timestamptz not null default now()
);

alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.crew_fees enable row level security;
-- crews themselves are public (name, logo, description); members only through crew_get
drop policy if exists "crews are public" on public.crews;
create policy "crews are public" on public.crews for select using (true);
drop policy if exists "own membership" on public.crew_members;
create policy "own membership" on public.crew_members for select to authenticated using (user_id = auth.uid());
drop policy if exists "own fees" on public.crew_fees;
create policy "own fees" on public.crew_fees for select to authenticated using (user_id = auth.uid());

insert into public.config (key, value) values ('crew_create_coins', '2000') on conflict (key) do nothing;

-- ---------- messages ----------
create table if not exists public.conversations (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('dm', 'crew')),
  crew_id bigint unique references public.crews on delete cascade,
  dm_key text unique,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id bigint not null references public.conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  last_read_at timestamptz not null default now(),
  left_at timestamptz,
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user on public.conversation_members (user_id);
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations on delete cascade,
  sender uuid not null references auth.users on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists messages_conv on public.messages (conversation_id, id desc);
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  conversation_id bigint not null references public.conversations on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

create or replace function public.cm_member(p_conv bigint, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = p_conv and user_id = p_user and left_at is null);
$$;

drop policy if exists "member conversations" on public.conversations;
create policy "member conversations" on public.conversations for select to authenticated using (public.cm_member(id, auth.uid()));
drop policy if exists "own membership rows" on public.conversation_members;
create policy "own membership rows" on public.conversation_members for select to authenticated using (user_id = auth.uid());
-- members read messages (realtime uses this too), except from riders they blocked or muted
drop policy if exists "member messages" on public.messages;
create policy "member messages" on public.messages for select to authenticated using (
  public.cm_member(conversation_id, auth.uid())
  and not exists (select 1 from public.blocks where blocker = auth.uid() and blocked = sender)
  and not exists (select 1 from public.mutes where user_id = auth.uid() and muted = sender)
);
drop policy if exists "member reactions" on public.message_reactions;
create policy "member reactions" on public.message_reactions for select to authenticated using (public.cm_member(conversation_id, auth.uid()));

-- ---------- dating (18+, opt-in, mutual) ----------
create table if not exists public.dating_likes (
  from_id uuid not null references auth.users on delete cascade,
  to_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists dating_likes_to on public.dating_likes (to_id);
create table if not exists public.dating_passes (
  from_id uuid not null references auth.users on delete cascade,
  to_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id)
);
alter table public.dating_likes enable row level security;
alter table public.dating_passes enable row level security;
-- nobody can list who liked them: a like shows only once it is mutual (dating_matches)
drop policy if exists "own likes" on public.dating_likes;
create policy "own likes" on public.dating_likes for select to authenticated using (from_id = auth.uid());
drop policy if exists "own passes" on public.dating_passes;
create policy "own passes" on public.dating_passes for select to authenticated using (from_id = auth.uid());

-- ---------- notifications ----------
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{2,24}$'),
  actor uuid references auth.users on delete cascade,
  ref text check (char_length(ref) <= 80),
  text text not null check (char_length(text) <= 200),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());

-- live updates: new messages, reactions and notifications reach the app at once
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.message_reactions; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  end if;
end $$;

-- =====================================================================================
-- helpers (internal: not granted to the app)
-- =====================================================================================

create or replace function public.cm_level(p_xp integer) returns integer
language sql immutable as $$
  select greatest(1, floor((1 + sqrt(1 + 8.0 * greatest(p_xp, 0) / 250)) / 2)::integer);
$$;

create or replace function public.cm_age(p_dob date) returns integer
language sql stable as $$
  select case when p_dob is null then null else extract(year from age(current_date, p_dob))::integer end;
$$;

create or replace function public.cm_friends(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where a = least(x, y) and b = greatest(x, y) and status = 'accepted');
$$;

create or replace function public.cm_blocked(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = x and blocked = y) or (blocker = y and blocked = x));
$$;

create or replace function public.cm_friend_ids(x uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select case when a = x then b else a end from friendships where (a = x or b = x) and status = 'accepted';
$$;

create or replace function public.cm_mutual(x uuid, y uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.cm_friend_ids(x) f where f in (select public.cm_friend_ids(y));
$$;

create or replace function public.cm_match(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dating_likes where from_id = x and to_id = y)
     and exists (select 1 from dating_likes where from_id = y and to_id = x);
$$;

create or replace function public.cm_crew_of(x uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select crew_id from crew_members where user_id = x and status = 'member' limit 1;
$$;

create or replace function public.cm_same_crew(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cm_crew_of(x) is not null and public.cm_crew_of(x) = public.cm_crew_of(y);
$$;

-- settings with defaults for riders who never opened Community (conservative)
create or replace function public.cm_settings(x uuid) returns public.social_settings
language plpgsql stable security definer set search_path = public as $$
declare s social_settings;
begin
  select * into s from social_settings where user_id = x;
  if not found then
    s.user_id := x;
    select coalesce(p.hall, 'none'), p.department, p.gender into s.hall, s.course, s.gender from profiles p where p.id = x;
    s.hall := coalesce(s.hall, 'none');
    s.campus := 'ug'; s.statuses := '{}'; s.show_status := true; s.find_me := 'hall'; s.message_me := 'friends';
    s.requests_from := 'shared'; s.vibe_from := 'friends'; s.show_online := true; s.show_hall := true;
    s.show_course := false; s.show_level := false; s.show_map := false; s.activity := 'friends';
    s.dating_on := false; s.dating_min := 18; s.dating_max := 30; s.dating_genders := '{}'; s.interests := '{}'; s.notify := '{}';
  end if;
  return s;
end $$;

-- some real connection between two riders (for "people with shared connections")
create or replace function public.cm_shared(x uuid, y uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare sx social_settings := public.cm_settings(x); sy social_settings := public.cm_settings(y);
begin
  return coalesce(sx.hall <> 'none' and sx.hall = sy.hall, false)
    or coalesce(sx.course = sy.course, false)
    or public.cm_mutual(x, y) > 0
    or public.cm_same_crew(x, y)
    or exists (select 1 from rode_together where (user_id = x and other = y) or (user_id = y and other = x))
    or public.cm_match(x, y);
end $$;

-- can viewer find target at all (search, lists, discovery)?
create or replace function public.cm_can_find(viewer uuid, target uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t social_settings; v social_settings;
begin
  if viewer = target then return true; end if;
  if viewer is null or public.cm_blocked(viewer, target) then return false; end if;
  if public.cm_friends(viewer, target) then return true; end if;
  t := public.cm_settings(target);
  v := public.cm_settings(viewer);
  return coalesce(case t.find_me
    when 'everyone' then true
    when 'fof' then public.cm_mutual(viewer, target) > 0
    when 'hall' then t.hall <> 'none' and t.hall = v.hall
    when 'course' then t.course = v.course
    else false end, false);
end $$;

create or replace function public.cm_can_message(sender uuid, recipient uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t social_settings;
begin
  if sender = recipient or public.cm_blocked(sender, recipient) then return false; end if;
  t := public.cm_settings(recipient);
  return coalesce(case t.message_me
    when 'everyone' then true
    when 'friends' then public.cm_friends(sender, recipient) or public.cm_match(sender, recipient)
    when 'connections' then public.cm_friends(sender, recipient) or public.cm_match(sender, recipient) or public.cm_same_crew(sender, recipient)
    else false end, false);
end $$;

create or replace function public.cm_can_request(sender uuid, recipient uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t social_settings;
begin
  if sender = recipient or public.cm_blocked(sender, recipient) then return false; end if;
  t := public.cm_settings(recipient);
  return coalesce(case t.requests_from when 'everyone' then true when 'shared' then public.cm_shared(sender, recipient) else false end, false);
end $$;

create or replace function public.cm_can_vibe(sender uuid, recipient uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t social_settings;
begin
  if sender = recipient or public.cm_blocked(sender, recipient) then return false; end if;
  t := public.cm_settings(recipient);
  return coalesce(case t.vibe_from
    when 'everyone' then true
    when 'friends' then public.cm_friends(sender, recipient)
    when 'dating' then public.cm_match(sender, recipient)
    else false end, false);
end $$;

create or replace function public.cm_adult(x uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.cm_age((public.cm_settings(x)).dob) >= 18, false);
$$;

-- what viewer may see about target, as JSON. reason: why they are shown (suggestions)
create or replace function public.cm_card(viewer uuid, target uuid, reason text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t social_settings; v social_settings; p profiles; rel text; f friendships; st text[];
begin
  select * into p from profiles where id = target;
  if not found then return null; end if;
  t := public.cm_settings(target);
  v := public.cm_settings(viewer);
  select * into f from friendships where a = least(viewer, target) and b = greatest(viewer, target);
  rel := case when viewer = target then 'self' when f.status = 'accepted' then 'friend'
    when f.status = 'pending' and f.requester = viewer then 'sent' when f.status = 'pending' then 'received' else null end;
  st := case when t.show_status or viewer = target then t.statuses else '{}' end;
  -- "open to dating" only shows to adults who switched dating on themselves
  if not (viewer = target or (v.dating_on and public.cm_adult(viewer) and t.dating_on)) then st := array_remove(st, 'dating'); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', target,
    'name', p.name,
    'username', p.username,
    'level', public.cm_level(p.xp),
    'km', p.km,
    'gender', p.gender,
    'look', p.look,
    'hall', case when t.show_hall or viewer = target then nullif(t.hall, 'none') end,
    'course', case when t.show_course or viewer = target then t.course end,
    'year', case when (t.show_level and t.show_course) or viewer = target then t.level end,
    'statuses', to_jsonb(st),
    'rel', rel,
    'following', exists (select 1 from follows where follower = viewer and followee = target),
    'followers', (select count(*) from follows where followee = target),
    'map', t.show_map,
    'online', t.show_online,
    'reason', reason
  ));
end $$;

-- leaves a notification, unless the rider turned that kind off, blocked or muted the actor
create or replace function public.cm_notify(p_user uuid, p_kind text, p_actor uuid, p_ref text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare s social_settings := public.cm_settings(p_user); grp text;
begin
  if p_user is null or p_user = p_actor then return; end if;
  if p_actor is not null and (public.cm_blocked(p_user, p_actor) or exists (select 1 from mutes where user_id = p_user and muted = p_actor)) then return; end if;
  grp := case when p_kind like 'friend%' or p_kind = 'follow' then 'friends' when p_kind like 'crew%' then 'crews'
    when p_kind like 'vibe%' then 'vibe' when p_kind like 'dating%' then 'dating' when p_kind like 'react%' then 'feed' else 'other' end;
  if coalesce((s.notify ->> grp)::boolean, true) = false then return; end if;
  insert into notifications (user_id, kind, actor, ref, text) values (p_user, p_kind, p_actor, p_ref, left(p_text, 200));
end $$;

create or replace function public.cm_name(x uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce('@' || username, name, 'A rider') from profiles where id = x;
$$;

-- ---------- keeping the public profile in line with privacy ----------
-- profiles.hall / department are what race leaderboards show: blank them when hidden
create or replace function public.cm_mask_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare s social_settings;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  select * into s from social_settings where user_id = new.id;
  if not found then return new; end if;
  -- the app sends the real values: keep them privately, then mask
  update social_settings set hall = coalesce(new.hall, 'none'), course = new.department, gender = coalesce(new.gender, gender) where user_id = new.id;
  if not s.show_hall then new.hall := 'none'; end if;
  if not s.show_course then new.department := null; end if;
  return new;
end $$;
drop trigger if exists cm_mask_profile on public.profiles;
create trigger cm_mask_profile before insert or update on public.profiles for each row execute function public.cm_mask_profile();

create or replace function public.cm_settings_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  update profiles set hall = case when new.show_hall then new.hall else 'none' end,
    department = case when new.show_course then new.course end
  where id = new.user_id;
  return null;
end $$;
drop trigger if exists cm_settings_changed on public.social_settings;
create trigger cm_settings_changed after insert or update on public.social_settings for each row execute function public.cm_settings_changed();

-- dating needs 18+ and "dating" status needs dating switched on
create or replace function public.cm_settings_rules() returns trigger
language plpgsql as $$
begin
  if new.dating_on and coalesce(public.cm_age(new.dob) >= 18, false) is not true then new.dating_on := false; end if;
  if not new.dating_on then new.statuses := array_remove(new.statuses, 'dating'); end if;
  if 'none' = any(new.statuses) then new.statuses := array['none']; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists cm_settings_rules on public.social_settings;
create trigger cm_settings_rules before insert or update on public.social_settings for each row execute function public.cm_settings_rules();

-- riders who blocked you don't see you in public lists either
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (
  auth.uid() is null or not exists (select 1 from public.blocks where blocker = profiles.id and blocked = auth.uid())
);

-- Vibe Ride invites follow "who can invite me to Vibe Ride"
drop policy if exists "send invites" on public.invites;
create policy "send invites" on public.invites for insert to authenticated with check (
  from_id = auth.uid() and to_id <> auth.uid() and public.cm_can_vibe(auth.uid(), to_id)
);

-- =====================================================================================
-- the app's functions
-- =====================================================================================

-- saves status, privacy and dating choices. p: the fields to change (see the app's api.ts)
create or replace function public.community_save_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'signin'; end if;
  insert into social_settings (user_id) values (me) on conflict (user_id) do nothing;
  update social_settings s set
    campus = coalesce(p ->> 'campus', s.campus),
    hall = coalesce(p ->> 'hall', s.hall),
    course = case when p ? 'course' then nullif(p ->> 'course', '') else s.course end,
    level = case when p ? 'level' then nullif(p ->> 'level', '') else s.level end,
    dob = case when p ? 'dob' then nullif(p ->> 'dob', '')::date else s.dob end,
    gender = coalesce(p ->> 'gender', s.gender),
    statuses = coalesce(array(select jsonb_array_elements_text(p -> 'statuses')), s.statuses),
    show_status = coalesce((p ->> 'show_status')::boolean, s.show_status),
    find_me = coalesce(p ->> 'find_me', s.find_me),
    message_me = coalesce(p ->> 'message_me', s.message_me),
    requests_from = coalesce(p ->> 'requests_from', s.requests_from),
    vibe_from = coalesce(p ->> 'vibe_from', s.vibe_from),
    show_online = coalesce((p ->> 'show_online')::boolean, s.show_online),
    show_hall = coalesce((p ->> 'show_hall')::boolean, s.show_hall),
    show_course = coalesce((p ->> 'show_course')::boolean, s.show_course),
    show_level = coalesce((p ->> 'show_level')::boolean, s.show_level),
    show_map = coalesce((p ->> 'show_map')::boolean, s.show_map),
    activity = coalesce(p ->> 'activity', s.activity),
    dating_on = coalesce((p ->> 'dating_on')::boolean, s.dating_on),
    dating_min = coalesce((p ->> 'dating_min')::integer, s.dating_min),
    dating_max = coalesce((p ->> 'dating_max')::integer, s.dating_max),
    dating_genders = case when p ? 'dating_genders' then array(select jsonb_array_elements_text(p -> 'dating_genders')) else s.dating_genders end,
    interests = case when p ? 'interests' then array(select left(x, 20) from jsonb_array_elements_text(p -> 'interests') x limit 8) else s.interests end,
    notify = case when jsonb_typeof(p -> 'notify') = 'object' then p -> 'notify' else s.notify end
  where s.user_id = me;
  return (select to_jsonb(s) - 'dob' - 'user_id' || jsonb_build_object('adult', public.cm_adult(me)) from social_settings s where s.user_id = me);
end $$;

-- people lists. p_mode: search | suggest | friends | requests | sent | followers | following | hall | course | level
--   | friends_status | buddies | social | compete | blocked | ids (p_q = comma separated ids) | crew (p_q = crew id)
create or replace function public.community_people(p_mode text, p_q text default '', p_limit integer default 30, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); v social_settings; lim integer := least(greatest(coalesce(p_limit, 30), 1), 60); q text;
begin
  if me is null then raise exception 'signin'; end if;
  v := public.cm_settings(me);
  q := regexp_replace(coalesce(p_q, ''), '[^A-Za-z0-9_. -]', '', 'g');

  if p_mode = 'suggest' then
    return coalesce((select jsonb_agg(public.cm_card(me, x.id, x.reason) order by x.score desc, x.id) from (
      select s.user_id as id,
        (case when s.hall <> 'none' and s.hall = v.hall and s.show_hall then 3 else 0 end
          + case when s.course is not null and s.course = v.course and s.show_course then 3 else 0 end
          + case when rt.other is not null then 4 else 0 end
          + least(public.cm_mutual(me, s.user_id), 5)
          + case when public.cm_same_crew(me, s.user_id) then 3 else 0 end
          + case when ev.ref is not null then 2 else 0 end) as score,
        coalesce(
          case when rt.other is not null then 'You rode together' end,
          case when public.cm_same_crew(me, s.user_id) then 'Same crew' end,
          case when s.course is not null and s.course = v.course and s.show_course then
            case when s.level is not null and s.level = v.level and s.show_level then 'Same course and level' else 'Same course' end end,
          case when ev.ref is not null then 'You were both at ' || ev.ref end,
          case when public.cm_mutual(me, s.user_id) > 0 then public.cm_mutual(me, s.user_id) || ' mutual friend' || case when public.cm_mutual(me, s.user_id) > 1 then 's' else '' end end,
          case when s.hall <> 'none' and s.hall = v.hall and s.show_hall then 'Same hall' end,
          'Rides on your campus') as reason
      from social_settings s
      left join lateral (select r.other from rode_together r where r.user_id = me and r.other = s.user_id limit 1) rt on true
      left join lateral (select a.ref from posts a join posts b on b.ref = a.ref and b.author = me and b.akind in ('event_join', 'event_done')
        where a.author = s.user_id and a.akind in ('event_join', 'event_done') and a.created_at > now() - interval '30 days' limit 1) ev on true
      where s.user_id <> me and s.campus = v.campus
        and not ('none' = any(s.statuses))
        and public.cm_can_find(me, s.user_id)
        and not public.cm_friends(me, s.user_id)
        and not exists (select 1 from hides h where h.user_id = me and h.hidden = s.user_id)
        and not exists (select 1 from friendships f where f.a = least(me, s.user_id) and f.b = greatest(me, s.user_id))
      order by score desc, s.updated_at desc
      limit lim offset p_offset
    ) x), '[]'::jsonb);
  end if;

  return coalesce((select jsonb_agg(public.cm_card(me, x.id)) from (
    select u.id from (
      -- search by username or name
      select s.user_id as id, s.updated_at as at from social_settings s join profiles p on p.id = s.user_id
        where p_mode = 'search' and char_length(q) >= 2 and (p.username ilike q || '%' or p.name ilike q || '%') and s.user_id <> me
      union all
      select f.id, now() from public.cm_friend_ids(me) f(id) where p_mode = 'friends'
      union all
      select case when f.a = me then f.b else f.a end, f.created_at from friendships f
        where p_mode in ('requests', 'sent') and f.status = 'pending' and me in (f.a, f.b)
          and ((p_mode = 'requests' and f.requester <> me) or (p_mode = 'sent' and f.requester = me))
      union all
      select fo.follower, fo.created_at from follows fo where p_mode = 'followers' and fo.followee = me
      union all
      select fo.followee, fo.created_at from follows fo where p_mode = 'following' and fo.follower = me
      union all
      select s.user_id, s.updated_at from social_settings s
        where s.user_id <> me and s.campus = v.campus and (
          (p_mode = 'hall' and s.show_hall and s.hall <> 'none' and s.hall = coalesce(nullif(q, ''), v.hall))
          or (p_mode = 'course' and s.show_course and s.course is not null and s.course = coalesce(nullif(p_q, ''), v.course))
          or (p_mode = 'level' and s.show_course and s.show_level and s.course = v.course and s.level is not null and s.level = v.level)
          or (p_mode in ('friends_status', 'buddies', 'social', 'compete') and s.show_status
              and (case p_mode when 'friends_status' then 'friends' else p_mode end) = any(s.statuses)))
      union all
      select b.blocked, b.created_at from blocks b where p_mode = 'blocked' and b.blocker = me
      union all
      select x::uuid, now() from unnest(string_to_array(p_q, ',')) x where p_mode = 'ids' and x ~ '^[0-9a-f-]{36}$'
      union all
      select m.user_id, m.joined_at from crew_members m where p_mode = 'crew' and m.status = 'member' and m.crew_id::text = p_q
        and (exists (select 1 from crews c where c.id = m.crew_id and c.is_public) or public.cm_crew_of(me)::text = p_q)
    ) u
    -- lists of people you chose (friends, requests, blocked) always show; everything else follows their privacy
    where p_mode in ('blocked') or (
      not public.cm_blocked(me, u.id)
      and (p_mode in ('friends', 'requests', 'sent', 'followers', 'following', 'crew') or public.cm_can_find(me, u.id))
      and (p_mode not in ('hall', 'course', 'level', 'buddies', 'social', 'compete', 'friends_status') or not exists (select 1 from hides h where h.user_id = me and h.hidden = u.id)))
    group by u.id
    order by max(u.at) desc
    limit lim offset p_offset
  ) x), '[]'::jsonb);
end $$;

create or replace function public.community_card(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'signin'; end if;
  if public.cm_blocked(me, p_id) then return null; end if;
  if not public.cm_can_find(me, p_id) and not exists (select 1 from friendships where a = least(me, p_id) and b = greatest(me, p_id))
    and not public.cm_match(me, p_id) and not public.cm_same_crew(me, p_id) then return null; end if;
  return public.cm_card(me, p_id) || jsonb_build_object(
    'can_message', public.cm_can_message(me, p_id),
    'can_request', public.cm_can_request(me, p_id),
    'can_vibe', public.cm_can_vibe(me, p_id),
    'muted', exists (select 1 from mutes where user_id = me and muted = p_id),
    'match', public.cm_match(me, p_id),
    'mutual', public.cm_mutual(me, p_id),
    'friends', (select count(*) from public.cm_friend_ids(p_id)),
    'crew', (select jsonb_build_object('id', c.id, 'name', c.name, 'logo', c.logo, 'color', c.color) from crews c where c.id = public.cm_crew_of(p_id)));
end $$;

-- friends: request, accept/decline, remove. p_action: request | accept | decline | remove
create or replace function public.community_friend(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); f friendships;
begin
  if me is null then raise exception 'signin'; end if;
  if p_id = me then raise exception 'self'; end if;
  select * into f from friendships where a = least(me, p_id) and b = greatest(me, p_id);
  if p_action = 'request' then
    if f.status = 'accepted' then return 'friend'; end if;
    if f.status = 'pending' and f.requester = p_id then
      update friendships set status = 'accepted', accepted_at = now() where a = f.a and b = f.b;
      perform public.cm_notify(p_id, 'friend_accept', me, me::text, public.cm_name(me) || ' accepted your friend request');
      return 'friend';
    end if;
    if f.status = 'pending' then return 'sent'; end if;
    if not public.cm_can_request(me, p_id) then raise exception 'privacy'; end if;
    if (select count(*) from friendships where requester = me and status = 'pending' and created_at > now() - interval '1 day') >= 40 then raise exception 'rate'; end if;
    insert into friendships (a, b, requester) values (least(me, p_id), greatest(me, p_id), me);
    perform public.cm_notify(p_id, 'friend_request', me, me::text, public.cm_name(me) || ' wants to be your friend');
    return 'sent';
  elsif p_action = 'accept' then
    if f.status = 'pending' and f.requester = p_id then
      update friendships set status = 'accepted', accepted_at = now() where a = f.a and b = f.b;
      perform public.cm_notify(p_id, 'friend_accept', me, me::text, public.cm_name(me) || ' accepted your friend request');
      return 'friend';
    end if;
    return coalesce(f.status, 'none');
  elsif p_action in ('decline', 'remove') then
    delete from friendships where a = least(me, p_id) and b = greatest(me, p_id);
    return 'none';
  end if;
  raise exception 'bad_action';
end $$;

-- follow / mute / hide / block, on or off. p_kind: follow | mute | hide | block
create or replace function public.community_toggle(p_id uuid, p_kind text, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'signin'; end if;
  if p_id = me then raise exception 'self'; end if;
  if p_kind = 'follow' then
    if p_on then
      if not public.cm_can_find(me, p_id) then raise exception 'privacy'; end if;
      insert into follows (follower, followee) values (me, p_id) on conflict do nothing;
      if found then perform public.cm_notify(p_id, 'follow', me, me::text, public.cm_name(me) || ' started following you'); end if;
    else delete from follows where follower = me and followee = p_id; end if;
  elsif p_kind = 'mute' then
    if p_on then insert into mutes (user_id, muted) values (me, p_id) on conflict do nothing;
    else delete from mutes where user_id = me and muted = p_id; end if;
  elsif p_kind = 'hide' then
    if p_on then insert into hides (user_id, hidden) values (me, p_id) on conflict do nothing;
    else delete from hides where user_id = me and hidden = p_id; end if;
  elsif p_kind = 'block' then
    if p_on then
      insert into blocks (blocker, blocked) values (me, p_id) on conflict do nothing;
      -- blocking ends every connection both ways
      delete from friendships where a = least(me, p_id) and b = greatest(me, p_id);
      delete from follows where (follower = me and followee = p_id) or (follower = p_id and followee = me);
      delete from dating_likes where (from_id = me and to_id = p_id) or (from_id = p_id and to_id = me);
      update conversation_members cm set left_at = now() from conversations c
        where c.id = cm.conversation_id and c.kind = 'dm' and c.dm_key = least(me, p_id)::text || ':' || greatest(me, p_id)::text and cm.user_id = me;
    else delete from blocks where blocker = me and blocked = p_id; end if;
  else
    raise exception 'bad_action';
  end if;
  return p_on;
end $$;

create or replace function public.community_report(p_user uuid, p_kind text, p_target text, p_reason text, p_details text default null, p_context jsonb default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid bigint;
begin
  if me is null then raise exception 'signin'; end if;
  if (select count(*) from reports where reporter = me and created_at > now() - interval '1 hour') >= 10 then raise exception 'rate'; end if;
  insert into reports (reporter, target_user, kind, target_id, reason, details, context)
    values (me, p_user, p_kind, left(p_target, 60), left(p_reason, 80), left(p_details, 500), p_context)
    returning id into rid;
  return rid;
end $$;

-- someone you shared a Vibe Ride with
create or replace function public.community_rode_with(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or p_id = me or not exists (select 1 from profiles where id = p_id) then return; end if;
  insert into rode_together (user_id, other) values (me, p_id) on conflict (user_id, other) do update set at = now();
end $$;

-- ---------- feed ----------
create or replace function public.cm_can_see_post(viewer uuid, p posts) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p.author = viewer then return true; end if;
  if public.cm_blocked(viewer, p.author) then return false; end if;
  return coalesce(case p.audience
    when 'public' then true
    when 'friends' then public.cm_friends(viewer, p.author)
    when 'hall' then p.hall = (public.cm_settings(viewer)).hall
    when 'crew' then p.crew_id = public.cm_crew_of(viewer)
    else false end, false);
end $$;

create or replace function public.cm_post_json(viewer uuid, p posts) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'akind', p.akind, 'text', p.text, 'ref', p.ref, 'audience', p.audience, 'at', p.created_at,
    'author', jsonb_build_object('id', p.author, 'name', pr.name, 'username', pr.username,
      'hall', case when s.show_hall or p.author = viewer then nullif(s.hall, 'none') end),
    'reactions', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from post_reactions where post_id = p.id group by kind) r), '{}'::jsonb),
    'mine', (select kind from post_reactions where post_id = p.id and user_id = viewer))
  from profiles pr, public.cm_settings(p.author) s where pr.id = p.author;
$$;

-- p_scope: home | friends | hall (p_ref = hall id) | course (p_ref = programme) | crew (p_ref = crew id) | user (p_ref = rider id)
create or replace function public.community_feed(p_scope text default 'home', p_ref text default null, p_before bigint default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); v social_settings; lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if me is null then raise exception 'signin'; end if;
  v := public.cm_settings(me);
  return coalesce((select jsonb_agg(public.cm_post_json(me, x) order by x.id desc) from (
    select p.* from posts p
    where (p_before is null or p.id < p_before)
      and p.created_at > now() - interval '60 days'
      and not exists (select 1 from mutes m where m.user_id = me and m.muted = p.author)
      and case p_scope
        when 'home' then p.author = me or p.audience = 'public' or p.author in (select public.cm_friend_ids(me))
          or p.author in (select followee from follows where follower = me) or (p.audience = 'hall' and p.hall = v.hall)
          or (p.audience = 'crew' and p.crew_id = public.cm_crew_of(me))
        when 'friends' then p.author = me or p.author in (select public.cm_friend_ids(me)) or p.author in (select followee from follows where follower = me)
        when 'hall' then p.hall = coalesce(p_ref, v.hall) and p.audience <> 'crew'
        when 'course' then exists (select 1 from social_settings s where s.user_id = p.author and s.show_course and s.course = coalesce(p_ref, v.course)) and p.audience <> 'crew'
        when 'crew' then p.crew_id::text = p_ref and p.audience = 'crew'
        when 'user' then p.author::text = p_ref
        else false end
      and public.cm_can_see_post(me, p)
    order by p.id desc
    limit lim
  ) x), '[]'::jsonb);
end $$;

-- p_kind: text | activity | ride | event | challenge | achievement; p_audience: public | friends | hall | crew
create or replace function public.community_post(p_kind text, p_text text, p_akind text default null, p_ref text default null, p_audience text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); s social_settings; aud text; pid bigint; crew bigint;
begin
  if me is null then raise exception 'signin'; end if;
  s := public.cm_settings(me);
  if (select count(*) from posts where author = me and created_at > now() - interval '1 hour') >= 30 then raise exception 'rate'; end if;
  if p_kind = 'activity' then
    if s.activity = 'off' then return null; end if;
    aud := case s.activity when 'everyone' then 'public' else 'friends' end;
  else
    aud := coalesce(p_audience, 'friends');
  end if;
  crew := public.cm_crew_of(me);
  if aud = 'crew' and crew is null then aud := 'friends'; end if;
  if aud = 'hall' and s.hall = 'none' then aud := 'friends'; end if;
  insert into posts (author, kind, akind, text, ref, audience, hall, crew_id)
    values (me, p_kind, p_akind, left(btrim(p_text), 280), left(p_ref, 80), aud,
      case when s.show_hall or aud = 'hall' then nullif(s.hall, 'none') end, case when aud = 'crew' then crew end)
    returning id into pid;
  return pid;
end $$;

create or replace function public.community_post_delete(p_id bigint) returns void
language sql security definer set search_path = public as $$
  delete from posts where id = p_id and author = auth.uid();
$$;

-- reacts to a post (p_kind null removes it). Returns the reaction now set.
create or replace function public.community_react(p_post bigint, p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p posts; first boolean;
begin
  if me is null then raise exception 'signin'; end if;
  select * into p from posts where id = p_post;
  if not found or not public.cm_can_see_post(me, p) then raise exception 'not_found'; end if;
  if p_kind is null then delete from post_reactions where post_id = p_post and user_id = me; return null; end if;
  first := not exists (select 1 from post_reactions where post_id = p_post and user_id = me);
  insert into post_reactions (post_id, user_id, kind) values (p_post, me, p_kind)
    on conflict (post_id, user_id) do update set kind = excluded.kind, created_at = now();
  if first then perform public.cm_notify(p.author, 'react', me, p_post::text, public.cm_name(me) || ' reacted to "' || left(p.text, 60) || '"'); end if;
  return p_kind;
end $$;

-- ---------- crews ----------
create or replace function public.cm_crew_json(viewer uuid, c crews) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'logo', c.logo, 'color', c.color, 'description', c.description,
    'public', c.is_public, 'min_level', c.min_level, 'members', c.members, 'created_at', c.created_at,
    'leader', case when c.leader is not null then jsonb_build_object('id', c.leader, 'name', (select name from profiles where id = c.leader)) end,
    'km', (select coalesce(round(sum(p.km)), 0) from crew_members m join profiles p on p.id = m.user_id where m.crew_id = c.id and m.status = 'member'),
    'my', (select jsonb_build_object('role', m.role, 'status', m.status) from crew_members m where m.crew_id = c.id and m.user_id = viewer));
$$;

create or replace function public.crew_list(p_q text default '', p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  return coalesce((select jsonb_agg(public.cm_crew_json(me, c) order by c.members desc, c.id) from (
    select * from crews c where (coalesce(p_q, '') = '' or c.name ilike '%' || p_q || '%')
      and (c.leader is null or me is null or not public.cm_blocked(me, c.leader))
    order by c.members desc, c.id limit least(greatest(coalesce(p_limit, 30), 1), 60)) c), '[]'::jsonb);
end $$;

create or replace function public.crew_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); c crews; mine crew_members;
begin
  select * into c from crews where id = p_id;
  if not found then return null; end if;
  select * into mine from crew_members where crew_id = p_id and user_id = me;
  return public.cm_crew_json(me, c) || jsonb_build_object(
    'conversation', case when mine.status = 'member' then (select id from conversations where crew_id = p_id) end,
    'pending', case when mine.role = 'leader' then coalesce((select jsonb_agg(public.cm_card(me, m.user_id) order by m.joined_at)
      from crew_members m where m.crew_id = p_id and m.status = 'pending'), '[]'::jsonb) end);
end $$;

create or replace function public.crew_create(p_name text, p_logo text, p_color text, p_description text, p_public boolean, p_min_level integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); fee integer; coins integer; cid bigint; conv bigint;
begin
  if me is null then raise exception 'signin'; end if;
  if public.cm_crew_of(me) is not null then raise exception 'in_crew'; end if;
  if exists (select 1 from crews where lower(name) = lower(btrim(p_name))) then raise exception 'name_taken'; end if;
  fee := coalesce((select (value #>> '{}')::integer from config where key = 'crew_create_coins'), 2000);
  -- coins are kept in the rider's saved progress: take the fee there too
  select coalesce((data ->> 'coins')::integer, 0) into coins from saves where id = me for update;
  if coalesce(coins, 0) < fee then raise exception 'coins'; end if;
  update saves set data = jsonb_set(data, '{coins}', to_jsonb(coins - fee)), updated_at = now() where id = me;
  insert into crews (name, logo, color, description, leader, is_public, min_level, campus)
    values (btrim(p_name), p_logo, lower(p_color), coalesce(left(p_description, 200), ''), me, coalesce(p_public, true), coalesce(p_min_level, 0),
      (public.cm_settings(me)).campus)
    returning id into cid;
  insert into crew_members (crew_id, user_id, role, status) values (cid, me, 'leader', 'member');
  insert into crew_fees (user_id, crew_id, coins) values (me, cid, fee);
  insert into conversations (kind, crew_id) values ('crew', cid) returning id into conv;
  insert into conversation_members (conversation_id, user_id) values (conv, me);
  delete from crew_members where user_id = me and status = 'pending' and crew_id <> cid;
  return jsonb_build_object('id', cid, 'fee', fee);
end $$;

create or replace function public.cm_crew_add(p_crew bigint, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare conv bigint;
begin
  update crew_members set status = 'member', joined_at = now() where crew_id = p_crew and user_id = p_user;
  delete from crew_members where user_id = p_user and status = 'pending' and crew_id <> p_crew;
  update crews set members = (select count(*) from crew_members where crew_id = p_crew and status = 'member') where id = p_crew;
  select id into conv from conversations where crew_id = p_crew;
  insert into conversation_members (conversation_id, user_id) values (conv, p_user)
    on conflict (conversation_id, user_id) do update set left_at = null, last_read_at = now();
end $$;

-- join a public crew, or ask to join a private one. Returns 'member' or 'pending'.
create or replace function public.crew_join(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c crews; lvl integer;
begin
  if me is null then raise exception 'signin'; end if;
  select * into c from crews where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if public.cm_crew_of(me) is not null then raise exception 'in_crew'; end if;
  if c.leader is not null and public.cm_blocked(me, c.leader) then raise exception 'blocked'; end if;
  select public.cm_level(xp) into lvl from profiles where id = me;
  if coalesce(lvl, 1) < c.min_level then raise exception 'level'; end if;
  insert into crew_members (crew_id, user_id, status) values (p_id, me, 'pending') on conflict (crew_id, user_id) do nothing;
  if c.is_public then
    perform public.cm_crew_add(p_id, me);
    perform public.cm_notify(c.leader, 'crew_join', me, p_id::text, public.cm_name(me) || ' joined ' || c.name);
    return 'member';
  end if;
  perform public.cm_notify(c.leader, 'crew_request', me, p_id::text, public.cm_name(me) || ' asked to join ' || c.name);
  return 'pending';
end $$;

-- the leader answers a join request, or removes a member (p_accept false on a member)
create or replace function public.crew_answer(p_id bigint, p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c crews;
begin
  select * into c from crews where id = p_id;
  if not found or c.leader is distinct from me then raise exception 'not_leader'; end if;
  if p_user = me then raise exception 'self'; end if;
  if p_accept then
    if public.cm_crew_of(p_user) is not null then delete from crew_members where crew_id = p_id and user_id = p_user and status = 'pending'; raise exception 'in_crew'; end if;
    perform public.cm_crew_add(p_id, p_user);
    perform public.cm_notify(p_user, 'crew_accept', me, p_id::text, 'Welcome to ' || c.name || '!');
  else
    delete from crew_members where crew_id = p_id and user_id = p_user;
    update conversation_members set left_at = now() where user_id = p_user and conversation_id = (select id from conversations where crew_id = p_id);
    update crews set members = (select count(*) from crew_members where crew_id = p_id and status = 'member') where id = p_id;
  end if;
end $$;

create or replace function public.crew_leave(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c crews; heir uuid;
begin
  select * into c from crews where id = p_id;
  if not found then return; end if;
  delete from crew_members where crew_id = p_id and user_id = me;
  update conversation_members set left_at = now() where user_id = me and conversation_id = (select id from conversations where crew_id = p_id);
  if c.leader = me then
    select user_id into heir from crew_members where crew_id = p_id and status = 'member' order by joined_at limit 1;
    if heir is null then delete from crews where id = p_id; return; end if;
    update crew_members set role = 'leader' where crew_id = p_id and user_id = heir;
    update crews set leader = heir where id = p_id;
    perform public.cm_notify(heir, 'crew_leader', me, p_id::text, 'You now lead ' || c.name);
  end if;
  update crews set members = (select count(*) from crew_members where crew_id = p_id and status = 'member') where id = p_id;
end $$;

create or replace function public.crew_update(p_id bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update crews c set
    logo = coalesce(p ->> 'logo', c.logo), color = coalesce(lower(p ->> 'color'), c.color),
    description = coalesce(left(p ->> 'description', 200), c.description),
    is_public = coalesce((p ->> 'public')::boolean, c.is_public), min_level = coalesce((p ->> 'min_level')::integer, c.min_level)
  where c.id = p_id and c.leader = auth.uid();
end $$;

-- crews ranked, or one crew's members ranked. p_metric: xp | km | wins | events | challenges
create or replace function public.crew_board(p_metric text default 'xp', p_crew bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if p_crew is not null then
    return coalesce((select jsonb_agg(r order by (r ->> 'value')::numeric desc) from (
      select jsonb_build_object('id', p.id, 'name', p.name, 'username', p.username, 'me', p.id = me, 'value',
        case p_metric when 'km' then p.km when 'xp' then p.xp
          else (select count(*) from posts a where a.author = p.id and a.created_at > now() - interval '30 days'
            and a.akind = any(case p_metric when 'wins' then array['race_win', 'challenge_win'] when 'events' then array['event_join', 'event_done'] else array['challenge_win', 'challenge_new'] end)) end) r
      from crew_members m join profiles p on p.id = m.user_id
      where m.crew_id = p_crew and m.status = 'member' and (me is null or not public.cm_blocked(me, p.id))
    ) x), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(r order by (r ->> 'value')::numeric desc) from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'logo', c.logo, 'color', c.color, 'members', c.members,
      'mine', c.id = public.cm_crew_of(me), 'value',
      case p_metric when 'km' then (select coalesce(sum(p.km), 0) from crew_members m join profiles p on p.id = m.user_id where m.crew_id = c.id and m.status = 'member')
        when 'xp' then (select coalesce(sum(p.xp), 0) from crew_members m join profiles p on p.id = m.user_id where m.crew_id = c.id and m.status = 'member')
        else (select count(*) from posts a join crew_members m on m.user_id = a.author and m.crew_id = c.id and m.status = 'member'
          where a.created_at > now() - interval '30 days'
            and a.akind = any(case p_metric when 'wins' then array['race_win', 'challenge_win'] when 'events' then array['event_join', 'event_done'] else array['challenge_win', 'challenge_new'] end)) end) r
    from crews c order by c.members desc limit 100
  ) x), '[]'::jsonb);
end $$;

-- ---------- messages ----------
-- opens (or reopens) a private chat; returns its id
create or replace function public.chat_open(p_id uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text; conv bigint;
begin
  if me is null then raise exception 'signin'; end if;
  k := least(me, p_id)::text || ':' || greatest(me, p_id)::text;
  select id into conv from conversations where dm_key = k;
  if conv is null or not exists (select 1 from messages where conversation_id = conv) then
    if not public.cm_can_message(me, p_id) then raise exception 'privacy'; end if;
  end if;
  if public.cm_blocked(me, p_id) then raise exception 'blocked'; end if;
  if conv is null then
    insert into conversations (kind, dm_key) values ('dm', k) returning id into conv;
    insert into conversation_members (conversation_id, user_id) values (conv, me), (conv, p_id);
  else
    update conversation_members set left_at = null where conversation_id = conv and user_id = me;
  end if;
  return conv;
end $$;

create or replace function public.chat_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'signin'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'last_at' desc) from (
    select jsonb_strip_nulls(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'last_at', c.last_at, 'muted', cm.muted,
      'other', case when c.kind = 'dm' then public.cm_card(me, o.user_id) end,
      'crew', case when c.kind = 'crew' then (select jsonb_build_object('id', k.id, 'name', k.name, 'logo', k.logo, 'color', k.color, 'members', k.members) from crews k where k.id = c.crew_id) end,
      'last', (select jsonb_build_object('text', m.text, 'mine', m.sender = me, 'name', (select name from profiles where id = m.sender), 'at', m.created_at)
        from messages m where m.conversation_id = c.id
          and not exists (select 1 from blocks b where b.blocker = me and b.blocked = m.sender)
          and not exists (select 1 from mutes u where u.user_id = me and u.muted = m.sender)
        order by m.id desc limit 1),
      'unread', (select count(*) from messages m where m.conversation_id = c.id and m.sender <> me and m.created_at > cm.last_read_at
          and not exists (select 1 from blocks b where b.blocker = me and b.blocked = m.sender)
          and not exists (select 1 from mutes u where u.user_id = me and u.muted = m.sender))
    )) x
    from conversation_members cm
    join conversations c on c.id = cm.conversation_id
    left join conversation_members o on c.kind = 'dm' and o.conversation_id = c.id and o.user_id <> me
    where cm.user_id = me and cm.left_at is null
      and (c.kind = 'crew' or exists (select 1 from messages m where m.conversation_id = c.id) or true)
      and (c.kind <> 'dm' or not public.cm_blocked(me, o.user_id))
    limit 100
  ) t(x)), '[]'::jsonb);
end $$;

create or replace function public.chat_messages(p_conv bigint, p_before bigint default null, p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not public.cm_member(p_conv, me) then raise exception 'not_member'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'id')::bigint) from (
    select jsonb_build_object('id', m.id, 'from', m.sender, 'name', p.name, 'text', m.text, 'at', m.created_at, 'mine', m.sender = me,
      'reactions', coalesce((select jsonb_object_agg(emoji, n) from (select emoji, count(*) n from message_reactions r where r.message_id = m.id group by emoji) e), '{}'::jsonb),
      'my_reaction', (select emoji from message_reactions r where r.message_id = m.id and r.user_id = me)) x
    from messages m join profiles p on p.id = m.sender
    where m.conversation_id = p_conv and (p_before is null or m.id < p_before)
      and not exists (select 1 from blocks b where b.blocker = me and b.blocked = m.sender)
      and not exists (select 1 from mutes u where u.user_id = me and u.muted = m.sender)
    order by m.id desc limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ) t), '[]'::jsonb);
end $$;

create or replace function public.chat_send(p_conv bigint, p_text text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c conversations; other uuid; mid bigint;
begin
  if me is null then raise exception 'signin'; end if;
  if not public.cm_member(p_conv, me) then raise exception 'not_member'; end if;
  select * into c from conversations where id = p_conv;
  if c.kind = 'dm' then
    select user_id into other from conversation_members where conversation_id = p_conv and user_id <> me;
    if public.cm_blocked(me, other) then raise exception 'blocked'; end if;
    -- a reply is always fine; starting a chat follows "who can message me"
    if not exists (select 1 from messages where conversation_id = p_conv and sender = other) and not public.cm_can_message(me, other) then raise exception 'privacy'; end if;
    update conversation_members set left_at = null where conversation_id = p_conv and user_id = other
      and not exists (select 1 from blocks where blocker = other and blocked = me);
  end if;
  if (select count(*) from messages where sender = me and created_at > now() - interval '1 minute') >= 20 then raise exception 'rate'; end if;
  insert into messages (conversation_id, sender, text) values (p_conv, me, left(btrim(p_text), 500)) returning id into mid;
  update conversations set last_at = now() where id = p_conv;
  update conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = me;
  return mid;
end $$;

create or replace function public.chat_react(p_msg bigint, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv bigint;
begin
  select conversation_id into conv from messages where id = p_msg;
  if conv is null or not public.cm_member(conv, me) then raise exception 'not_member'; end if;
  if p_emoji is null or p_emoji = '' then delete from message_reactions where message_id = p_msg and user_id = me; return; end if;
  insert into message_reactions (message_id, user_id, emoji, conversation_id) values (p_msg, me, left(p_emoji, 8), conv)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
end $$;

-- p_action: read | leave | mute | unmute
create or replace function public.chat_mark(p_conv bigint, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c conversations;
begin
  select * into c from conversations where id = p_conv;
  if p_action = 'read' then update conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = me;
  elsif p_action = 'leave' then
    if c.kind = 'crew' then perform public.crew_leave(c.crew_id);
    else update conversation_members set left_at = now() where conversation_id = p_conv and user_id = me; end if;
  elsif p_action in ('mute', 'unmute') then update conversation_members set muted = (p_action = 'mute') where conversation_id = p_conv and user_id = me;
  end if;
end $$;

-- ---------- dating ----------
create or replace function public.cm_dating_card(viewer uuid, target uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t social_settings := public.cm_settings(target); v social_settings := public.cm_settings(viewer); p profiles;
begin
  select * into p from profiles where id = target;
  return jsonb_strip_nulls(jsonb_build_object('id', target, 'name', p.name, 'age', public.cm_age(t.dob), 'gender', p.gender, 'look', p.look,
    'level', public.cm_level(p.xp), 'hall', case when t.show_hall then nullif(t.hall, 'none') end,
    'interests', to_jsonb(t.interests),
    'shared', to_jsonb(array(select unnest(t.interests) intersect select unnest(v.interests))),
    'match', public.cm_match(viewer, target)));
end $$;

create or replace function public.dating_discover(p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); v social_settings; my_age integer;
begin
  if me is null then raise exception 'signin'; end if;
  v := public.cm_settings(me);
  my_age := public.cm_age(v.dob);
  if not v.dating_on or coalesce(my_age, 0) < 18 then raise exception 'dating_off'; end if;
  return coalesce((select jsonb_agg(public.cm_dating_card(me, s.user_id)) from (
    select s.user_id from social_settings s
    where s.user_id <> me and s.dating_on and s.campus = v.campus
      and public.cm_age(s.dob) >= 18
      and public.cm_age(s.dob) between v.dating_min and v.dating_max
      and my_age between s.dating_min and s.dating_max
      and (cardinality(v.dating_genders) = 0 or s.gender = any(v.dating_genders))
      and (cardinality(s.dating_genders) = 0 or v.gender = any(s.dating_genders))
      and not public.cm_blocked(me, s.user_id)
      and not exists (select 1 from hides h where h.user_id = me and h.hidden = s.user_id)
      and not exists (select 1 from dating_likes l where l.from_id = me and l.to_id = s.user_id)
      and not exists (select 1 from dating_passes d where d.from_id = me and d.to_id = s.user_id and d.created_at > now() - interval '30 days')
    order by cardinality(array(select unnest(s.interests) intersect select unnest(v.interests))) desc, s.updated_at desc
    limit least(greatest(coalesce(p_limit, 10), 1), 30)
  ) s), '[]'::jsonb);
end $$;

-- p_action: like | pass | unmatch. Returns 'match' when a like is mutual.
create or replace function public.dating_answer(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v social_settings; t social_settings;
begin
  if me is null then raise exception 'signin'; end if;
  v := public.cm_settings(me); t := public.cm_settings(p_id);
  if p_action = 'unmatch' then
    delete from dating_likes where (from_id = me and to_id = p_id) or (from_id = p_id and to_id = me);
    return 'none';
  end if;
  if not v.dating_on or not public.cm_adult(me) then raise exception 'dating_off'; end if;
  if p_action = 'pass' then
    insert into dating_passes (from_id, to_id) values (me, p_id) on conflict (from_id, to_id) do update set created_at = now();
    return 'none';
  end if;
  if not t.dating_on or not public.cm_adult(p_id) or public.cm_blocked(me, p_id) then raise exception 'not_found'; end if;
  insert into dating_likes (from_id, to_id) values (me, p_id) on conflict do nothing;
  if public.cm_match(me, p_id) then
    perform public.cm_notify(p_id, 'dating_match', me, me::text, 'You and ' || (select name from profiles where id = me) || ' connected. Say hi!');
    perform public.cm_notify(me, 'dating_match', p_id, p_id::text, 'You and ' || (select name from profiles where id = p_id) || ' connected. Say hi!');
    return 'match';
  end if;
  -- the other rider only hears of a like once it is mutual
  return 'liked';
end $$;

create or replace function public.dating_matches() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'signin'; end if;
  return coalesce((select jsonb_agg(public.cm_dating_card(me, l.to_id) order by l.created_at desc)
    from dating_likes l where l.from_id = me and public.cm_match(me, l.to_id) and not public.cm_blocked(me, l.to_id)), '[]'::jsonb);
end $$;

-- ---------- notifications ----------
create or replace function public.community_notifications(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'signin'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'actor', n.actor, 'ref', n.ref, 'text', n.text, 'read', n.read, 'at', n.created_at) order by n.id desc)
    from (select * from notifications where user_id = me order by id desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) n
    where n.actor is null or not public.cm_blocked(me, n.actor)), '[]'::jsonb);
end $$;

create or replace function public.community_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read = true where user_id = auth.uid() and not read;
$$;

-- ---------- Vibe Ride invite through Community (needs the other rider's "who can invite me") ----------
create or replace function public.community_vibe_invite(p_id uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'signin'; end if;
  if not public.cm_can_vibe(me, p_id) then raise exception 'privacy'; end if;
  if (select count(*) from invites where from_id = me and created_at > now() - interval '1 hour') >= 20 then raise exception 'rate'; end if;
  insert into invites (from_id, to_id, code) values (me, p_id, p_code);
  perform public.cm_notify(p_id, 'vibe_invite', me, p_code, public.cm_name(me) || ' wants to ride with you');
end $$;

-- ---------- leaderboards ----------
-- p_kind: riders (XP) | active (km this week) | events | challenges | social (friends) | contributors (posts and reactions)
create or replace function public.community_board(p_kind text, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', p.name, 'username', p.username, 'hall', nullif(p.hall, 'none'), 'value', x.v, 'me', x.id = me) order by x.v desc)
  from (
    select id, v from (
      select p.id, p.xp::numeric as v from profiles p where p_kind = 'riders'
      union all
      select r.user_id, round(sum(r.km), 1) from rides r where p_kind = 'active' and r.created_at > now() - interval '7 days' group by r.user_id
      union all
      select a.author, count(*) from posts a where p_kind = 'events' and a.akind in ('event_join', 'event_done') and a.created_at > now() - interval '30 days' group by a.author
      union all
      select a.author, count(*) from posts a where p_kind = 'challenges' and a.akind = 'challenge_win' and a.created_at > now() - interval '30 days' group by a.author
      union all
      select f.id, count(*) from (select a as id from friendships where status = 'accepted' union all select b from friendships where status = 'accepted') f where p_kind = 'social' group by f.id
      union all
      select u.id, count(*) from (
        select author as id from posts where kind = 'text' and created_at > now() - interval '30 days'
        union all select user_id from post_reactions where created_at > now() - interval '30 days') u
      where p_kind = 'contributors' group by u.id
    ) t
    where me is null or not public.cm_blocked(me, t.id)
    order by v desc limit lim
  ) x join profiles p on p.id = x.id), '[]'::jsonb);
end $$;

-- ---------- one call for the Community home ----------
create or replace function public.community_home() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); s social_settings; crew bigint;
begin
  if me is null then raise exception 'signin'; end if;
  insert into social_settings (user_id, hall, course, gender)
    select me, coalesce(p.hall, 'none'), p.department, p.gender from profiles p where p.id = me
    on conflict (user_id) do nothing;
  s := public.cm_settings(me);
  crew := public.cm_crew_of(me);
  return jsonb_build_object(
    'settings', to_jsonb(s) - 'dob' - 'user_id' || jsonb_build_object('adult', public.cm_adult(me)),
    'friends', (select count(*) from public.cm_friend_ids(me)),
    'friend_ids', (select coalesce(jsonb_agg(f), '[]'::jsonb) from public.cm_friend_ids(me) f),
    'match_ids', (select coalesce(jsonb_agg(l.to_id), '[]'::jsonb) from dating_likes l where l.from_id = me and public.cm_match(me, l.to_id)),
    'followers', (select count(*) from follows where followee = me),
    'following', (select count(*) from follows where follower = me),
    'requests', (select count(*) from friendships where me in (a, b) and status = 'pending' and requester <> me),
    'buddies', (select count(*) from public.cm_friend_ids(me) f join social_settings x on x.user_id = f and 'buddies' = any(x.statuses))
      + (select count(*) from rode_together where user_id = me),
    'hall', jsonb_build_object('id', s.hall,
      'members', (select count(*) from profiles p left join social_settings x on x.user_id = p.id where coalesce(x.hall, p.hall) = s.hall and s.hall <> 'none')),
    'course', case when s.course is not null then jsonb_build_object('name', s.course,
      'members', (select count(*) from profiles p left join social_settings x on x.user_id = p.id where coalesce(x.course, p.department) = s.course)) end,
    'level', case when s.level is not null and s.course is not null then jsonb_build_object('name', s.level,
      'members', (select count(*) from social_settings x where x.course = s.course and x.level = s.level)) end,
    'crew', case when crew is not null then (select public.cm_crew_json(me, c) from crews c where c.id = crew) end,
    'crews', (select coalesce(jsonb_agg(public.cm_crew_json(me, c)), '[]'::jsonb) from (select * from crews where id is distinct from crew order by members desc limit 3) c),
    'suggest', public.community_people('suggest', '', 8, 0),
    'feed', public.community_feed('home', null, null, 4),
    'chats', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select jsonb_array_elements(public.chat_list()) x limit 3) t),
    'unread', (select coalesce(sum((x ->> 'unread')::integer), 0) from jsonb_array_elements(public.chat_list()) x where not coalesce((x ->> 'muted')::boolean, false)),
    'notifications', (select count(*) from notifications where user_id = me and not read),
    'matches', (select count(*) from dating_likes l where l.from_id = me and public.cm_match(me, l.to_id))
  );
end $$;

-- group pages: a hall or a programme. p_kind: hall | course
create or replace function public.community_group(p_kind text, p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'signin'; end if;
  return jsonb_build_object(
    'members', case when p_kind = 'hall'
      then (select count(*) from profiles p left join social_settings x on x.user_id = p.id where coalesce(x.hall, p.hall) = p_ref)
      else (select count(*) from profiles p left join social_settings x on x.user_id = p.id where coalesce(x.course, p.department) = p_ref) end,
    'people', public.community_people(p_kind, p_ref, 40, 0),
    'feed', public.community_feed(p_kind, p_ref, null, 15),
    'crews', (select coalesce(jsonb_agg(public.cm_crew_json(me, c)), '[]'::jsonb) from (
      select c.* from crews c where exists (select 1 from crew_members m join social_settings x on x.user_id = m.user_id
        where m.crew_id = c.id and m.status = 'member' and ((p_kind = 'hall' and x.hall = p_ref and x.show_hall) or (p_kind = 'course' and x.course = p_ref and x.show_course)))
      order by c.members desc limit 5) c));
end $$;

-- ---------- who may call what ----------
do $$
declare f text;
begin
  -- internal helpers: not callable from the app
  foreach f in array array['cm_level(integer)', 'cm_age(date)', 'cm_friends(uuid,uuid)', 'cm_blocked(uuid,uuid)', 'cm_friend_ids(uuid)', 'cm_mutual(uuid,uuid)',
    'cm_match(uuid,uuid)', 'cm_crew_of(uuid)', 'cm_same_crew(uuid,uuid)', 'cm_settings(uuid)', 'cm_shared(uuid,uuid)', 'cm_can_find(uuid,uuid)',
    'cm_can_message(uuid,uuid)', 'cm_can_request(uuid,uuid)', 'cm_adult(uuid)', 'cm_card(uuid,uuid,text)', 'cm_notify(uuid,text,uuid,text,text)',
    'cm_name(uuid)', 'cm_can_see_post(uuid,posts)', 'cm_post_json(uuid,posts)', 'cm_crew_json(uuid,crews)', 'cm_crew_add(bigint,uuid)', 'cm_dating_card(uuid,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- used inside row rules, so the app's role needs them
  foreach f in array array['cm_member(bigint,uuid)', 'cm_can_vibe(uuid,uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['community_save_settings(jsonb)', 'community_people(text,text,integer,integer)', 'community_card(uuid)',
    'community_friend(uuid,text)', 'community_toggle(uuid,text,boolean)', 'community_report(uuid,text,text,text,text,jsonb)', 'community_rode_with(uuid)',
    'community_feed(text,text,bigint,integer)', 'community_post(text,text,text,text,text)', 'community_post_delete(bigint)', 'community_react(bigint,text)',
    'crew_get(bigint)', 'crew_create(text,text,text,text,boolean,integer)', 'crew_join(bigint)', 'crew_answer(bigint,uuid,boolean)',
    'crew_leave(bigint)', 'crew_update(bigint,jsonb)', 'chat_open(uuid)', 'chat_list()', 'chat_messages(bigint,bigint,integer)',
    'chat_send(bigint,text)', 'chat_react(bigint,text)', 'chat_mark(bigint,text)', 'dating_discover(integer)', 'dating_answer(uuid,text)', 'dating_matches()',
    'community_notifications(integer)', 'community_notifications_read()', 'community_vibe_invite(uuid,text)', 'community_home()', 'community_group(text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- public lists anyone can open
  foreach f in array array['crew_list(text,integer)', 'crew_board(text,bigint)', 'community_board(text,integer)'] loop
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ===================== supabase/sql/40-store.sql =====================
-- Garage & Store. Run after 00-core.sql (needs public.is_admin()). Safe to run again.
-- The game works fully offline with its built-in catalogue; these tables only let admins change
-- prices / switch items off / schedule rotations without a release, and keep an honest purchase log.
-- Rush Coins and Diamonds are in-game only and never cashable.

-- Admin overrides for catalogue items (id = the game's item id, e.g. 'bike:x1', 'paint:gold').
create table if not exists public.store_items (
  id text primary key,
  price_coins integer check (price_coins is null or price_coins >= 0),
  price_diamonds integer check (price_diamonds is null or price_diamonds >= 0),
  disabled boolean not null default false,
  rarity text check (rarity is null or rarity in ('common','uncommon','rare','epic','legendary','mythic')),
  name text,
  updated_at timestamptz not null default now()
);
alter table public.store_items enable row level security;
drop policy if exists "store items read" on public.store_items;
create policy "store items read" on public.store_items for select using (true);
drop policy if exists "store items admin write" on public.store_items;
create policy "store items admin write" on public.store_items for all using (public.is_admin()) with check (public.is_admin());

-- Scheduled slots that replace the date-seeded rotation while they are live.
create table if not exists public.store_rotation (
  id bigserial primary key,
  slot text not null check (slot in ('featured','drop','daily','ending')),
  item_id text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists store_rotation_live on public.store_rotation (slot, ends_at);
alter table public.store_rotation enable row level security;
drop policy if exists "store rotation read" on public.store_rotation;
create policy "store rotation read" on public.store_rotation for select using (true);
drop policy if exists "store rotation admin write" on public.store_rotation;
create policy "store rotation admin write" on public.store_rotation for all using (public.is_admin()) with check (public.is_admin());

-- What riders bought (in-game currency only). Riders see their own; admins see all.
create table if not exists public.store_purchases (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id text not null,
  coins integer not null default 0 check (coins >= 0),
  diamonds integer not null default 0 check (diamonds >= 0),
  at timestamptz not null default now()
);
create index if not exists store_purchases_user on public.store_purchases (user_id, at desc);
alter table public.store_purchases enable row level security;
drop policy if exists "store purchases insert own" on public.store_purchases;
create policy "store purchases insert own" on public.store_purchases for insert with check (auth.uid() = user_id);
drop policy if exists "store purchases read" on public.store_purchases;
create policy "store purchases read" on public.store_purchases for select using (auth.uid() = user_id or public.is_admin());

-- Wishlists (private per rider; only the aggregated counts below are public).
create table if not exists public.store_wishlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.store_wishlist enable row level security;
drop policy if exists "store wishlist own" on public.store_wishlist;
create policy "store wishlist own" on public.store_wishlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Most wished-for items: real counts only, never names. The client shows it only when 3+ riders wished.
create or replace function public.store_trending(p_limit integer default 6)
returns table (item_id text, riders bigint)
language sql stable security definer set search_path = public as $$
  select w.item_id, count(*)::bigint as riders
  from public.store_wishlist w
  group by w.item_id
  having count(*) >= 3
  order by riders desc, w.item_id
  limit least(greatest(coalesce(p_limit, 6), 1), 20);
$$;
grant execute on function public.store_trending(integer) to authenticated, anon;
