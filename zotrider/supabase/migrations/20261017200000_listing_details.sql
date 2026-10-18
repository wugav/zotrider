-- =====================================================================
-- ZotRider — Migration 3: listing details for the website
-- =====================================================================

alter table public.listings
  add column model           text check (char_length(model) <= 80),
  add column range_miles     int  check (range_miles between 1 and 200),
  add column top_speed_mph   int  check (top_speed_mph between 1 and 60),
  add column return_note     text check (char_length(return_note) <= 200),
  add column available_from  date,
  add column available_until date,
  add column daily_start     time,
  add column daily_end       time,
  add constraint availability_dates_valid
    check (available_from is null or available_until is null or available_until >= available_from),
  add constraint availability_hours_valid
    check (daily_start is null or daily_end is null or daily_end > daily_start);

create or replace function public.browse_listings()
returns table (
  id uuid, owner_id uuid, owner_username text, type public.vehicle_type, title text, model text,
  description text, photo_paths text[], hourly_price_cents int, daily_price_cents int, pickup_area text,
  lat double precision, lng double precision, return_note text, range_miles int, top_speed_mph int,
  available_from date, available_until date, daily_start time, daily_end time, is_active boolean,
  created_at timestamptz, owner_rating numeric, owner_review_count bigint
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select
    l.id, l.owner_id, p.username, l.type, l.title, l.model, l.description, l.photo_paths,
    l.hourly_price_cents, l.daily_price_cents, l.pickup_area,
    st_y(l.approx_location::geometry), st_x(l.approx_location::geometry),
    l.return_note, l.range_miles, l.top_speed_mph,
    l.available_from, l.available_until, l.daily_start, l.daily_end,
    l.is_active, l.created_at, r.avg_rating, coalesce(r.review_count, 0)
  from public.listings l
  join public.profiles p on p.id = l.owner_id
  left join lateral (
    select round(avg(rv.rating), 1) as avg_rating, count(*) as review_count
    from public.reviews rv where rv.reviewee_id = l.owner_id
  ) r on true
  where l.is_active or l.owner_id = (select auth.uid())
  order by l.created_at desc;
$$;
revoke execute on function public.browse_listings() from public, anon;
grant  execute on function public.browse_listings() to authenticated;

create or replace function public.listing_busy_times(p_listing_id uuid)
returns table (start_at timestamptz, end_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select b.start_at, b.end_at from public.bookings b
  where b.listing_id = p_listing_id
    and b.status in ('accepted', 'confirmed', 'active')
    and b.end_at > now()
  order by b.start_at;
$$;
revoke execute on function public.listing_busy_times(uuid) from public, anon;
grant  execute on function public.listing_busy_times(uuid) to authenticated;

create or replace function public.request_booking(
  p_listing_id uuid, p_start timestamptz, p_end timestamptz, p_note text default null
)
returns public.bookings
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid(); v_listing public.listings; v_subtotal int; v_fee_bps int;
  v_booking public.bookings; v_tz constant text := 'America/Los_Angeles';
  v_start_l timestamp; v_end_l timestamp;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into v_listing from public.listings where id = p_listing_id and is_active;
  if not found then raise exception 'Listing not found'; end if;
  if v_listing.owner_id = v_uid then raise exception 'You can''t book your own listing'; end if;
  if p_start < now() then raise exception 'Start time must be in the future'; end if;
  if p_end - p_start < interval '1 hour' then raise exception 'Bookings must be at least 1 hour'; end if;
  if p_end - p_start > interval '14 days' then raise exception 'Bookings can be at most 14 days'; end if;

  v_start_l := p_start at time zone v_tz;
  v_end_l   := p_end   at time zone v_tz;
  if v_listing.available_from is not null and v_start_l::date < v_listing.available_from then
    raise exception 'This ride is available from %', to_char(v_listing.available_from, 'Mon DD');
  end if;
  if v_listing.available_until is not null and (v_end_l - interval '1 second')::date > v_listing.available_until then
    raise exception 'This ride is only available until %', to_char(v_listing.available_until, 'Mon DD');
  end if;
  if v_listing.daily_start is not null and v_listing.daily_end is not null
     and v_start_l::date = (v_end_l - interval '1 second')::date
     and (v_start_l::time < v_listing.daily_start or v_end_l::time > v_listing.daily_end) then
    raise exception 'Pick a time between % and %',
      to_char(v_listing.daily_start, 'FMHH12:MI AM'), to_char(v_listing.daily_end, 'FMHH12:MI AM');
  end if;

  if exists (select 1 from public.bookings where listing_id = p_listing_id
              and status in ('accepted', 'confirmed', 'active')
              and tstzrange(start_at, end_at, '[)') && tstzrange(p_start, p_end, '[)')) then
    raise exception 'Those times are already booked';
  end if;
  if exists (select 1 from public.bookings
              where listing_id = p_listing_id and renter_id = v_uid and status = 'requested') then
    raise exception 'You already have a pending request for this ride';
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

alter publication supabase_realtime add table public.listings;