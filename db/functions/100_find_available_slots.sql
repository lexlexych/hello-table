CREATE OR REPLACE FUNCTION find_available_slots(
  p_restaurant     uuid,
  p_date           date,
  p_party_size     int,
  p_preferred_time time DEFAULT NULL,
  p_limit          int  DEFAULT 10
) RETURNS TABLE (slot_time timestamptz, slot_table_id uuid, slot_table_label text, slot_seats int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r restaurants%ROWTYPE;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;
  -- слишком большая компания — не ошибка поиска, просто нет слотов
  IF p_party_size < 1 OR p_party_size > r.max_party_size THEN RETURN; END IF;

  RETURN QUERY
  WITH raw_slots AS (
    SELECT DISTINCT gs AS s_time
    FROM opening_windows(p_restaurant, p_date) w,
         LATERAL generate_series(lower(w.win),
                                 upper(w.win) - make_interval(mins => r.slot_minutes),
                                 make_interval(mins => r.booking_step_minutes)) AS gs
  ),
  candidates AS (
    SELECT rs.s_time, t.id AS t_id, t.label AS t_label, t.seats AS t_seats,
           row_number() OVER (PARTITION BY rs.s_time ORDER BY t.seats, t.label) AS rn
    FROM raw_slots rs
    JOIN restaurant_tables t
      ON t.restaurant_id = p_restaurant AND t.is_active AND t.seats >= p_party_size
    WHERE rs.s_time > now()
      AND NOT EXISTS (
        SELECT 1 FROM reservations res
        WHERE res.table_id = t.id
          AND res.status IN ('confirmed','seated')
          AND tstzrange(res.starts_at - make_interval(mins => r.buffer_minutes),
                        res.ends_at   + make_interval(mins => r.buffer_minutes))
              && tstzrange(rs.s_time, rs.s_time + make_interval(mins => r.slot_minutes))
      )
  )
  SELECT c.s_time, c.t_id, c.t_label, c.t_seats
  FROM candidates c
  WHERE c.rn = 1                       -- на каждое время — самый маленький подходящий столик
  ORDER BY CASE WHEN p_preferred_time IS NULL THEN 0
                ELSE abs(extract(epoch FROM
                     (c.s_time - ((p_date + p_preferred_time) AT TIME ZONE r.timezone))))
           END,
           c.s_time
  LIMIT greatest(coalesce(p_limit, 10), 1);
END $$;
