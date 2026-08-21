-- Бронь конкретного столика на день из портала. В отличие от
-- create_reservation_atomic здесь столик указывает человек, но длительность едина:
-- столик занят с указанного времени ДО КОНЦА ДНЯ.
--
-- Строки пишутся в ту же таблицу reservations, что и телефонные брони: иначе голосовой
-- агент не увидел бы занятость и выдал бы этот столик гостю по телефону.
CREATE OR REPLACE FUNCTION book_table_for_day(
  p_restaurant  uuid,
  p_table       uuid,
  p_date        date,
  p_time        time,
  p_party_size  int,
  p_guest_name  text,
  p_source      text DEFAULT 'portal'
) RETURNS TABLE (reservation_id uuid, booked_table_id uuid, booked_table_label text,
                 booked_starts_at timestamptz, booked_ends_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r        restaurants%ROWTYPE;
  v_table  record;
  v_starts timestamptz;
  v_ends   timestamptz;
  v_id     uuid;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  -- Прошедший день бронировать нельзя. Прошедшее время внутри сегодняшнего дня — можно:
  -- оператор отмечает уже занятый гостями столик задним числом.
  IF p_date < (now() AT TIME ZONE r.timezone)::date THEN
    RAISE EXCEPTION 'slot_in_past' USING ERRCODE = '45006';
  END IF;

  -- «До конца дня» — местная полночь следующего дня. Границы tstzrange полуоткрыты,
  -- поэтому бронь того же столика на следующий день с 00:00 не считается пересечением.
  v_starts := ((p_date + p_time)::timestamp) AT TIME ZONE r.timezone;
  v_ends   := ((p_date + 1)::timestamp)      AT TIME ZONE r.timezone;

  -- Блокировка строки столика — та же дисциплина, что в create_reservation_atomic:
  -- параллельная транзакция ждёт здесь до COMMIT первой и следующим запросом уже
  -- видит вставленную бронь (READ COMMITTED).
  SELECT t.id, t.label INTO v_table
  FROM restaurant_tables t
  WHERE t.id = p_table AND t.restaurant_id = p_restaurant AND t.is_active
  FOR UPDATE;
  -- Нет столика, чужой ресторан, выключенный столик — снаружи это одна ситуация.
  IF NOT FOUND THEN RAISE EXCEPTION 'table_not_available' USING ERRCODE = '45015'; END IF;

  -- buffer_minutes не применяется ни в одном пути бронирования до полуночи: буфер
  -- выехал бы в следующий день и запретил бронировать этот же столик завтра с 00:00.
  -- Для старых 90-минутных строк проверка тоже продлевает занятость до полуночи;
  -- новые строки уже совпадают с ограничением reservations_no_overlap один в один.
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

  -- max_party_size здесь намеренно не проверяется: это лимит телефонных броней, а столик
  -- выбрал человек. Границу 1..100 держит CHECK таблицы.
  INSERT INTO reservations (restaurant_id, table_id, guest_name, guest_phone, party_size,
                            starts_at, ends_at, status, source, language)
  VALUES (p_restaurant, v_table.id, p_guest_name, NULL, p_party_size,
          v_starts, v_ends, 'confirmed', p_source, r.default_language)
  RETURNING id INTO v_id;

  reservation_id     := v_id;
  booked_table_id    := v_table.id;
  booked_table_label := v_table.label;
  booked_starts_at   := v_starts;
  booked_ends_at     := v_ends;
  RETURN NEXT;
END $$;
