-- =====================================================================
-- ZotRider — Supabase database setup
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.
--
-- Passwords are NOT stored here. Supabase Auth (auth.users) handles
-- sign-up, login and password hashing. This file adds a public
-- "profiles" table linked to each auth user for usernames etc.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Extensions & types
-- ---------------------------------------------------------------------
create extension if not exists postgis with schema extensions;   -- GPS points + distance math

create type public.vehicle_type       as enum ('scooter', 'ebike', 'bike');
create type public.vehicle_status     as enum ('available', 'in_use', 'charging', 'maintenance', 'offline');
create type public.reservation_status as enum ('active', 'used', 'cancelled');
create type public.ride_status        as enum ('active', 'completed');


-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------

-- One row per signed-up user (id = auth.users.id). No password here.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  display_name text,
  created_at   timestamptz not null default now()
);

-- Docking stations around campus.
create table public.stations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  location   geography(Point, 4326) not null,          -- (longitude, latitude)
  capacity   int  not null default 10 check (capacity > 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every scooter / bike. "code" is what the QR sticker on the handlebar encodes.
-- location + battery are written by the vehicle's own GPS/telemetry (service role).
create table public.vehicles (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                    -- e.g. 'S-104'
  type         public.vehicle_type   not null,
  status       public.vehicle_status not null default 'available',
  battery_pct  int check (battery_pct between 0 and 100), -- null for classic bikes
  station_id   uuid references public.stations (id) on delete set null,  -- null while riding
  location     geography(Point, 4326),
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Prices per ride type (fill in your real numbers).
create table public.pricing (
  type             public.vehicle_type primary key,
  unlock_cents     int not null default 0 check (unlock_cents >= 0),
  per_minute_cents int not null default 0 check (per_minute_cents >= 0)
);

-- 10-minute holds from the "Reserve" button. A hold is live while
-- status = 'active' AND expires_at > now(), so no cleanup job is needed.
create table public.reservations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  status     public.reservation_status not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Rides. Stores start/end STATION, not a GPS trail of the rider.
create table public.rides (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  vehicle_id       uuid not null references public.vehicles (id),
  start_station_id uuid references public.stations (id),
  end_station_id   uuid references public.stations (id),
  status           public.ride_status not null default 'active',
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_minutes int,
  cost_cents       int
);

-- Quarter Pass purchases.
create table public.passes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  starts_on  date not null,
  ends_on    date not null check (ends_on >= starts_on),
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. Indexes & integrity rules
-- ---------------------------------------------------------------------
create index stations_location_idx      on public.stations using gist (location);
create index vehicles_location_idx      on public.vehicles using gist (location);
create index vehicles_station_status_idx on public.vehicles (station_id, status);
create index reservations_vehicle_idx   on public.reservations (vehicle_id) where status = 'active';
create index rides_user_idx             on public.rides (user_id, started_at desc);
create index passes_user_idx            on public.passes (user_id, ends_on);

-- One active ride per user, and one rider per vehicle.
create unique index one_active_ride_per_user    on public.rides (user_id)    where status = 'active';
create unique index one_active_ride_per_vehicle on public.rides (vehicle_id) where status = 'active';


-- ---------------------------------------------------------------------
-- 4. Auto-create a profile on sign-up (UCI emails only)
--    Sign up from the app with:
--    supabase.auth.signUp({ email, password, options: { data: { username } } })
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or lower(new.email) not like '%@uci.edu' then
    raise exception 'ZotRider accounts require a @uci.edu email';
  end if;

  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      left(regexp_replace(split_part(new.email, '@', 1), '[^A-Za-z0-9_]', '_', 'g'), 24)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 5. Row Level Security — who can see / change what
--    Riders can only READ their own data. All writes to rides,
--    reservations and vehicles go through the functions in section 6.
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.stations     enable row level security;
alter table public.vehicles     enable row level security;
alter table public.pricing      enable row level security;
alter table public.reservations enable row level security;
alter table public.rides        enable row level security;
alter table public.passes       enable row level security;

create policy "Profiles: read own"   on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Profiles: update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Stations: anyone can read" on public.stations for select to anon, authenticated
  using (true);
create policy "Pricing: anyone can read"  on public.pricing  for select to anon, authenticated
  using (true);

-- Hide vehicles that are mid-ride so nobody can track a rider live.
create policy "Vehicles: read parked ones" on public.vehicles for select to anon, authenticated
  using (status <> 'in_use');

create policy "Reservations: read own" on public.reservations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Rides: read own"        on public.rides        for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Passes: read own"       on public.passes       for select to authenticated
  using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------------------
-- 6. App functions (call with supabase.rpc('name', { ... }))
-- ---------------------------------------------------------------------

-- Stations near the user, nearest first, with live counts of rideable vehicles.
-- supabase.rpc('nearby_stations', { user_lat: 33.6461, user_lng: -117.8427 })
create or replace function public.nearby_stations(
  user_lat double precision,
  user_lng double precision,
  radius_m int default 2000
)
returns table (
  station_id  uuid,
  name        text,
  station_lat double precision,
  station_lng double precision,
  distance_m  double precision,
  scooters    bigint,
  ebikes      bigint,
  bikes       bigint
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
    s.id,
    s.name,
    st_y(s.location::geometry),
    st_x(s.location::geometry),
    st_distance(s.location, me.pt),
    count(v.id) filter (where v.type = 'scooter'),
    count(v.id) filter (where v.type = 'ebike'),
    count(v.id) filter (where v.type = 'bike')
  from public.stations s
  cross join me
  left join public.vehicles v
    on v.station_id = s.id
   and v.status = 'available'
   and not exists (
         select 1 from public.reservations r
         where r.vehicle_id = v.id and r.status = 'active' and r.expires_at > now()
       )
  where s.is_active
    and st_dwithin(s.location, me.pt, radius_m)
  group by s.id, me.pt
  order by st_distance(s.location, me.pt);
$$;


-- Hold a vehicle for 10 minutes ("Reserve" button).
create or replace function public.reserve_vehicle(p_vehicle_id uuid)
returns public.reservations
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_res public.reservations;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  perform 1 from public.vehicles
   where id = p_vehicle_id and status = 'available'
   for update;                                   -- lock so two people can't grab it at once
  if not found then
    raise exception 'That vehicle is not available';
  end if;

  if exists (select 1 from public.reservations
              where vehicle_id = p_vehicle_id and status = 'active'
                and expires_at > now() and user_id <> v_uid) then
    raise exception 'Someone else already reserved that vehicle';
  end if;

  if exists (select 1 from public.rides where user_id = v_uid and status = 'active') then
    raise exception 'You already have a ride in progress';
  end if;

  -- One hold at a time: replace any previous hold.
  update public.reservations set status = 'cancelled'
   where user_id = v_uid and status = 'active';

  insert into public.reservations (user_id, vehicle_id, expires_at)
  values (v_uid, p_vehicle_id, now() + interval '10 minutes')
  returning * into v_res;

  return v_res;
end;
$$;


-- Unlock after scanning the QR code ("Scan to unlock").
create or replace function public.start_ride(p_vehicle_code text)
returns public.rides
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_vehicle public.vehicles;
  v_ride    public.rides;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_vehicle from public.vehicles
   where code = p_vehicle_code
   for update;
  if not found then
    raise exception 'Unknown vehicle code';
  end if;
  if v_vehicle.status <> 'available' then
    raise exception 'That vehicle is not available';
  end if;

  if exists (select 1 from public.reservations
              where vehicle_id = v_vehicle.id and status = 'active'
                and expires_at > now() and user_id <> v_uid) then
    raise exception 'That vehicle is reserved by someone else';
  end if;

  if exists (select 1 from public.rides where user_id = v_uid and status = 'active') then
    raise exception 'You already have a ride in progress';
  end if;

  update public.reservations set status = 'used'
   where user_id = v_uid and vehicle_id = v_vehicle.id and status = 'active';

  update public.vehicles set status = 'in_use', station_id = null
   where id = v_vehicle.id;

  insert into public.rides (user_id, vehicle_id, start_station_id)
  values (v_uid, v_vehicle.id, v_vehicle.station_id)
  returning * into v_ride;

  return v_ride;
end;
$$;


-- End the ride ("End ride & lock"). Uses the VEHICLE's GPS (harder to fake
-- than the phone's) and requires it to be within 30 m of an active station.
create or replace function public.end_ride()
returns public.rides
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_ride     public.rides;
  v_vehicle  public.vehicles;
  v_station  uuid;
  v_minutes  int;
  v_price    public.pricing;
  v_has_pass boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_ride from public.rides
   where user_id = v_uid and status = 'active'
   for update;
  if not found then
    raise exception 'No ride in progress';
  end if;

  select * into v_vehicle from public.vehicles where id = v_ride.vehicle_id for update;

  select s.id into v_station
    from public.stations s
   where s.is_active
     and v_vehicle.location is not null
     and st_dwithin(s.location, v_vehicle.location, 30)
   order by st_distance(s.location, v_vehicle.location)
   limit 1;
  if v_station is null then
    raise exception 'Park within 30 m of a ZotRider station to end your ride';
  end if;

  v_minutes := greatest(1, ceil(extract(epoch from (now() - v_ride.started_at)) / 60)::int);

  select * into v_price from public.pricing where type = v_vehicle.type;
  select exists (select 1 from public.passes
                  where user_id = v_uid and current_date between starts_on and ends_on)
    into v_has_pass;

  update public.rides
     set status           = 'completed',
         ended_at         = now(),
         end_station_id   = v_station,
         duration_minutes = v_minutes,
         cost_cents       = case when v_has_pass then 0
                                 else coalesce(v_price.unlock_cents, 0)
                                    + v_minutes * coalesce(v_price.per_minute_cents, 0)
                            end
   where id = v_ride.id
   returning * into v_ride;

  update public.vehicles
     set status = 'available', station_id = v_station
   where id = v_vehicle.id;

  return v_ride;
end;
$$;

-- Only signed-in users may call the ride functions; anyone may look up stations.
revoke execute on function public.reserve_vehicle(uuid) from public, anon;
revoke execute on function public.start_ride(text)      from public, anon;
revoke execute on function public.end_ride()            from public, anon;
grant  execute on function public.reserve_vehicle(uuid) to authenticated;
grant  execute on function public.start_ride(text)      to authenticated;
grant  execute on function public.end_ride()            to authenticated;
grant  execute on function public.nearby_stations(double precision, double precision, int) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Live map updates (Supabase Realtime) — still filtered by RLS above
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.vehicles;


-- ---------------------------------------------------------------------
-- 8. Starter data — replace with your real stations, fleet and prices
-- ---------------------------------------------------------------------
insert into public.pricing (type, unlock_cents, per_minute_cents) values
  ('scooter', 0, 0),     -- TODO: set real prices (cents)
  ('ebike',   0, 0),
  ('bike',    0, 0);

-- Example only — note st_makepoint takes (LONGITUDE, LATITUDE).
-- insert into public.stations (name, location, capacity) values
--   ('Example Station A', st_setsrid(st_makepoint(-117.8427, 33.6461), 4326)::geography, 12);
--
-- insert into public.vehicles (code, type, battery_pct, station_id, location)
-- select 'S-101', 'scooter', 95, id, location from public.stations where name = 'Example Station A';