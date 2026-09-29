-- DunphyRooms admin setup
-- Run this AFTER schema.sql: Supabase > SQL Editor > New query > paste > Run.
-- Safe to run more than once. It adds:
--   * an "admins" list (only people on it can use admin.html)
--   * review notes on listings
--   * read access for admins to all listings, host profiles and uploaded documents
-- Admins change listings only through the admin-review server function,
-- which double-checks the admin list before doing anything.

------------------------------------------------------------
-- 1. Who is an admin
------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- No policies: nobody can read or change this list from the website.
-- You add admins with the SQL at the bottom of this file.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

------------------------------------------------------------
-- 2. Review details on each listing
------------------------------------------------------------
alter table public.listings add column if not exists review_note text;        -- reason given when removed
alter table public.listings add column if not exists reviewed_at timestamptz;
alter table public.listings add column if not exists reviewed_by uuid references auth.users on delete set null;

-- Let the website choose a listing's ID up front, so uploaded documents
-- can be stored in a folder for that listing.
grant insert (id) on public.listings to authenticated;

------------------------------------------------------------
-- 3. Admins can read everything they need to review
------------------------------------------------------------
drop policy if exists "Admins can read all listings" on public.listings;
create policy "Admins can read all listings"
  on public.listings for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins can view host documents" on storage.objects;
create policy "Admins can view host documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'host-docs' and public.is_admin());

------------------------------------------------------------
-- 4. Make yourself an admin
--    1) Create an account on your website first (Log in > Create account)
--       and click the confirmation email.
--    2) Open a NEW query, paste in the two lines below WITHOUT the "-- "
--       at the start, put your account's email in the quotes, and Run.
--       You should see "Success. 1 row affected". "0 rows" means the
--       email didn't match an account.
------------------------------------------------------------
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'your-business-email@example.com';
