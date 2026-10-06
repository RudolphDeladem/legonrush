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
