CREATE OR REPLACE FUNCTION delete_callback_request(
  p_restaurant uuid,
  p_callback uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH deleted AS (
    DELETE FROM callback_requests
    WHERE restaurant_id = p_restaurant
      AND id = p_callback
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM deleted)
$$;
