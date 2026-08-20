CREATE OR REPLACE FUNCTION find_pickup_slots(
  p_restaurant   uuid,
  p_earliest     timestamptz DEFAULT NULL,
  p_prep_minutes int         DEFAULT 0,
  p_limit        int         DEFAULT 6
) RETURNS TABLE (slot_time timestamptz, free_capacity int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r restaurants%ROWTYPE; v_from timestamptz; v_day date;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  -- §6.1: время готовности считает база — из pickup_lead_minutes ресторана
  -- и максимального prep_minutes в заказе
  -- Запас на подготовку отсчитывается от «сейчас», а не от желаемого гостем времени:
  -- иначе просьба «к восьми» отодвигала бы первый слот на 20:30. Для p_earliest = NULL
  -- обе формы совпадают — это единственный случай, который был у прежних вызывающих.
  v_from := GREATEST(coalesce(p_earliest, now()),
                     now() + make_interval(mins => GREATEST(r.pickup_lead_minutes,
                                                            coalesce(p_prep_minutes, 0))));
  v_from := to_timestamp(ceil(extract(epoch FROM v_from) / 900.0) * 900);  -- вверх до 15 минут
  v_day  := (v_from AT TIME ZONE r.timezone)::date;

  RETURN QUERY
  WITH wins AS (
    SELECT w.win
    FROM generate_series(v_day - 1, v_day + 2, interval '1 day') AS d(day)
    CROSS JOIN LATERAL opening_windows(p_restaurant, d.day::date) w
  ),
  grid AS (
    SELECT DISTINCT gs AS g_time
    FROM wins,
         LATERAL generate_series(
           to_timestamp(ceil(extract(epoch FROM GREATEST(lower(wins.win), v_from)) / 900.0) * 900),
           upper(wins.win) - interval '15 minutes',
           interval '15 minutes') AS gs
  )
  SELECT g.g_time,
         (r.pickup_slot_capacity - count(po.id))::int
  FROM grid g
  LEFT JOIN pickup_orders po
    ON po.restaurant_id = p_restaurant
   AND po.status IN ('new','confirmed','preparing','ready')
   AND po.ready_at >= g.g_time
   AND po.ready_at <  g.g_time + interval '15 minutes'
  WHERE g.g_time >= v_from
  GROUP BY g.g_time
  HAVING count(po.id) < r.pickup_slot_capacity
  ORDER BY g.g_time
  LIMIT greatest(coalesce(p_limit, 6), 1);
END $$;
