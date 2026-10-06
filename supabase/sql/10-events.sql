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
