-- Слоты самовывоза для конкретного заказа в МЕСТНОМ времени ресторана — вход инструмента
-- check_pickup_slots.
--
-- Отличие от find_pickup_slots: та принимает и возвращает момент времени (timestamptz), а
-- роль agent_app не имеет прав на таблицы (PROJECT.md §3.5) и не может прочитать
-- restaurants.timezone. Собрать момент из «завтра в восемь» и произнести ответ настенным
-- временем она поэтому не может — перевод в обе стороны делает эта функция, ровно как
-- create_reservation_for_table для брони.
--
-- Максимальное prep_minutes заказа считается здесь же: find_pickup_slots требует его
-- параметром, а модель время приготовления блюд не знает и знать не должна.
CREATE OR REPLACE FUNCTION find_pickup_slots_local(
  p_restaurant uuid,
  p_items      jsonb DEFAULT NULL,
  p_date       date  DEFAULT NULL,
  p_time       time  DEFAULT NULL,
  p_limit      int   DEFAULT 3
) RETURNS TABLE (pickup_slot_at        timestamptz,
                 pickup_slot_date      date,
                 pickup_slot_time      text,
                 pickup_free_capacity  int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r          restaurants%ROWTYPE;
  v_prep     int := 0;
  v_earliest timestamptz;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array'
     AND jsonb_array_length(p_items) > 0 THEN
    -- Форма проверяется до приведения типов в pickup_items_expand, чтобы вызывающий получил
    -- документированный прикладной SQLSTATE, а не внутреннюю ошибку каста.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) elem
      WHERE jsonb_typeof(elem) <> 'object'
         OR coalesce(elem->>'menu_item_id', '') !~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    ) THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '45003';
    END IF;

    -- Несуществующая или выключенная позиция здесь не ошибка: сборка корзины ещё идёт, и
    -- окончательную проверку делает create_pickup_order_atomic. Для оценки времени
    -- готовности достаточно тех позиций, которые уже опознаны.
    SELECT coalesce(max(mi.prep_minutes), 0) INTO v_prep
    FROM pickup_items_expand(p_items) i
    JOIN menu_items mi
      ON mi.id = i.line_menu_item_id
     AND mi.is_available
     AND mi.category_id IN (SELECT mc.id FROM menu_categories mc
                            WHERE mc.restaurant_id = p_restaurant);
  END IF;

  -- Пустое время означает «как можно раньше»: find_pickup_slots сам не отдаёт слоты
  -- раньше now() + GREATEST(pickup_lead_minutes, prep_minutes). Дата без времени тоже
  -- означает «как можно раньше»: полночь как желаемый момент выдачи смысла не имеет.
  IF p_time IS NOT NULL THEN
    v_earliest := ((coalesce(p_date, (now() AT TIME ZONE r.timezone)::date) + p_time)::timestamp)
                  AT TIME ZONE r.timezone;
  END IF;

  RETURN QUERY
  SELECT s.slot_time,
         (s.slot_time AT TIME ZONE r.timezone)::date,
         to_char(s.slot_time AT TIME ZONE r.timezone, 'HH24:MI'),
         s.free_capacity
  FROM find_pickup_slots(p_restaurant, v_earliest, v_prep,
                         greatest(coalesce(p_limit, 3), 1)) s;
END $$;
