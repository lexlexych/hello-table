CREATE OR REPLACE FUNCTION create_telegram_callback_request(
  p_restaurant uuid, p_telegram_user_id text, p_language char(2), p_summary text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM restaurants WHERE id = p_restaurant AND is_active) THEN
    RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000';
  END IF;
  IF p_telegram_user_id IS NULL OR btrim(p_telegram_user_id) = '' THEN
    RAISE EXCEPTION 'telegram_user_id_required' USING ERRCODE = '45017';
  END IF;
  IF length(coalesce(p_summary, '')) > 400 THEN
    RAISE EXCEPTION 'summary_too_long' USING ERRCODE = '45014';
  END IF;

  INSERT INTO callback_requests (
    restaurant_id, source, caller_phone, telegram_user_id, language, summary, category
  )
  VALUES (
    p_restaurant, 'telegram', NULL, btrim(p_telegram_user_id),
    p_language, btrim(p_summary), 'other'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
