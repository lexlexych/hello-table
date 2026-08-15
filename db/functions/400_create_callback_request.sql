CREATE OR REPLACE FUNCTION create_callback_request(
  p_restaurant uuid, p_phone text, p_language char(2), p_summary text, p_category text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM restaurants WHERE id = p_restaurant AND is_active) THEN
    RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000';
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('banquet','complaint','special','other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '45013';
  END IF;
  IF length(coalesce(p_summary, '')) > 400 THEN            -- §6.2
    RAISE EXCEPTION 'summary_too_long' USING ERRCODE = '45014';
  END IF;

  INSERT INTO callback_requests (restaurant_id, caller_phone, language, summary, category)
  VALUES (p_restaurant, p_phone, p_language, btrim(p_summary), p_category)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
