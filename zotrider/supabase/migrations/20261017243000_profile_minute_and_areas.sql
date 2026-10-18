-- Prices are now per minute (cents). Also save the public pickup/return area.
alter table public.profile_details
  add column if not exists default_minute_cents int  check (default_minute_cents between 1 and 200),
  add column if not exists default_pickup_area  text check (char_length(default_pickup_area) <= 80),
  add column if not exists default_return_area  text check (char_length(default_return_area) <= 80);

alter table public.profile_details drop column if exists default_hourly_cents;