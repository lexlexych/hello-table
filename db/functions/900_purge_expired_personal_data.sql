CREATE OR REPLACE FUNCTION purge_expired_personal_data()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_total int := 0; v_n int;
BEGIN
  DELETE FROM reservations      WHERE delete_after IS NOT NULL AND delete_after < current_date;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  DELETE FROM pickup_orders     WHERE delete_after IS NOT NULL AND delete_after < current_date;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  DELETE FROM callback_requests WHERE delete_after IS NOT NULL AND delete_after < current_date;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  RETURN v_total;
END $$;
