-- Paid (confirmed) bookings can't be cancelled in the app: the Zelle
-- payment already went to the owner, so they arrange any refund in chat.
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
     and status in ('requested', 'accepted')
   returning * into v_booking;
  if not found then
    raise exception 'This booking can''t be cancelled. Paid bookings can''t be cancelled in the app; message each other to arrange a refund.';
  end if;
  return v_booking;
end;
$$;