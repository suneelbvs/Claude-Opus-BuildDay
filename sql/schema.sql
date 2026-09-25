-- =====================================================================
-- Opus Build Day, Bangalore: Supabase schema
--
-- Paste this whole file into Supabase > SQL Editor and run it.
-- Safe to re-run: tables use IF NOT EXISTS, policies are dropped first,
-- and functions are CREATE OR REPLACE.
--
-- Security model (the browser only ever holds the publishable key):
--   * Everyone (even signed-out visitors) can READ the pile, teams, wall
--     and active announcements, the same as the original public page.
--   * Signed-in users (anonymous guests or email users) can CREATE rows
--     that belong to them and UPDATE/DELETE only their own rows.
--   * Hosts (profiles.is_host = true, set by hand in SQL) can delete
--     anything and manage announcements. The browser can never set it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- 1. profiles: one per attendee (was `builders` in the page state)
create table if not exists public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    name        text not null check (char_length(btrim(name)) between 1 and 40),
    role        text check (char_length(role) <= 80),
    building    text check (char_length(building) <= 200),
    linkedin    text check (char_length(linkedin) <= 100),
    shape       text not null default 'square' check (shape in ('square','triangle','circle','arch')),
    tone        text not null default 'cream'  check (tone in ('cream','ink','clay')),
    is_host     boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- 2. user_skills: "What you bring" (Agents, Design, Data & ML, ...)
create table if not exists public.user_skills (
    id       bigint generated always as identity primary key,
    user_id  uuid not null references public.profiles(id) on delete cascade,
    skill    text not null check (char_length(skill) between 1 and 28)
);
create index if not exists user_skills_user_id_idx on public.user_skills(user_id);

-- 3. user_interests: "Looking for" (Teammates, A mentor, ...)
create table if not exists public.user_interests (
    id        bigint generated always as identity primary key,
    user_id   uuid not null references public.profiles(id) on delete cascade,
    interest  text not null check (char_length(interest) between 1 and 40)
);
create index if not exists user_interests_user_id_idx on public.user_interests(user_id);

-- 4. teams
create table if not exists public.teams (
    id          uuid primary key default gen_random_uuid(),
    name        text not null check (char_length(btrim(name)) between 1 and 50),
    idea        text check (char_length(idea) <= 240),
    needs       text[] not null default '{}' check (cardinality(needs) <= 4),
    owner_id    uuid references public.profiles(id) on delete set null,
    created_at  timestamptz not null default now()
);

-- 5. team_members (max 8 per team, enforced by trigger below)
create table if not exists public.team_members (
    team_id    uuid not null references public.teams(id) on delete cascade,
    user_id    uuid not null references public.profiles(id) on delete cascade,
    joined_at  timestamptz not null default now(),
    primary key (team_id, user_id)
);
create index if not exists team_members_user_id_idx on public.team_members(user_id);

-- 6. wall_posts. user_id points at auth.users (not profiles) because the
--    page lets people post "as a curious builder" before adding a block.
create table if not exists public.wall_posts (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    kind        text not null default 'Idea' check (kind in ('Question','Idea','Looking for','Logistics','Hot take')),
    message     text not null check (char_length(btrim(message)) between 1 and 280),
    created_at  timestamptz not null default now()
);
create index if not exists wall_posts_created_at_idx on public.wall_posts(created_at desc);

-- 7. chat_messages (V1.1; no UI yet). Rooms:
--      'general'            anyone signed in
--      'team:<team-uuid>'   members of that team
--      'user:<uuidA>:<uuidB>'  the two people named
create table if not exists public.chat_messages (
    id          bigint generated always as identity primary key,
    room_id     text not null check (char_length(room_id) <= 120),
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    message     text not null check (char_length(btrim(message)) between 1 and 1000),
    created_at  timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on public.chat_messages(room_id, created_at);

-- 8. announcements: host-only, shown to everyone live
create table if not exists public.announcements (
    id          bigint generated always as identity primary key,
    message     text not null check (char_length(btrim(message)) between 1 and 280),
    active      boolean not null default true,
    created_by  uuid default auth.uid() references auth.users(id) on delete set null,
    created_at  timestamptz not null default now()
);

-- 9. ai_usage: rate limiting for the collider Edge Function.
--    No browser access at all; only the function's service role writes it.
create table if not exists public.ai_usage (
    id          bigint generated always as identity primary key,
    user_id     uuid not null,
    created_at  timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Helper functions and triggers
-- ---------------------------------------------------------------------

-- Is the caller a host? SECURITY DEFINER so it can read is_host
-- regardless of the caller's own privileges.
create or replace function public.is_host()
returns boolean
language sql stable security definer set search_path = ''
as $$
    select coalesce((select p.is_host from public.profiles p where p.id = auth.uid()), false);
$$;

-- Can the caller read/write a chat room?
create or replace function public.can_access_room(room text)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select case
        when auth.uid() is null then false
        when room = 'general' then true
        when room like 'team:%' then exists (
            select 1 from public.team_members m
            where m.team_id::text = substr(room, 6) and m.user_id = auth.uid())
        when room like 'user:%' then auth.uid()::text = any (string_to_array(substr(room, 6), ':'))
        else false
    end;
$$;

-- Keep profiles.updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
    for each row execute function public.touch_updated_at();

-- Up to eight blocks per team. Locks the team row so two people joining
-- at the same moment can't both squeeze in as #8.
create or replace function public.enforce_team_size()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    perform 1 from public.teams where id = new.team_id for update;
    if (select count(*) from public.team_members where team_id = new.team_id) >= 8 then
        raise exception 'team_full' using errcode = 'P0001', hint = 'Teams hold up to eight people.';
    end if;
    return new;
end $$;

drop trigger if exists team_members_limit on public.team_members;
create trigger team_members_limit before insert on public.team_members
    for each row execute function public.enforce_team_size();

-- ---------------------------------------------------------------------
-- RPCs used by the page (SECURITY INVOKER: RLS still applies)
-- ---------------------------------------------------------------------

-- Create or update the caller's block, skills and interests in one transaction.
create or replace function public.save_profile(
    p_name       text,
    p_role       text default null,
    p_building   text default null,
    p_linkedin   text default null,
    p_shape      text default 'square',
    p_tone       text default 'cream',
    p_skills     text[] default '{}',
    p_interests  text[] default '{}'
)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    if cardinality(coalesce(p_skills, '{}')) > 6 or cardinality(coalesce(p_interests, '{}')) > 4 then
        raise exception 'too_many_tags' using errcode = '22023';
    end if;

    insert into public.profiles (id, name, role, building, linkedin, shape, tone)
    values (uid, btrim(p_name), nullif(btrim(p_role), ''), nullif(btrim(p_building), ''),
            nullif(btrim(p_linkedin), ''), p_shape, p_tone)
    on conflict (id) do update set
        name = excluded.name, role = excluded.role, building = excluded.building,
        linkedin = excluded.linkedin, shape = excluded.shape, tone = excluded.tone;

    delete from public.user_skills where user_id = uid;
    insert into public.user_skills (user_id, skill)
        select uid, btrim(s) from unnest(coalesce(p_skills, '{}')) with ordinality as t(s, n)
        where btrim(s) <> '' order by n;

    delete from public.user_interests where user_id = uid;
    insert into public.user_interests (user_id, interest)
        select uid, btrim(s) from unnest(coalesce(p_interests, '{}')) with ordinality as t(s, n)
        where btrim(s) <> '' order by n;
end $$;

-- Start a team and join it as its first member, atomically.
create or replace function public.create_team(
    p_name   text,
    p_idea   text default null,
    p_needs  text[] default '{}'
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
    uid uuid := auth.uid();
    tid uuid;
begin
    if uid is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    insert into public.teams (name, idea, needs, owner_id)
    values (btrim(p_name), nullif(btrim(p_idea), ''), coalesce(p_needs, '{}'), uid)
    returning id into tid;
    insert into public.team_members (team_id, user_id) values (tid, uid);
    return tid;
end $$;

-- ---------------------------------------------------------------------
-- Grants: expose only what the page needs. is_host, owner_id, user_id
-- and timestamps are never writable from the browser.
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.user_skills, public.user_interests, public.teams,
              public.team_members, public.wall_posts, public.chat_messages,
              public.announcements, public.ai_usage
    from anon, authenticated;

grant select on public.profiles, public.user_skills, public.user_interests, public.teams,
                public.team_members, public.wall_posts, public.announcements
    to anon, authenticated;

grant insert (id, name, role, building, linkedin, shape, tone) on public.profiles to authenticated;
grant update (name, role, building, linkedin, shape, tone)     on public.profiles to authenticated;
grant delete                                                    on public.profiles to authenticated;

grant insert (user_id, skill)    on public.user_skills    to authenticated;
grant delete                     on public.user_skills    to authenticated;
grant insert (user_id, interest) on public.user_interests to authenticated;
grant delete                     on public.user_interests to authenticated;

grant insert (name, idea, needs, owner_id) on public.teams to authenticated;
grant update (name, idea, needs)           on public.teams to authenticated;
grant delete                               on public.teams to authenticated;

grant insert (team_id, user_id) on public.team_members to authenticated;
grant delete                    on public.team_members to authenticated;

grant insert (kind, message) on public.wall_posts to authenticated;
grant update (kind, message) on public.wall_posts to authenticated;
grant delete                 on public.wall_posts to authenticated;

grant select, delete         on public.chat_messages to authenticated;
grant insert (room_id, message) on public.chat_messages to authenticated;

grant insert (message, active) on public.announcements to authenticated;
grant update (message, active) on public.announcements to authenticated;
grant delete                   on public.announcements to authenticated;

revoke all on function public.save_profile(text, text, text, text, text, text, text[], text[]) from public, anon;
revoke all on function public.create_team(text, text, text[]) from public, anon;
grant execute on function public.save_profile(text, text, text, text, text, text, text[], text[]) to authenticated;
grant execute on function public.create_team(text, text, text[]) to authenticated;
grant execute on function public.is_host() to anon, authenticated;
grant execute on function public.can_access_room(text) to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.user_skills     enable row level security;
alter table public.user_interests  enable row level security;
alter table public.teams           enable row level security;
alter table public.team_members    enable row level security;
alter table public.wall_posts      enable row level security;
alter table public.chat_messages   enable row level security;
alter table public.announcements   enable row level security;
alter table public.ai_usage        enable row level security;  -- no policies: service role only

-- profiles
drop policy if exists "Profiles readable"          on public.profiles;
drop policy if exists "Users insert own profile"   on public.profiles;
drop policy if exists "Users update own profile"   on public.profiles;
drop policy if exists "Users or host delete profile" on public.profiles;
create policy "Profiles readable" on public.profiles
    for select to anon, authenticated using (true);
create policy "Users insert own profile" on public.profiles
    for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users update own profile" on public.profiles
    for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Users or host delete profile" on public.profiles
    for delete to authenticated using ((select auth.uid()) = id or (select public.is_host()));

-- user_skills
drop policy if exists "Skills readable"        on public.user_skills;
drop policy if exists "Users add own skills"    on public.user_skills;
drop policy if exists "Users delete own skills" on public.user_skills;
create policy "Skills readable" on public.user_skills
    for select to anon, authenticated using (true);
create policy "Users add own skills" on public.user_skills
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own skills" on public.user_skills
    for delete to authenticated using ((select auth.uid()) = user_id);

-- user_interests
drop policy if exists "Interests readable"        on public.user_interests;
drop policy if exists "Users add own interests"    on public.user_interests;
drop policy if exists "Users delete own interests" on public.user_interests;
create policy "Interests readable" on public.user_interests
    for select to anon, authenticated using (true);
create policy "Users add own interests" on public.user_interests
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own interests" on public.user_interests
    for delete to authenticated using ((select auth.uid()) = user_id);

-- teams
drop policy if exists "Teams readable"              on public.teams;
drop policy if exists "Users create own teams"      on public.teams;
drop policy if exists "Owner or host update team"   on public.teams;
drop policy if exists "Owner or host delete team"   on public.teams;
create policy "Teams readable" on public.teams
    for select to anon, authenticated using (true);
create policy "Users create own teams" on public.teams
    for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owner or host update team" on public.teams
    for update to authenticated
    using ((select auth.uid()) = owner_id or (select public.is_host()))
    with check ((select auth.uid()) = owner_id or (select public.is_host()));
create policy "Owner or host delete team" on public.teams
    for delete to authenticated using ((select auth.uid()) = owner_id or (select public.is_host()));

-- team_members
drop policy if exists "Members readable"             on public.team_members;
drop policy if exists "Users join as themselves"     on public.team_members;
drop policy if exists "Users leave, owner or host remove" on public.team_members;
create policy "Members readable" on public.team_members
    for select to anon, authenticated using (true);
create policy "Users join as themselves" on public.team_members
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users leave, owner or host remove" on public.team_members
    for delete to authenticated using (
        (select auth.uid()) = user_id
        or (select public.is_host())
        or exists (select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid()))
    );

-- wall_posts
drop policy if exists "Posts readable"          on public.wall_posts;
drop policy if exists "Users create own posts"  on public.wall_posts;
drop policy if exists "Authors update posts"    on public.wall_posts;
drop policy if exists "Author or host delete post" on public.wall_posts;
create policy "Posts readable" on public.wall_posts
    for select to anon, authenticated using (true);
create policy "Users create own posts" on public.wall_posts
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Authors update posts" on public.wall_posts
    for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Author or host delete post" on public.wall_posts
    for delete to authenticated using ((select auth.uid()) = user_id or (select public.is_host()));

-- chat_messages
drop policy if exists "Room members read chat"   on public.chat_messages;
drop policy if exists "Room members send chat"   on public.chat_messages;
drop policy if exists "Author or host delete chat" on public.chat_messages;
create policy "Room members read chat" on public.chat_messages
    for select to authenticated using (public.can_access_room(room_id) or (select public.is_host()));
create policy "Room members send chat" on public.chat_messages
    for insert to authenticated with check ((select auth.uid()) = user_id and public.can_access_room(room_id));
create policy "Author or host delete chat" on public.chat_messages
    for delete to authenticated using ((select auth.uid()) = user_id or (select public.is_host()));

-- announcements
drop policy if exists "Active announcements readable" on public.announcements;
drop policy if exists "Hosts create announcements"    on public.announcements;
drop policy if exists "Hosts update announcements"    on public.announcements;
drop policy if exists "Hosts delete announcements"    on public.announcements;
create policy "Active announcements readable" on public.announcements
    for select to anon, authenticated using (active or (select public.is_host()));
create policy "Hosts create announcements" on public.announcements
    for insert to authenticated with check ((select public.is_host()));
create policy "Hosts update announcements" on public.announcements
    for update to authenticated using ((select public.is_host())) with check ((select public.is_host()));
create policy "Hosts delete announcements" on public.announcements
    for delete to authenticated using ((select public.is_host()));

-- ---------------------------------------------------------------------
-- Realtime: broadcast row changes to every open page
-- ---------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array['profiles','user_skills','user_interests','teams',
                             'team_members','wall_posts','chat_messages','announcements']
    loop
        begin
            execute format('alter publication supabase_realtime add table public.%I', t);
        exception when duplicate_object then null;
        end;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- Make yourself a host (run separately, after you've added your block
-- and linked your email from the page):
--
--   update public.profiles set is_host = true
--   where id = (select id from auth.users where email = 'you@example.com');
-- ---------------------------------------------------------------------
