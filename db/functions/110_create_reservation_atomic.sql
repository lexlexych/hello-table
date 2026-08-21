CREATE OR REPLACE FUNCTION create_reservation_atomic(
  p_restaurant  uuid,
  p_starts_at   timestamptz,
  p_party_size  int,
  p_guest_name  text,
  p_guest_phone text,
  p_language    char(2),
  p_source      text DEFAULT 'phone'
) RETURNS TABLE (reservation_id uuid, assigned_table_id uuid, assigned_table_label text,
                 confirmed_starts_at timestamptz, confirmed_ends_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r      restaurants%ROWTYPE;
  v_ends timestamptz;
  v_service_ends timestamptz;
  cand   record;
  v_id   uuid;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;
  IF p_party_size < 1 OR p_party_size > r.max_party_size THEN
    RAISE EXCEPTION 'party_too_large' USING ERRCODE = '45005';
  END IF;
  IF p_starts_at <= now() THEN
    RAISE EXCEPTION 'slot_in_past' USING ERRCODE = '45006';
  END IF;

  v_service_ends := p_starts_at + make_interval(mins => r.slot_minutes);
  v_ends := ((((p_starts_at AT TIME ZONE r.timezone)::date + 1)::timestamp)
             AT TIME ZONE r.timezone);

  -- Время прихода должно допускать обычную посадку slot_minutes в часы работы,
  -- но сама созданная бронь остаётся активной до местной полуночи.
  IF NOT is_open_between(p_restaurant, p_starts_at, v_service_ends) THEN
    RAISE EXCEPTION 'closed_at_requested_time' USING ERRCODE = '45004';
  END IF;

  -- Столики перебираются в одном и том же порядке во всех транзакциях: сначала
  -- самый маленький подходящий. Благодаря этому конкуренты сходятся на одной строке
  -- и выстраиваются в очередь на FOR UPDATE, а не расходятся по разным кандидатам.
  FOR cand IN
    SELECT t.id, t.label, t.seats
    FROM restaurant_tables t
    WHERE t.restaurant_id = p_restaurant AND t.is_active AND t.seats >= p_party_size
    ORDER BY t.seats, t.label
  LOOP
    -- Блокировка строки столика. Вторая транзакция ждёт здесь до COMMIT первой,
    -- после чего следующий SELECT увидит уже вставленную бронь (READ COMMITTED).
    PERFORM 1 FROM restaurant_tables WHERE id = cand.id FOR UPDATE;

    IF NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.table_id = cand.id
        AND res.status IN ('confirmed','seated')
        AND tstzrange(
              res.starts_at,
              ((((res.starts_at AT TIME ZONE r.timezone)::date + 1)::timestamp)
               AT TIME ZONE r.timezone)
            ) && tstzrange(p_starts_at, v_ends)
    ) THEN
      INSERT INTO reservations (restaurant_id, table_id, guest_name, guest_phone, party_size,
                                starts_at, ends_at, status, source, language)
      VALUES (p_restaurant, cand.id, p_guest_name, p_guest_phone, p_party_size,
              p_starts_at, v_ends, 'confirmed', p_source, p_language)
      RETURNING id INTO v_id;

      reservation_id       := v_id;
      assigned_table_id    := cand.id;
      assigned_table_label := cand.label;
      confirmed_starts_at  := p_starts_at;
      confirmed_ends_at    := v_ends;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'no_table_available' USING ERRCODE = '45001';
END $$;
