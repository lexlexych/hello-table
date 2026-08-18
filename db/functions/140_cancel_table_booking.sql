-- Снятие дневной брони столика из портала. DELETE не используется намеренно: права на
-- удаление reservations нет ни у одной роли, персональные данные убирает только
-- purge_expired_personal_data() по delete_after.
CREATE OR REPLACE FUNCTION cancel_table_booking(
  p_restaurant uuid,
  p_table      uuid,
  p_date       date
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tz    text;
  v_count int;
BEGIN
  SELECT r.timezone INTO v_tz FROM restaurants r WHERE r.id = p_restaurant AND r.is_active;
  IF v_tz IS NULL THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  -- День брони считается по местной дате НАЧАЛА: бронь тянется до полуночи, и по концу
  -- диапазона она формально принадлежала бы уже следующему дню.
  UPDATE reservations res SET status = 'cancelled'
  WHERE res.restaurant_id = p_restaurant
    AND res.table_id = p_table
    AND res.status IN ('confirmed','seated')
    AND (res.starts_at AT TIME ZONE v_tz)::date = p_date;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
