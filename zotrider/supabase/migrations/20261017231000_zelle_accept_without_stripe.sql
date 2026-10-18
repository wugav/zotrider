-- We use Zelle (renter pays the owner directly), so owners don't need a
-- Stripe payout account to approve a request. Same as before otherwise.
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