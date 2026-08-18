-- Свободные столики на КОНКРЕТНОЕ время — вход инструмента check_availability.
--
-- Отличие от find_available_slots: та функция отвечает на вопрос «когда можно прийти»
-- и отдаёт по одному, самому маленькому подходящему столику на каждое время. Здесь
-- время уже названо гостем, и нужен полный список столиков вместе с зоной, чтобы агент
-- мог спросить «зал или терраса». Без zone выбор места голосом невозможен.
CREATE OR REPLACE FUNCTION find_available_tables(
  p_restaurant uuid,
  p_date       date,
  p_time       time,
  p_party_size int
) RETURNS TABLE (table_id uuid, table_label text, table_seats int, table_zone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r        restaurants%ROWTYPE;
  v_starts timestamptz;
  v_ends   timestamptz;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  -- Слишком большая компания, прошедшее время и закрытый ресторан — это не ошибки
  -- поиска, а «свободных столиков нет». Так же ведёт себя find_available_slots:
  -- агент говорит гостю одну и ту же фразу и предлагает другое время.
  IF p_party_size < 1 OR p_party_size > r.max_party_size THEN RETURN; END IF;

  v_starts := ((p_date + p_time)::timestamp) AT TIME ZONE r.timezone;
  v_ends   := v_starts + make_interval(mins => r.slot_minutes);

  IF v_starts <= now() THEN RETURN; END IF;
  IF NOT is_open_between(p_restaurant, v_starts, v_ends) THEN RETURN; END IF;

  RETURN QUERY
  SELECT t.id, t.label, t.seats, t.zone
  FROM restaurant_tables t
  WHERE t.restaurant_id = p_restaurant
    AND t.is_active
    AND t.seats >= p_party_size
    -- Тот же буфер с обеих сторон, что и в create_reservation_atomic: иначе поиск
    -- показал бы столик, который бронирование затем отвергнет.
    AND NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.table_id = t.id
        AND res.status IN ('confirmed','seated')
        AND tstzrange(res.starts_at - make_interval(mins => r.buffer_minutes),
                      res.ends_at   + make_interval(mins => r.buffer_minutes))
            && tstzrange(v_starts, v_ends)
    )
  ORDER BY t.seats, t.label;   -- сначала самый компактный подходящий столик
END $$;
