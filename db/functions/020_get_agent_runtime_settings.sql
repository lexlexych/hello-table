-- Минимальная конфигурация ресторана, доступная голосовому процессу до создания сессии.
CREATE OR REPLACE FUNCTION get_agent_runtime_settings(
  p_restaurant uuid
) RETURNS TABLE (
  voice_mode text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  SELECT r.voice_mode
  FROM restaurants r
  WHERE r.id = p_restaurant
    AND r.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000';
  END IF;
END $$;
