create or replace function public.confirm_payment(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings
     set status = 'confirmed'
   where id = p_booking_id
     and owner_id = auth.uid()
     and status = 'accepted';
  if not found then
    raise exception 'Only the owner can confirm payment for an approved booking.';
  end if;
end;
$$;

grant execute on function public.confirm_payment(uuid) to authenticated;