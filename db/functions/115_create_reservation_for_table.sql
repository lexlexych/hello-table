-- Бронь КОНКРЕТНОГО столика.
--
-- Отличие от create_reservation_atomic: там функция сама перебирает столики и выбирает
-- подходящий, здесь столик уже выбран гостем по зоне из ответа find_available_tables.
-- Любой канал занимает столик с выбранного времени до местной полуночи.
--
-- Вход — дата и местное время, а не timestamptz: n8n не имеет прав на таблицы и не может
-- прочитать часовой пояс ресторана, чтобы собрать момент времени самостоятельно.
CREATE OR REPLACE FUNCTION create_reservation_for_table(
  p_restaurant  uuid,
  p_table       uuid,
  p_date        date,
  p_time        time,
  p_party_size  int,
  p_guest_name  text,
  p_guest_phone text,
  p_language    char(2),
  p_source      text DEFAULT 'phone'
) RETURNS TABLE (reservation_id uuid, booked_table_label text,
                 confirmed_starts_at timestamptz, confirmed_ends_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r        restaurants%ROWTYPE;
  v_table  record;
  v_starts timestamptz;
  v_ends   timestamptz;
  v_service_ends timestamptz;
  v_id     uuid;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  IF p_party_size < 1 OR p_party_size > r.max_party_size THEN
    RAISE EXCEPTION 'party_too_large' USING ERRCODE = '45005';
  END IF;

  v_starts := ((p_date + p_time)::timestamp) AT TIME ZONE r.timezone;
  v_service_ends := v_starts + make_interval(mins => r.slot_minutes);
  v_ends := ((p_date + 1)::timestamp) AT TIME ZONE r.timezone;

  IF v_starts <= now() THEN
    RAISE EXCEPTION 'slot_in_past' USING ERRCODE = '45006';
  END IF;

  IF NOT is_open_between(p_restaurant, v_starts, v_service_ends) THEN
    RAISE EXCEPTION 'closed_at_requested_time' USING ERRCODE = '45004';
  END IF;

  -- Блокировка строки столика. Вторая транзакция ждёт здесь до COMMIT первой и следующим
  -- запросом уже видит вставленную бронь (READ COMMITTED) — та же дисциплина, что в
  -- create_reservation_atomic, только строка ровно одна: столик назван гостем.
  SELECT t.id, t.label INTO v_table
  FROM restaurant_tables t
  WHERE t.id = p_table AND t.restaurant_id = p_restaurant AND t.is_active
    AND t.seats >= p_party_size
  FOR UPDATE;
  -- Нет столика, чужой ресторан, выключенный столик, слишком мало мест — снаружи это
  -- одна ситуация: «этот столик взять нельзя», агент предлагает выбрать другой.
  IF NOT FOUND THEN RAISE EXCEPTION 'table_not_available' USING ERRCODE = '45015'; END IF;

  IF EXISTS (
    SELECT 1 FROM reservations res
    WHERE res.table_id = v_table.id
      AND res.status IN ('confirmed','seated')
      AND tstzrange(
            res.starts_at,
            ((((res.starts_at AT TIME ZONE r.timezone)::date + 1)::timestamp)
             AT TIME ZONE r.timezone)
          ) && tstzrange(v_starts, v_ends)
  ) THEN
    RAISE EXCEPTION 'table_already_booked' USING ERRCODE = '45016';
  END IF;

  INSERT INTO reservations (restaurant_id, table_id, guest_name, guest_phone, party_size,
                            starts_at, ends_at, status, source, language)
  VALUES (p_restaurant, v_table.id, p_guest_name, p_guest_phone, p_party_size,
          v_starts, v_ends, 'confirmed', p_source, p_language)
  RETURNING id INTO v_id;

  reservation_id      := v_id;
  booked_table_label  := v_table.label;
  confirmed_starts_at := v_starts;
  confirmed_ends_at   := v_ends;
  RETURN NEXT;
END $$;
