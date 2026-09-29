
-- DunphyRooms database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It is safe to run once on a new project.

------------------------------------------------------------
-- 1. Host profiles
--    One row per signed-in user. Only the server functions
--    (which use the service role key) can change these fields,
--    so nobody can mark themselves as verified.
------------------------------------------------------------
create table if not exists public.profiles (
  id                       uuid primary key references auth.users on delete cascade,
  email                    text,
  id_verified              boolean     not null default false,
  id_verified_at           timestamptz,
  id_paid                  boolean     not null default false,  -- paid $2.99, or got it free with Boost
  id_attempts_left         int         not null default 0,      -- limits how many Stripe checks one payment covers
  verification_session_id  text,
  last_verification_error  text,
  created_at               timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);
-- No insert/update policies on purpose: only server functions write here.

-- Create a profile automatically when someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------
-- 2. Listings
--    Hosts can create and edit the descriptive fields.
--    The verification fields (own_verified, photos_verified)
--    and boost fields can only be changed by an admin in the
--    Supabase dashboard or by the server functions.
------------------------------------------------------------
create table if not exists public.listings (
  id                      uuid primary key default gen_random_uuid(),
  host_id                 uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title                   text not null check (char_length(title) between 5 and 120),
  suburb                  text not null check (char_length(suburb) <= 80),
  uni                     text check (char_length(uni) <= 120),
  price                   int  not null check (price between 50 and 2000),
  room_type               text not null check (room_type in ('Private room', 'Private room + ensuite', 'Shared room')),
  furnished               boolean not null default false,
  bills                   boolean not null default false,
  pets                    boolean not null default false,
  housemates              int  not null default 1 check (housemates between 0 and 20),
  description             text check (char_length(description) <= 2000),
  own_verified            boolean not null default false,   -- admin ticks after checking ownership documents
  photos_verified         boolean not null default false,   -- admin ticks after checking photos
  boost_until             timestamptz,                      -- set by the Stripe webhook
  stripe_subscription_id  text,
  status                  text not null default 'active' check (status in ('active', 'paused', 'removed')),
  last_host_reply_at      timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

alter table public.listings enable row level security;

drop policy if exists "Hosts can read their own listings" on public.listings;
create policy "Hosts can read their own listings"
  on public.listings for select
  using (auth.uid() = host_id);

drop policy if exists "Hosts can create listings" on public.listings;
create policy "Hosts can create listings"
  on public.listings for insert to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "Hosts can edit their own listings" on public.listings;
create policy "Hosts can edit their own listings"
  on public.listings for update to authenticated
  using (auth.uid() = host_id and status <> 'removed')
  with check (auth.uid() = host_id and status in ('active', 'paused'));

-- Column-level permissions: hosts may only write the descriptive columns
revoke insert, update on public.listings from anon, authenticated;
grant insert (title, suburb, uni, price, room_type, furnished, bills, pets, housemates, description)
  on public.listings to authenticated;
grant update (title, suburb, uni, price, room_type, furnished, bills, pets, housemates, description, status)
  on public.listings to authenticated;

------------------------------------------------------------
-- 3. Public search results
--    Anyone can read this view. It only shows active listings
--    that an admin has approved, plus whether the host's ID is
--    verified. It never exposes host emails or user IDs.
------------------------------------------------------------
create or replace view public.public_listings as
select
  l.id, l.title, l.suburb, l.uni, l.price, l.room_type,
  l.furnished, l.bills, l.pets, l.housemates, l.description,
  l.last_host_reply_at, l.created_at,
  p.id_verified                                           as host_id_verified,
  (l.boost_until is not null and l.boost_until > now())   as boosted
from public.listings l
join public.profiles p on p.id = l.host_id
where l.status = 'active'
  and l.own_verified
  and l.photos_verified;

grant select on public.public_listings to anon, authenticated;

------------------------------------------------------------
-- 4. Private storage for ownership documents and room photos
--    Hosts can upload into their own folder but cannot read
--    anything back. You review files in Storage > host-docs.
------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('host-docs', 'host-docs', false)
on conflict (id) do nothing;

drop policy if exists "Hosts upload to their own folder" on storage.objects;
create policy "Hosts upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'host-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
