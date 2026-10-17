-- Private profile details. Users save these once; they pre-fill the
-- listing form. Phone/email are shown to a renter only after the owner
-- approves their booking (for paying with Zelle).
create table if not exists public.profile_details (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  full_name              text check (char_length(full_name) <= 80),
  phone                  text check (char_length(phone) <= 30),
  contact_email          text check (char_length(contact_email) <= 120),
  default_hourly_cents   int  check (default_hourly_cents between 50 and 10000),
  default_daily_cents    int  check (default_daily_cents between 100 and 50000),
  default_deposit_cents  int  not null default 0 check (default_deposit_cents between 0 and 50000),
  default_pickup_address text check (char_length(default_pickup_address) <= 200),
  default_return_address text check (char_length(default_return_address) <= 200),
  default_photo_paths    text[] not null default '{}',
  updated_at             timestamptz not null default now()
);

alter table public.profile_details enable row level security;

drop policy if exists "profile_details: read own" on public.profile_details;
create policy "profile_details: read own" on public.profile_details
  for select using (user_id = auth.uid());

drop policy if exists "profile_details: insert own" on public.profile_details;
create policy "profile_details: insert own" on public.profile_details
  for insert with check (user_id = auth.uid());

drop policy if exists "profile_details: update own" on public.profile_details;
create policy "profile_details: update own" on public.profile_details
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A renter can see the owner's contact info only once the booking is approved.
create or replace function public.booking_payment_contact(p_booking_id uuid)
returns table (full_name text, phone text, contact_email text)
language sql
stable
security definer
set search_path = public
as $$
  select d.full_name, d.phone, d.contact_email
    from public.bookings b
    join public.profile_details d on d.user_id = b.owner_id
   where b.id = p_booking_id
     and b.renter_id = auth.uid()
     and b.status in ('accepted', 'confirmed', 'active');
$$;

revoke execute on function public.booking_payment_contact(uuid) from public, anon;
grant execute on function public.booking_payment_contact(uuid) to authenticated;