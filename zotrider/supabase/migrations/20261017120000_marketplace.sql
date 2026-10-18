-- =====================================================================
-- ZotRider — Migration 2: student-to-student marketplace
--
-- Run AFTER 20261017000000_init.sql (the first setup you already ran).
-- Replaces the UCI-owned fleet (stations / vehicles / rides) with:
--   listings  → students list their own scooters & bikes, set their own
--               hourly and/or daily prices
--   bookings  → renter requests, owner approves, renter pays in-app
--   messages, reviews, payout accounts (Stripe Connect), listing photos
--
-- Booking life cycle:
--   requested → accepted (renter has until payment_due_at to pay)
--             → confirmed (paid) → active (picked up) → completed (returned)
--   or: declined / cancelled / expired
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Remove the fleet-rental pieces from migration 1
-- ---------------------------------------------------------------------
drop function if exists public.nearby_stations(double precision, double precision, int);
drop function if exists public.reserve_vehicle(uuid);
drop function if exists public.start_ride(text);
drop function if exists public.end_ride();
drop table if exists public.rides, public.reservations, public.passes,
  public.pricing, public.vehicles, public.stations cascade;
drop type if exists public.vehicle_status, public.reservation_status, public.ride_status;
-- (public.vehicle_type — scooter / ebike / bike — is kept and reused.)

create extension if not exists btree_gist with schema extensions;  -- for the no-double-booking rule

create type public.booking_status as enum
  ('requested', 'accepted', 'confirmed', 'active', 'completed', 'declined', 'cancelled', 'expired');


-- ---------------------------------------------------------------------
-- 1. Profiles: public to signed-in users (renters need to see owners)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column bio        text check (char_length(bio) <= 500),
  add column avatar_url text;

drop policy if exists "Profiles: read own" on public.profiles;
create policy "Profiles: signed-in users can read" on public.profiles
  for select to authenticated using (true);


-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------

-- Marketplace settings (one row). platform_fee_bps = ZotRider's cut,
-- in basis points: 1000 = 10%. Taken out of the owner's payout.
create table public.app_settings (
  id               int primary key default 1 check (id = 1),
  platform_fee_bps int not null default 0 check (platform_fee_bps between 0 and 3000)
);
insert into public.app_settings (id, platform_fee_bps) values (1, 0);  -- TODO: set your fee

-- Stripe Connect account for each owner. Written ONLY by the payment
-- backend (service role) — users can read their own row, never edit it.
create table public.payout_accounts (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  stripe_account_id text not null unique,
  payouts_enabled   boolean not null default false,
  updated_at        timestamptz not null default now()
);

-- A student's scooter or bike for rent. Owners set hourly and/or daily price.
create table public.listings (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles (id) on delete cascade,
  type               public.vehicle_type not null,
  title              text not null check (char_length(title) between 3 and 80),
  description        text check (char_length(description) <= 2000),
  photo_paths        text[] not null default '{}',   -- paths in the listing-photos bucket
  hourly_price_cents int check (hourly_price_cents between 50 and 10000),     -- $0.50–$100/hr
  daily_price_cents  int check (daily_price_cents  between 100 and 50000),    -- $1–$500/day
  pickup_area        text not null check (char_length(pickup_area) between 2 and 80), -- "Near Middle Earth"
  approx_location    geography(Point, 4326) not null, -- rounded to ~100 m automatically (trigger below)
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint listing_has_a_price check (hourly_price_cents is not null or daily_price_cents is not null)
);

-- Exact meet-up spot. Private: visible to the owner, and to a renter
-- only once their booking is paid.
create table public.listing_pickup_details (
  listing_id     uuid primary key references public.listings (id) on delete cascade,
  exact_location geography(Point, 4326),
  instructions   text check (char_length(instructions) <= 1000)  -- "Bike rack outside Rohan, blue lock"
);

create table public.bookings (
  id                       uuid primary key default gen_random_uuid(),
  listing_id               uuid not null references public.listings (id) on delete restrict,
  renter_id                uuid not null references public.profiles (id) on delete restrict,
  owner_id                 uuid not null references public.profiles (id) on delete restrict,
  start_at                 timestamptz not null,
  end_at                   timestamptz not null,
  status                   public.booking_status not null default 'requested',
  -- Prices are copied in at request time, so later price edits don't change this booking.
  subtotal_cents           int not null check (subtotal_cents > 0),   -- what the renter pays
  platform_fee_cents       int not null default 0 check (platform_fee_cents >= 0), -- ZotRider's cut
  renter_note              text check (char_length(renter_note) <= 500),
  decline_reason           text,
  payment_due_at           timestamptz,
  stripe_payment_intent_id text unique,
  paid_at                  timestamptz,
  picked_up_at             timestamptz,
  returned_at              timestamptz,
  cancelled_by             uuid references public.profiles (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint booking_times_valid check (end_at > start_at),
  constraint not_your_own_listing check (renter_id <> owner_id),
  -- The same scooter can never have two overlapping accepted/paid/active bookings.
  constraint no_double_booking exclude using gist (
    listing_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('accepted', 'confirmed', 'active'))
);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  rating      int  not null check (rating between 1 and 5),
  comment     text check (char_length(comment) <= 1000),
  created_at  timestamptz not null default now(),
  unique (booking_id, reviewer_id)                 -- one review each way per booking
);


-- ---------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------
create index listings_location_idx  on public.listings using gist (approx_location) where is_active;
create index listings_owner_idx     on public.listings (owner_id);
create index bookings_listing_idx   on public.bookings (listing_id, start_at);
create index bookings_renter_idx    on public.bookings (renter_id, start_at desc);
create index bookings_owner_idx     on public.bookings (owner_id, start_at desc);
create index bookings_due_idx       on public.bookings (payment_due_at) where status = 'accepted';
create index messages_booking_idx   on public.messages (booking_id, created_at);
create index reviews_reviewee_idx   on public.reviews (reviewee_id);


-- ---------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------

-- Round the public pin to 3 decimal places (~100 m) so a listing never
-- reveals an owner's exact dorm or apartment.
create or replace function public.round_listing_location()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.approx_location := st_setsrid(st_makepoint(
    round(st_x(new.approx_location::geometry)::numeric, 3)::double precision,
    round(st_y(new.approx_location::geometry)::numeric, 3)::double precision
  ), 4326)::geography;
  return new;
end;
$$;

create trigger listings_round_location
  before insert or update of approx_location on public.listings
  for each row execute function public.round_listing_location();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger listings_touch before update on public.listings
  for each row execute function public.touch_updated_at();
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------
alter table public.app_settings           enable row level security;
alter table public.payout_accounts        enable row level security;
alter table public.listings               enable row level security;
alter table public.listing_pickup_details enable row level security;
alter table public.bookings               enable row level security;
alter table public.messages               enable row level security;
alter table public.reviews                enable row level security;

create policy "Settings: anyone can read" on public.app_settings
  for select to anon, authenticated using (true);

create policy "Payouts: read own" on public.payout_accounts
  for select to authenticated using ((select auth.uid()) = user_id);

-- Listings: everyone sees active ones; owners see and manage their own.
create policy "Listings: read active or own" on public.listings
  for select to anon, authenticated
  using (is_active or owner_id = (select auth.uid()));
create policy "Listings: create own" on public.listings
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Listings: edit own" on public.listings
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Listings: delete own" on public.listings
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Exact pickup spot: owner always; renter only after paying.
create policy "Pickup: owner or paid renter can read" on public.listing_pickup_details
  for select to authenticated using (
    exists (select 1 from public.listings l
             where l.id = listing_id and l.owner_id = (select auth.uid()))
    or exists (select 1 from public.bookings b
                where b.listing_id = listing_pickup_details.listing_id
                  and b.renter_id = (select auth.uid())
                  and b.status in ('confirmed', 'active'))
  );
create policy "Pickup: owner manages" on public.listing_pickup_details
  for all to authenticated
  using (exists (select 1 from public.listings l
                  where l.id = listing_id and l.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.listings l
                       where l.id = listing_id and l.owner_id = (select auth.uid())));

-- Bookings: only the two people involved can see them. All changes go
-- through the functions in section 6.
create policy "Bookings: renter or owner can read" on public.bookings
  for select to authenticated
  using ((select auth.uid()) in (renter_id, owner_id));

-- Messages: only the two people in the booking.
create policy "Messages: participants can read" on public.messages
  for select to authenticated using (
    exists (select 1 from public.bookings b
             where b.id = booking_id and (select auth.uid()) in (b.renter_id, b.owner_id)));
create policy "Messages: participants can send" on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid())
    and exists (select 1 from public.bookings b
                 where b.id = booking_id and (select auth.uid()) in (b.renter_id, b.owner_id)));

-- Reviews: public to signed-in users; only after a completed booking,
-- and only about the other person in it.
create policy "Reviews: signed-in users can read" on public.reviews
  for select to authenticated using (true);
create policy "Reviews: write after completed booking" on public.reviews
  for insert to authenticated with check (
    reviewer_id = (select auth.uid())
    and exists (select 1 from public.bookings b
                 where b.id = booking_id and b.status = 'completed'
                   and ((b.renter_id = reviewer_id and b.owner_id = reviewee_id)
                     or (b.owner_id = reviewer_id and b.renter_id = reviewee_id))));


-- ---------------------------------------------------------------------
-- 6. Functions (call with supabase.rpc('name', { ... }))
-- ---------------------------------------------------------------------

-- Price for a time range, using whichever of hourly/daily the owner offers.
-- With both: full days at the daily rate + leftover hours at the hourly rate,
-- but leftover hours never cost more than one extra day.
create or replace function public.quote_price(
  p_listing_id uuid,
  p_start      timestamptz,
  p_end        timestamptz
)
returns int
language plpgsql
stable
set search_path = public
as $$
declare
  v_l     public.listings;
  v_hours int;
begin
  select * into v_l from public.listings where id = p_listing_id;
  if not found then
    raise exception 'Listing not found';
  end if;
  if p_end <= p_start then
    raise exception 'End time must be after start time';
  end if;

  v_hours := ceil(extract(epoch from (p_end - p_start)) / 3600)::int;

  if v_l.daily_price_cents is null then
    return v_hours * v_l.hourly_price_cents;
  elsif v_l.hourly_price_cents is null then
    return ceil(v_hours / 24.0)::int * v_l.daily_price_cents;
  else
    return (v_hours / 24) * v_l.daily_price_cents
         + least((v_hours % 24) * v_l.hourly_price_cents, v_l.daily_price_cents);
  end if;
end;
$$;


-- Browse listings near a point, optionally filtered by type and free time window.
-- supabase.rpc('search_listings', { user_lat, user_lng, ride_type: 'scooter',
--                                   from_time: '...', to_time: '...' })
create or replace function public.search_listings(
  user_lat  double precision,
  user_lng  double precision,
  radius_m  int default 3000,
  ride_type public.vehicle_type default null,
  from_time timestamptz default null,
  to_time   timestamptz default null
)
returns table (
  listing_id         uuid,
  title              text,
  ride               public.vehicle_type,
  hourly_price_cents int,
  daily_price_cents  int,
  pickup_area        text,
  approx_lat         double precision,
  approx_lng         double precision,
  distance_m         double precision,
  photo_paths        text[],
  owner_username     text,
  owner_rating       numeric,
  owner_review_count bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with me as (
    select st_setsrid(st_makepoint(user_lng, user_lat), 4326)::geography as pt
  )
  select
    l.id, l.title, l.type, l.hourly_price_cents, l.daily_price_cents, l.pickup_area,
    st_y(l.approx_location::geometry), st_x(l.approx_location::geometry),
    st_distance(l.approx_location, me.pt),
    l.photo_paths, p.username, r.avg_rating, coalesce(r.review_count, 0)
  from public.listings l
  join public.profiles p on p.id = l.owner_id
  cross join me
  left join lateral (
    select round(avg(rv.rating), 1) as avg_rating, count(*) as review_count
    from public.reviews rv where rv.reviewee_id = l.owner_id
  ) r on true
  where l.is_active
    and st_dwithin(l.approx_location, me.pt, radius_m)
    and (ride_type is null or l.type = ride_type)
    and (from_time is null or to_time is null or not exists (
          select 1 from public.bookings b
           where b.listing_id = l.id
             and b.status in ('accepted', 'confirmed', 'active')
             and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(from_time, to_time, '[)')))
  order by st_distance(l.approx_location, me.pt);
$$;


-- Renter asks to book. Price is calculated here, never trusted from the browser.
create or replace function public.request_booking(
  p_listing_id uuid,
  p_start      timestamptz,
  p_end        timestamptz,
  p_note       text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_listing  public.listings;
  v_subtotal int;
  v_fee_bps  int;
  v_booking  public.bookings;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_listing from public.listings where id = p_listing_id and is_active;
  if not found then
    raise exception 'Listing not found';
  end if;
  if v_listing.owner_id = v_uid then
    raise exception 'You can''t book your own listing';
  end if;
  if p_start < now() then
    raise exception 'Start time must be in the future';
  end if;
  if p_end - p_start < interval '1 hour' then
    raise exception 'Bookings must be at least 1 hour';
  end if;
  if p_end - p_start > interval '14 days' then
    raise exception 'Bookings can be at most 14 days';
  end if;

  if exists (select 1 from public.bookings
              where listing_id = p_listing_id
                and status in ('accepted', 'confirmed', 'active')
                and tstzrange(start_at, end_at, '[)') && tstzrange(p_start, p_end, '[)')) then
    raise exception 'Those times are already booked';
  end if;
  if exists (select 1 from public.bookings
              where listing_id = p_listing_id and renter_id = v_uid and status = 'requested') then
    raise exception 'You already have a pending request for this listing';
  end if;

  v_subtotal := public.quote_price(p_listing_id, p_start, p_end);
  select platform_fee_bps into v_fee_bps from public.app_settings where id = 1;

  insert into public.bookings
    (listing_id, renter_id, owner_id, start_at, end_at, subtotal_cents, platform_fee_cents, renter_note)
  values
    (p_listing_id, v_uid, v_listing.owner_id, p_start, p_end,
     v_subtotal, (v_subtotal * coalesce(v_fee_bps, 0)) / 10000, p_note)
  returning * into v_booking;

  return v_booking;
end;
$$;


-- Owner approves. Renter then has 2 hours (or until the start time) to pay.
-- Other pending requests for overlapping times are declined automatically.
create or replace function public.accept_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.owner_id is distinct from v_uid then
    raise exception 'Booking not found';
  end if;
  if v_booking.status <> 'requested' then
    raise exception 'This request is no longer pending';
  end if;
  if v_booking.start_at <= now() then
    raise exception 'This request''s start time has already passed';
  end if;
  if not exists (select 1 from public.payout_accounts
                  where user_id = v_uid and payouts_enabled) then
    raise exception 'Set up payouts before accepting bookings';
  end if;

  begin
    update public.bookings
       set status = 'accepted',
           payment_due_at = least(now() + interval '2 hours', start_at)
     where id = p_booking_id
     returning * into v_booking;
  exception when exclusion_violation then
    raise exception 'You already accepted another booking for those times';
  end;

  update public.bookings
     set status = 'declined', decline_reason = 'Another request was accepted for these times'
   where listing_id = v_booking.listing_id
     and status = 'requested'
     and id <> v_booking.id
     and tstzrange(start_at, end_at, '[)') && tstzrange(v_booking.start_at, v_booking.end_at, '[)');

  return v_booking;
end;
$$;


create or replace function public.decline_booking(p_booking_id uuid, p_reason text default null)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  update public.bookings
     set status = 'declined', decline_reason = left(p_reason, 300)
   where id = p_booking_id and owner_id = auth.uid() and status = 'requested'
   returning * into v_booking;
  if not found then
    raise exception 'No pending request to decline';
  end if;
  return v_booking;
end;
$$;


-- Either person can cancel before pickup. If it was already paid
-- (status was 'confirmed'), the payment backend must issue the refund.
create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_booking public.bookings;
begin
  update public.bookings
     set status = 'cancelled', cancelled_by = v_uid
   where id = p_booking_id
     and v_uid in (renter_id, owner_id)
     and status in ('requested', 'accepted', 'confirmed')
   returning * into v_booking;
  if not found then
    raise exception 'This booking can''t be cancelled';
  end if;
  return v_booking;
end;
$$;


-- Called ONLY by the payment backend (Stripe webhook, service role) once
-- the renter's payment succeeds.
create or replace function public.mark_booking_paid(p_booking_id uuid, p_payment_intent_id text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  update public.bookings
     set status = 'confirmed', paid_at = now(), stripe_payment_intent_id = p_payment_intent_id
   where id = p_booking_id and status = 'accepted'
   returning * into v_booking;
  if not found then
    raise exception 'Booking is not awaiting payment';  -- webhook should refund in this case
  end if;
  return v_booking;
end;
$$;


-- Owner confirms they handed it over (from 30 min before the start time).
create or replace function public.confirm_pickup(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  update public.bookings
     set status = 'active', picked_up_at = now()
   where id = p_booking_id
     and owner_id = auth.uid()
     and status = 'confirmed'
     and now() >= start_at - interval '30 minutes'
   returning * into v_booking;
  if not found then
    raise exception 'Pickup can only be confirmed by the owner, for a paid booking, from 30 minutes before the start';
  end if;
  return v_booking;
end;
$$;


-- Owner confirms they got it back. Unlocks reviews for both sides.
create or replace function public.confirm_return(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  update public.bookings
     set status = 'completed', returned_at = now()
   where id = p_booking_id and owner_id = auth.uid() and status = 'active'
   returning * into v_booking;
  if not found then
    raise exception 'Return can only be confirmed by the owner for an active booking';
  end if;
  return v_booking;
end;
$$;


-- Housekeeping: unpaid acceptances past their deadline, and requests whose
-- start time has passed, become 'expired'. Run every few minutes (section 8).
create or replace function public.expire_stale_bookings()
returns int
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.bookings
       set status = 'expired'
     where (status = 'accepted'  and payment_due_at < now())
        or (status = 'requested' and start_at < now())
    returning 1
  )
  select count(*)::int from expired;
$$;


-- Permissions: renters/owners call these; payment + housekeeping are backend-only.
revoke execute on function public.request_booking(uuid, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.accept_booking(uuid)        from public, anon;
revoke execute on function public.decline_booking(uuid, text) from public, anon;
revoke execute on function public.cancel_booking(uuid)        from public, anon;
revoke execute on function public.confirm_pickup(uuid)        from public, anon;
revoke execute on function public.confirm_return(uuid)        from public, anon;
grant  execute on function public.request_booking(uuid, timestamptz, timestamptz, text) to authenticated;
grant  execute on function public.accept_booking(uuid)        to authenticated;
grant  execute on function public.decline_booking(uuid, text) to authenticated;
grant  execute on function public.cancel_booking(uuid)        to authenticated;
grant  execute on function public.confirm_pickup(uuid)        to authenticated;
grant  execute on function public.confirm_return(uuid)        to authenticated;

revoke execute on function public.mark_booking_paid(uuid, text) from public, anon, authenticated;
revoke execute on function public.expire_stale_bookings()       from public, anon, authenticated;
grant  execute on function public.mark_booking_paid(uuid, text) to service_role;
grant  execute on function public.expire_stale_bookings()       to service_role;

grant execute on function public.quote_price(uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.search_listings(double precision, double precision, int,
  public.vehicle_type, timestamptz, timestamptz) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Listing photos (Supabase Storage)
--    Upload to: listing-photos/<your user id>/<file name>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

create policy "Listing photos: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listing-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Listing photos: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'listing-photos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);


-- ---------------------------------------------------------------------
-- 8. Live updates + scheduled housekeeping
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.messages, public.bookings;

-- Turn on pg_cron in Dashboard → Database → Extensions, then run once:
--   select cron.schedule('expire-stale-bookings', '*/5 * * * *',
--                        'select public.expire_stale_bookings()');
