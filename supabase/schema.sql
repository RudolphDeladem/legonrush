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
