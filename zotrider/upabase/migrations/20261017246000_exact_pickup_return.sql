-- Public return area on the listing; exact pickup/return addresses stay private
-- (listing_pickup_details is only readable by the renter after payment).
alter table public.listings
  add column if not exists return_area text;

alter table public.listing_pickup_details
  add column if not exists pickup_address text check (char_length(pickup_address) <= 200),
  add column if not exists return_address text check (char_length(return_address) <= 200);