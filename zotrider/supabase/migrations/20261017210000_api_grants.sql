-- Let signed-in users reach the marketplace tables.
-- Row-level security still decides which rows each person can see or change.
grant usage on schema public to anon, authenticated;

grant select                         on public.profiles               to authenticated;
grant update (username, display_name, bio, avatar_url)
                                     on public.profiles               to authenticated;
grant select, insert, update, delete on public.listings               to authenticated;
grant select, insert, update, delete on public.listing_pickup_details to authenticated;
grant select                         on public.bookings               to authenticated;
grant select, insert                 on public.messages               to authenticated;
grant select, insert                 on public.reviews                to authenticated;
grant select                         on public.payout_accounts        to authenticated;
grant select                         on public.app_settings           to anon, authenticated;
