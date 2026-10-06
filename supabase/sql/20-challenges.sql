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
