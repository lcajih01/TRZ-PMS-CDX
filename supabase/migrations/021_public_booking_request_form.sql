create or replace function public.submit_public_booking_request(
  input_arrival_date date,
  input_departure_date date,
  input_package_id uuid,
  input_pax integer,
  input_full_name text,
  input_mobile_number text,
  input_email text,
  input_city_municipality text default null,
  input_occasion text default null,
  input_special_requests text default null,
  input_agree_house_rules boolean default false,
  input_agree_not_guaranteed boolean default false,
  input_agree_payment_verification boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_guest public.guests%rowtype;
  target_version public.package_versions%rowtype;
  target_package_name text;
  start_at_value timestamptz;
  end_at_value timestamptz;
  nights integer;
  computed_base_price numeric(12,2);
  booking_notes text;
  created_booking public.bookings%rowtype;
begin
  if nullif(trim(coalesce(input_full_name, '')), '') is null then
    raise exception 'Full name is required.';
  end if;

  if nullif(trim(coalesce(input_mobile_number, '')), '') is null then
    raise exception 'Mobile number is required.';
  end if;

  if nullif(trim(coalesce(input_email, '')), '') is null then
    raise exception 'Email address is required.';
  end if;

  if trim(input_email) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  if input_arrival_date is null then
    raise exception 'Arrival date is required.';
  end if;

  if input_departure_date is null then
    raise exception 'Departure date is required.';
  end if;

  if coalesce(input_pax, 0) <= 0 then
    raise exception 'Pax must be greater than zero.';
  end if;

  if not input_agree_house_rules
     or not input_agree_not_guaranteed
     or not input_agree_payment_verification then
    raise exception 'All required agreements must be accepted.';
  end if;

  select pv.*
  into target_version
  from public.package_versions pv
  join public.packages p on p.id = pv.package_id
  where p.id = input_package_id
    and p.is_active = true
  order by pv.version_number desc
  limit 1;

  if not found then
    raise exception 'Selected package is not available.';
  end if;

  select name
  into target_package_name
  from public.packages
  where id = target_version.package_id;

  if target_version.is_overnight then
    if input_departure_date <= input_arrival_date then
      raise exception 'Departure date must be after arrival date for overnight packages.';
    end if;

    nights := greatest(input_departure_date - input_arrival_date, 1);
    start_at_value := (input_arrival_date::timestamp + time '15:00') at time zone 'Asia/Manila';
    end_at_value := (input_departure_date::timestamp + time '12:00') at time zone 'Asia/Manila';
    computed_base_price := target_version.price * nights;
  else
    if input_departure_date <> input_arrival_date then
      raise exception 'For Day Use, departure date must match arrival date.';
    end if;

    start_at_value := (input_arrival_date::timestamp + time '15:00') at time zone 'Asia/Manila';
    end_at_value := (input_arrival_date::timestamp + time '23:00') at time zone 'Asia/Manila';
    computed_base_price := target_version.price;
  end if;

  select *
  into target_guest
  from public.guests
  where lower(coalesce(email, '')) = lower(trim(input_email))
     or phone = trim(input_mobile_number)
  order by
    case when lower(coalesce(email, '')) = lower(trim(input_email)) then 0 else 1 end,
    created_at asc
  limit 1;

  if not found then
    insert into public.guests(full_name, phone, email, notes)
    values (
      trim(input_full_name),
      trim(input_mobile_number),
      trim(input_email),
      nullif(trim(coalesce('City / Municipality: ' || nullif(trim(coalesce(input_city_municipality, '')), ''), '')), '')
    )
    returning * into target_guest;
  else
    update public.guests
    set
      full_name = case when nullif(trim(full_name), '') is null then trim(input_full_name) else full_name end,
      phone = case when nullif(trim(phone), '') is null then trim(input_mobile_number) else phone end,
      email = case when nullif(trim(coalesce(email, '')), '') is null then trim(input_email) else email end
    where id = target_guest.id
    returning * into target_guest;
  end if;

  booking_notes := concat_ws(E'\n',
    'Source: Public Booking Request Form',
    nullif('City / Municipality: ' || nullif(trim(coalesce(input_city_municipality, '')), ''), 'City / Municipality: '),
    nullif('Occasion: ' || nullif(trim(coalesce(input_occasion, '')), ''), 'Occasion: '),
    nullif('Special Requests: ' || nullif(trim(coalesce(input_special_requests, '')), ''), 'Special Requests: '),
    'Agreements accepted: House Rules, request not guaranteed, confirmation after payment verification'
  );

  insert into public.bookings(
    guest_id,
    package_version_id,
    status,
    start_at,
    end_at,
    pax_count,
    base_price,
    security_deposit_amount,
    notes
  )
  values (
    target_guest.id,
    target_version.id,
    'Deposit Requested',
    start_at_value,
    end_at_value,
    input_pax,
    computed_base_price,
    5000,
    booking_notes
  )
  returning * into created_booking;

  if to_regclass('public.automation_queue') is not null then
    delete from public.automation_queue
    where booking_id = created_booking.id;
  end if;

  insert into public.audit_logs(entity_type, entity_id, action, after_data, reason)
  values (
    'booking',
    created_booking.id,
    'public_booking_request',
    jsonb_build_object(
      'booking_id', created_booking.id,
      'booking_code', created_booking.booking_code,
      'guest_id', target_guest.id,
      'status', created_booking.status,
      'package', target_package_name,
      'pax', created_booking.pax_count
    ),
    'Public booking request submitted'
  );

  return jsonb_build_object(
    'booking_id', created_booking.id,
    'booking_code', created_booking.booking_code,
    'status', created_booking.status,
    'guest_id', target_guest.id
  );
end;
$$;

grant execute on function public.submit_public_booking_request(
  date,
  date,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  boolean
) to anon;

notify pgrst, 'reload schema';
