-- Оформление заказа на самовывоз по МЕСТНОМУ времени ресторана — вход инструмента
-- create_pickup_order.
--
-- Причина существования та же, что у find_pickup_slots_local: create_pickup_order_atomic
-- принимает и возвращает timestamptz, а agent_app не имеет прав на таблицы и не может
-- прочитать restaurants.timezone (PROJECT.md §3.5). Вся логика заказа — цены, сумма,
-- вместимость слота, номер, атомарность — остаётся в create_pickup_order_atomic; здесь
-- только перевод времени в обе стороны.
CREATE OR REPLACE FUNCTION create_pickup_order_local(
  p_restaurant  uuid,
  p_items       jsonb,
  p_date        date,
  p_time        time,
  p_guest_name  text,
  p_guest_phone text,
  p_language    char(2),
  p_source      text DEFAULT 'phone'
) RETURNS TABLE (created_order_id     uuid,
                 created_order_number text,
                 created_total_cents  int,
                 created_ready_at     timestamptz,
                 created_ready_date   date,
                 created_ready_time   text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r       restaurants%ROWTYPE;
  v_ready timestamptz;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  -- Пустое время (как и дата без времени) означает «ближайший возможный слот»: тогда
  -- create_pickup_order_atomic выбирает его сам через find_pickup_slots.
  IF p_time IS NOT NULL THEN
    v_ready := ((coalesce(p_date, (now() AT TIME ZONE r.timezone)::date) + p_time)::timestamp)
               AT TIME ZONE r.timezone;
    -- Сетка слотов самовывоза 15-минутная — этого требует pickup_slot_is_free. Названное
    -- голосом «двадцать ноль семь» иначе всегда упиралось бы в slot_full. Округляем вверх,
    -- а фактическое время возвращаем вызывающему: гостю агент называет именно его.
    v_ready := to_timestamp(ceil(extract(epoch FROM v_ready) / 900.0) * 900);
  END IF;

  RETURN QUERY
  SELECT c.pickup_order_id,
         c.assigned_order_number,
         c.order_total_cents,
         c.confirmed_ready_at,
         (c.confirmed_ready_at AT TIME ZONE r.timezone)::date,
         to_char(c.confirmed_ready_at AT TIME ZONE r.timezone, 'HH24:MI')
  FROM create_pickup_order_atomic(p_restaurant, p_items, v_ready, p_guest_name,
                                  p_guest_phone, p_language, p_source) c;
END $$;
