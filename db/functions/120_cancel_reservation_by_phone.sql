CREATE OR REPLACE FUNCTION cancel_reservation_by_phone(
  p_restaurant uuid, p_phone text, p_date date
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text; v_count int;
BEGIN
  SELECT r.timezone INTO v_tz FROM restaurants r WHERE r.id = p_restaurant AND r.is_active;
  IF v_tz IS NULL THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;
  IF app_normalize_phone(p_phone) IS NULL THEN
    RAISE EXCEPTION 'phone_required' USING ERRCODE = '45012';
  END IF;

  UPDATE reservations res
     SET status = 'cancelled'
   WHERE res.restaurant_id = p_restaurant
     AND res.status = 'confirmed'
     AND app_normalize_phone(res.guest_phone) = app_normalize_phone(p_phone)
     AND (res.starts_at AT TIME ZONE v_tz)::date = p_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
