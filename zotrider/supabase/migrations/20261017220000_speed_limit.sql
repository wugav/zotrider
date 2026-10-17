-- Listings can't advertise a top speed above 40 mph (scooters, e-bikes and bikes)
update public.listings set top_speed_mph = 40 where top_speed_mph > 40;
alter table public.listings drop constraint if exists listings_top_speed_mph_check;
alter table public.listings add constraint listings_top_speed_mph_check
  check (top_speed_mph between 1 and 40);
