-- More "My ride" defaults for the profile (pre-fill the listing form).
-- Daily start/end are minutes since midnight, same as the listing form.
alter table public.profile_details
  add column if not exists default_type          text check (default_type in ('scooter', 'ebike', 'bike')),
  add column if not exists default_title         text check (char_length(default_title) between 3 and 80),
  add column if not exists default_model         text check (char_length(default_model) <= 80),
  add column if not exists default_range_miles   int  check (default_range_miles between 1 and 200),
  add column if not exists default_top_speed_mph int  check (default_top_speed_mph between 1 and 40),
  add column if not exists default_description   text check (char_length(default_description) <= 2000),
  add column if not exists default_daily_start   int  check (default_daily_start between 0 and 1439),
  add column if not exists default_daily_end     int  check (default_daily_end between 1 and 1440);